import { ProjectAccessPolicy } from "../studio/project-access.policy";
import {
  ExportFormat,
  ExportQuality,
  ExportStatus,
  Prisma,
  appendWorkflowOutbox,
  type PrismaClient,
} from "@fashion/db";
import { EXPORT_RETENTION_MS, STANDARD_EXPORT_MAX_EDGE } from "@fashion/shared";
import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";

import type { CreateExportInput } from "./exports.schemas";
import type { ExportJobs } from "./export-queue.service";
import type { FileStorage } from "../files/storage.service";

export const EXPORTS_DB = Symbol("EXPORTS_DB");
export const EXPORT_JOBS = Symbol("EXPORT_JOBS");
export const EXPORT_STORAGE = Symbol("EXPORT_STORAGE");

const DOWNLOAD_SIGNATURE_SECONDS = 60;

const MIME_BY_FORMAT = {
  [ExportFormat.JPG]: "image/jpeg",
  [ExportFormat.PDF]: "application/pdf",
  [ExportFormat.PNG]: "image/png",
} as const;

@Injectable()
export class ExportsService {
  constructor(
    @Inject(EXPORTS_DB) private readonly database: PrismaClient,
    @Inject(EXPORT_JOBS) private readonly jobs: ExportJobs,
    @Inject(EXPORT_STORAGE) private readonly storage: FileStorage,
    @Inject(ProjectAccessPolicy)
    private readonly access: ProjectAccessPolicy = new ProjectAccessPolicy(database),
  ) {}

  async capabilities(userId: string) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException({
        code: "USER_NOT_FOUND",
        message: "用户不存在",
      });
    }
    return {
      downloadLinkHours: EXPORT_RETENTION_MS / 3_600_000,
    };
  }

  async list(
    userId: string,
    input: {
      projectId: string;
      sourceType: "asset" | "collection" | "tech_pack" | "presentation_set";
      sourceId: string;
      page: number;
      limit: number;
    },
  ) {
    await this.access.require(userId, input.projectId, "read");
    const where: Prisma.ExportJobWhereInput = {
      projectId: input.projectId,
      ...(input.sourceType === "asset"
        ? { designAssetId: input.sourceId }
        : input.sourceType === "collection"
          ? { collectionId: input.sourceId }
          : { studioRevisionId: input.sourceId }),
    };
    const [rows, total] = await Promise.all([
      this.database.exportJob.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.database.exportJob.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.toView(row)),
      total,
      page: input.page,
      hasMore: input.page * input.limit < total,
    };
  }

  async create(userId: string, input: CreateExportInput, requestKey?: string) {
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const replay = async () => {
      if (!requestKey) return null;
      const previous = await this.database.exportJob.findUnique({
        where: { userId_requestKey: { userId, requestKey } },
      });
      if (previous && previous.requestFingerprint !== fingerprint)
        throw new ConflictException({
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "该导出编号已用于不同参数",
        });
      return previous;
    };
    const previous = await replay();
    if (previous) {
      await this.access.require(userId, previous.projectId, "read");
      return this.toView(previous);
    }
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException({
        code: "USER_NOT_FOUND",
        message: "用户不存在",
      });
    }
    const source =
      input.sourceType === "asset"
        ? await this.ownedAsset(userId, input.assetId)
        : input.sourceType === "collection"
          ? await this.ownedCollection(userId, input.collectionId)
          : await this.ownedStudioDocument(
              userId,
              input.studioRevisionId,
              input.sourceType === "tech_pack"
                ? "TECH_PACK"
                : "PRESENTATION_SET",
            );
    const format = toFormat(input.format);
    const quality =
      input.quality === "high" ? ExportQuality.HIGH : ExportQuality.STANDARD;
    const maxEdge =
      quality === ExportQuality.STANDARD ? STANDARD_EXPORT_MAX_EDGE : null;
    let exportJob;
    try {
      exportJob = await this.database.$transaction(async (tx) => {
        await this.access.require(userId, source.projectId, "read", tx);
        const created = await tx.exportJob.create({
          data: {
            ...(input.sourceType === "asset"
              ? { designAssetId: input.assetId }
              : input.sourceType === "collection"
                ? { collectionId: input.collectionId }
                : { studioRevisionId: input.studioRevisionId }),
            format,
            maxEdge,
            projectId: source.projectId,
            quality,
            userId,
            watermark: false,
            ...(requestKey
              ? { requestKey, requestFingerprint: fingerprint }
              : {}),
          },
        });
        await appendWorkflowOutbox(tx, {
          projectId: source.projectId,
          eventKey: `export:${created.id}:dispatch`,
          eventType: "export.dispatch",
          payload: { exportId: created.id },
        });
        return created;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const concurrent = await replay();
        if (concurrent) {
          await this.access.require(userId, concurrent.projectId, "read");
          return this.toView(concurrent);
        }
      }
      throw error;
    }
    await this.jobs.enqueue(exportJob.id).catch(() => undefined);
    return this.toView(exportJob);
  }

  private async readableJob(userId: string, exportId: string) {
    let exportJob = await this.database.exportJob.findUnique({
      where: { id: exportId },
    });
    if (!exportJob) {
      throw new NotFoundException({
        code: "EXPORT_NOT_FOUND",
        message: "导出任务不存在",
      });
    }
    await this.access.require(userId, exportJob.projectId, "read");

    if (
      exportJob.status === ExportStatus.SUCCEEDED &&
      exportJob.expiresAt &&
      exportJob.expiresAt.getTime() <= Date.now()
    ) {
      exportJob = await this.database.exportJob.update({
        where: { id: exportJob.id },
        data: { status: ExportStatus.EXPIRED },
      });
    }

    return exportJob;
  }

  private isDownloadable(
    exportJob: Awaited<ReturnType<ExportsService["readableJob"]>>,
  ) {
    return (
      exportJob.status === ExportStatus.SUCCEEDED &&
      !!exportJob.objectKey &&
      !!exportJob.fileName &&
      !!exportJob.expiresAt &&
      exportJob.expiresAt.getTime() > Date.now()
    );
  }

  async get(userId: string, exportId: string) {
    const exportJob = await this.readableJob(userId, exportId);
    return {
      ...this.toView(exportJob),
      downloadUrl: this.isDownloadable(exportJob)
        ? "/api/exports/" + encodeURIComponent(exportJob.id) + "/content"
        : null,
      retryAllowed:
        exportJob.status === ExportStatus.EXPIRED ||
        exportJob.status === ExportStatus.FAILED,
    };
  }

  /** Stable app URLs recheck membership on every click; object-storage URLs live at most a minute. */
  async downloadUrl(userId: string, exportId: string): Promise<string> {
    const exportJob = await this.readableJob(userId, exportId);
    const remainingSeconds = exportJob.expiresAt
      ? Math.floor((exportJob.expiresAt.getTime() - Date.now()) / 1_000)
      : 0;
    if (
      exportJob.status === ExportStatus.EXPIRED ||
      (exportJob.expiresAt && remainingSeconds <= 0)
    ) {
      throw new GoneException({
        code: "EXPORT_EXPIRED",
        message: "导出文件已过期，请重新生成",
      });
    }
    if (
      exportJob.status !== ExportStatus.SUCCEEDED ||
      !exportJob.objectKey ||
      !exportJob.fileName ||
      remainingSeconds <= 0
    ) {
      throw new ConflictException({
        code: "EXPORT_NOT_READY",
        message: "导出文件尚未就绪，请等待导出完成",
      });
    }
    return this.storage.createDownloadUrl(
      exportJob.objectKey,
      Math.min(DOWNLOAD_SIGNATURE_SECONDS, remainingSeconds),
      exportJob.fileName,
    );
  }

  private async ownedStudioDocument(
    userId: string,
    revisionId: string,
    type: "TECH_PACK" | "PRESENTATION_SET",
  ) {
    const record = await this.database.studioDocument.findUnique({
      where: { id: revisionId },
      include: { project: { include: { workspace: true } } },
    });
    if (!record || record.type !== type || record.project.deletedAt)
      throw new NotFoundException("技术包修订不存在");
    await this.access.require(userId, record.projectId, "read");
    return { projectId: record.projectId };
  }

  private async ownedAsset(userId: string, assetId: string) {
    const asset = await this.database.designAsset.findUnique({
      where: { id: assetId },
      select: {
        projectId: true,
        project: {
          select: {
            deletedAt: true,
            workspace: { select: { ownerId: true } },
          },
        },
      },
    });
    if (!asset || asset.project.deletedAt) {
      throw new NotFoundException({
        code: "EXPORT_ASSET_NOT_FOUND",
        message: "待导出的原始 Look 不存在",
      });
    }
    await this.access.require(userId, asset.projectId, "read");
    return asset;
  }

  private async ownedCollection(userId: string, collectionId: string) {
    const collection = await this.database.collection.findUnique({
      where: { id: collectionId },
      select: {
        projectId: true,
        project: {
          select: {
            deletedAt: true,
            workspace: { select: { ownerId: true } },
          },
        },
      },
    });
    if (!collection || collection.project.deletedAt) {
      throw new NotFoundException({
        code: "EXPORT_COLLECTION_NOT_FOUND",
        message: "待导出的系列不存在",
      });
    }
    await this.access.require(userId, collection.projectId, "read");
    return collection;
  }

  private toView(exportJob: {
    readonly completedAt: Date | null;
    readonly createdAt: Date;
    readonly errorCode: string | null;
    readonly errorMessage: string | null;
    readonly expiresAt: Date | null;
    readonly fileName: string | null;
    readonly format: ExportFormat;
    readonly id: string;
    readonly maxEdge: number | null;
    readonly mimeType: string | null;
    readonly quality: ExportQuality;
    readonly sizeBytes: number | null;
    readonly status: ExportStatus;
  }) {
    return {
      completedAt: exportJob.completedAt,
      createdAt: exportJob.createdAt,
      error: exportJob.errorMessage
        ? { code: exportJob.errorCode, message: exportJob.errorMessage }
        : null,
      expiresAt: exportJob.expiresAt,
      fileName: exportJob.fileName,
      format: exportJob.format.toLowerCase(),
      id: exportJob.id,
      maxEdge: exportJob.maxEdge,
      mimeType: exportJob.mimeType ?? MIME_BY_FORMAT[exportJob.format],
      quality: exportJob.quality.toLowerCase(),
      sizeBytes: exportJob.sizeBytes,
      status: exportJob.status.toLowerCase(),
    };
  }
}

function toFormat(format: CreateExportInput["format"]): ExportFormat {
  return {
    jpg: ExportFormat.JPG,
    pdf: ExportFormat.PDF,
    png: ExportFormat.PNG,
  }[format];
}
