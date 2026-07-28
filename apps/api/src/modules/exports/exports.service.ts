import {
  AccountPlan,
  ExportFormat,
  ExportQuality,
  ExportStatus,
  type PrismaClient,
} from "@fashion/db";
import {
  EXPORT_RETENTION_MS,
  FREE_EXPORT_MAX_EDGE,
  STANDARD_EXPORT_MAX_EDGE,
} from "@fashion/shared";
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

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
      select: { plan: true },
    });
    if (!user) {
      throw new NotFoundException({
        code: "USER_NOT_FOUND",
        message: "用户不存在",
      });
    }
    const isPro = user.plan === AccountPlan.PRO;
    return {
      downloadLinkHours: EXPORT_RETENTION_MS / 3_600_000,
      freeMaxEdge: FREE_EXPORT_MAX_EDGE,
      highResolutionAllowed: isPro,
      plan: isPro ? ("pro" as const) : ("free" as const),
      watermark: !isPro,
    };
  }

  async create(userId: string, input: CreateExportInput) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    });
    if (!user) {
      throw new NotFoundException({
        code: "USER_NOT_FOUND",
        message: "用户不存在",
      });
    }
    if (input.quality === "high" && user.plan !== AccountPlan.PRO) {
      throw new ForbiddenException({
        code: "EXPORT_PLAN_UPGRADE_REQUIRED",
        message: "高清无水印导出需要升级 Pro 套餐",
        upgradeRequired: true,
      });
    }

    const source =
      input.sourceType === "asset"
        ? await this.ownedAsset(userId, input.assetId)
        : await this.ownedCollection(userId, input.collectionId);
    const format = toFormat(input.format);
    const quality =
      input.quality === "high" ? ExportQuality.HIGH : ExportQuality.STANDARD;
    const watermark = user.plan === AccountPlan.FREE;
    const maxEdge =
      user.plan === AccountPlan.FREE
        ? FREE_EXPORT_MAX_EDGE
        : quality === ExportQuality.STANDARD
          ? STANDARD_EXPORT_MAX_EDGE
          : null;
    const exportJob = await this.database.exportJob.create({
      data: {
        ...(input.sourceType === "asset"
          ? { designAssetId: input.assetId }
          : { collectionId: input.collectionId }),
        format,
        maxEdge,
        projectId: source.projectId,
        quality,
        userId,
        watermark,
      },
    });

    try {
      await this.jobs.enqueue(exportJob.id);
    } catch (error) {
      await this.database.exportJob.update({
        where: { id: exportJob.id },
        data: {
          errorCode: "EXPORT_QUEUE_UNAVAILABLE",
          errorMessage: "导出任务暂时无法排队，请重新请求",
          status: ExportStatus.FAILED,
        },
      });
      throw error;
    }
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
    readonly watermark: boolean;
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
      watermark: exportJob.watermark,
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
