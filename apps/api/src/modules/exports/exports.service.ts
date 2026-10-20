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
  ForbiddenException,
  ConflictException,
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

  async list(userId: string, input: { projectId: string; sourceType: "asset" | "collection"; sourceId: string; page: number; limit: number }) {
    const where: Prisma.ExportJobWhereInput = { userId, projectId: input.projectId, project: { deletedAt: null, workspace: { ownerId: userId } },
      ...(input.sourceType === "asset" ? { designAssetId: input.sourceId } : { collectionId: input.sourceId }) };
    const [rows, total] = await Promise.all([
      this.database.exportJob.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (input.page - 1) * input.limit, take: input.limit }),
      this.database.exportJob.count({ where }),
    ]);
    return { items: rows.map((row) => this.toView(row)), total, page: input.page, hasMore: input.page * input.limit < total };
  }

  async create(userId: string, input: CreateExportInput, requestKey?: string) {
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const replay = async () => {
      if (!requestKey) return null;
      const previous = await this.database.exportJob.findUnique({ where: { userId_requestKey: { userId, requestKey } } });
      if (previous && previous.requestFingerprint !== fingerprint) throw new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED", message: "该导出编号已用于不同参数" });
      return previous;
    };
    const previous = await replay();
    if (previous) return this.toView(previous);
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
        : await this.ownedCollection(userId, input.collectionId);
    const format = toFormat(input.format);
    const quality =
      input.quality === "high" ? ExportQuality.HIGH : ExportQuality.STANDARD;
    const maxEdge =
      quality === ExportQuality.STANDARD ? STANDARD_EXPORT_MAX_EDGE : null;
    let exportJob;
    try {
    exportJob = await this.database.$transaction(async (tx) => {
    const created = await tx.exportJob.create({
      data: {
        ...(input.sourceType === "asset"
          ? { designAssetId: input.assetId }
          : { collectionId: input.collectionId }),
        format,
        maxEdge,
        projectId: source.projectId,
        quality,
        userId,
        watermark: false,
        ...(requestKey ? { requestKey, requestFingerprint: fingerprint } : {}),
      },
    });
    await appendWorkflowOutbox(tx, { projectId: source.projectId, eventKey: `export:${created.id}:dispatch`, eventType: "export.dispatch", payload: { exportId: created.id } });
    return created;
    });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const concurrent = await replay();
        if (concurrent) return this.toView(concurrent);
      }
      throw error;
    }
    await this.jobs.enqueue(exportJob.id).catch(() => undefined);
    return this.toView(exportJob);
  }

  async get(userId: string, exportId: string) {
    let exportJob = await this.database.exportJob.findUnique({
      where: { id: exportId },
    });
    if (!exportJob) {
      throw new NotFoundException({
        code: "EXPORT_NOT_FOUND",
        message: "导出任务不存在",
      });
    }
    if (exportJob.userId !== userId) {
      throw new ForbiddenException({
        code: "EXPORT_FORBIDDEN",
        message: "无权访问该导出任务",
      });
    }

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

    const remainingSeconds = exportJob.expiresAt
      ? Math.floor((exportJob.expiresAt.getTime() - Date.now()) / 1_000)
      : 0;
    const downloadUrl =
      exportJob.status === ExportStatus.SUCCEEDED &&
      exportJob.objectKey &&
      exportJob.fileName &&
      remainingSeconds > 0
        ? await this.storage.createDownloadUrl(
            exportJob.objectKey,
            Math.min(remainingSeconds, EXPORT_RETENTION_MS / 1_000),
            exportJob.fileName,
          )
        : null;
    return {
      ...this.toView(exportJob),
      downloadUrl,
      retryAllowed:
        exportJob.status === ExportStatus.EXPIRED ||
        exportJob.status === ExportStatus.FAILED,
    };
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
    if (asset.project.workspace.ownerId !== userId) {
      throw new ForbiddenException({
        code: "EXPORT_ASSET_FORBIDDEN",
        message: "无权导出该 Look",
      });
    }
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
    if (collection.project.workspace.ownerId !== userId) {
      throw new ForbiddenException({
        code: "EXPORT_COLLECTION_FORBIDDEN",
        message: "无权导出该系列",
      });
    }
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
