import {
  DesignAssetOperation,
  FileStatus,
  type DesignAsset,
  type PrismaClient,
} from "@fashion/db";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { S3FileStorage } from "../files/storage.service";

export const DESIGN_ASSETS_DB = Symbol("DESIGN_ASSETS_DB");

type DesignAssetDatabase = Pick<
  PrismaClient,
  "designAsset" | "fileAsset" | "project"
>;

interface OwnedDesignAsset extends DesignAsset {
  readonly project: {
    readonly workspace: {
      readonly ownerId: string;
    };
  };
}

export interface DesignAssetView {
  readonly id: string;
  readonly projectId: string;
  readonly parentAssetId: string | null;
  readonly restoredFromAssetId: string | null;
  readonly operation: Lowercase<keyof typeof DesignAssetOperation>;
  readonly url: string;
  readonly thumbnailUrl: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly seed: number | null;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
}

@Injectable()
export class DesignAssetsService {
  constructor(
    @Inject(DESIGN_ASSETS_DB)
    private readonly database: DesignAssetDatabase,
    @Inject(S3FileStorage)
    private readonly storage: S3FileStorage,
  ) {}

  async importFile(
    userId: string,
    projectId: string,
    fileId: string,
  ): Promise<DesignAssetView> {
    const [project, file] = await Promise.all([
      this.database.project.findUnique({
        where: { id: projectId },
        select: {
          deletedAt: true,
          workspace: { select: { ownerId: true } },
        },
      }),
      this.database.fileAsset.findUnique({ where: { id: fileId } }),
    ]);
    if (!project || project.deletedAt) {
      throw new NotFoundException({
        code: "PROJECT_NOT_FOUND",
        message: "项目不存在",
      });
    }
    if (project.workspace.ownerId !== userId) {
      throw new ForbiddenException({
        code: "PROJECT_FORBIDDEN",
        message: "无权向该项目导入图片",
      });
    }
    if (!file) {
      throw new NotFoundException({
        code: "FILE_NOT_FOUND",
        message: "上传图片不存在",
      });
    }
    if (file.ownerId !== userId) {
      throw new ForbiddenException({
        code: "FILE_FORBIDDEN",
        message: "无权使用该上传图片",
      });
    }
    if (file.status !== FileStatus.READY) {
      throw new BadRequestException({
        code: "FILE_NOT_READY",
        message: "图片仍在处理中，请稍后重试",
      });
    }

    const id = randomUUID();
    const imported = await this.database.designAsset.upsert({
      where: {
        projectId_sourceFileId: { projectId, sourceFileId: fileId },
      },
      update: {},
      create: {
        height: file.height,
        id,
        operation: DesignAssetOperation.IMPORTED,
        projectId,
        rootAssetId: id,
        sourceFileId: file.id,
        thumbnailUrl: file.thumbnail1024Key
          ? `s3://${file.thumbnail1024Key}`
          : file.thumbnail256Key
            ? `s3://${file.thumbnail256Key}`
            : null,
        url: `s3://${file.objectKey}`,
        width: file.width,
      },
    });
    return this.toView(imported);
  }

  async downloadUrl(
    userId: string,
    assetId: string,
    variant: "content" | "thumbnail",
  ): Promise<string> {
    const asset = await this.ownedAsset(userId, assetId);
    const stored =
      variant === "thumbnail" ? (asset.thumbnailUrl ?? asset.url) : asset.url;
    const objectKey = objectKeyFrom(stored);
    return objectKey ? this.storage.createDownloadUrl(objectKey, 60) : stored;
  }

  async versions(
    userId: string,
    assetId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<{
    readonly items: readonly DesignAssetView[];
    readonly nextCursor: string | null;
  }> {
    const asset = await this.ownedAsset(userId, assetId);
    if (cursor) {
      const cursorAsset = await this.ownedAsset(userId, cursor);
      if (cursorAsset.rootAssetId !== asset.rootAssetId) {
        throw new BadRequestException({
          code: "INVALID_ASSET_CURSOR",
          message: "版本分页游标无效",
        });
      }
    }

    const records = await this.database.designAsset.findMany({
      where: { rootAssetId: asset.rootAssetId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = records.slice(0, limit);
    return {
      items: page.map((record) => this.toView(record)),
      nextCursor: records.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async restore(
    userId: string,
    targetAssetId: string,
    currentAssetId: string,
  ): Promise<DesignAssetView> {
    const [target, current] = await Promise.all([
      this.ownedAsset(userId, targetAssetId),
      this.ownedAsset(userId, currentAssetId),
    ]);
    if (
      target.projectId !== current.projectId ||
      target.rootAssetId !== current.rootAssetId
    ) {
      throw new BadRequestException({
        code: "ASSET_LINEAGE_MISMATCH",
        message: "只能恢复同一资产链中的版本",
      });
    }

    const restored = await this.database.designAsset.create({
      data: {
        id: randomUUID(),
        archivedAt: null,
        generationTaskId: null,
        height: target.height,
        operation: DesignAssetOperation.RESTORE,
        parentAssetId: current.id,
        projectId: current.projectId,
        restoredFromAssetId: target.id,
        rootAssetId: current.rootAssetId,
        seed: target.seed,
        thumbnailUrl: target.thumbnailUrl,
        url: target.url,
        width: target.width,
      },
    });
    return this.toView(restored);
  }

  private async ownedAsset(
    userId: string,
    assetId: string,
  ): Promise<OwnedDesignAsset> {
    const asset = await this.database.designAsset.findUnique({
      where: { id: assetId },
      include: {
        project: {
          select: {
            workspace: { select: { ownerId: true } },
          },
        },
      },
    });
    if (!asset) {
      throw new NotFoundException({
        code: "DESIGN_ASSET_NOT_FOUND",
        message: "设计资产不存在",
      });
    }
    if (asset.project.workspace.ownerId !== userId) {
      throw new ForbiddenException({
        code: "DESIGN_ASSET_FORBIDDEN",
        message: "无权访问该设计资产",
      });
    }
    return asset;
  }

  private toView(asset: DesignAsset): DesignAssetView {
    return {
      archivedAt: asset.archivedAt,
      createdAt: asset.createdAt,
      height: asset.height,
      id: asset.id,
      operation: asset.operation.toLowerCase() as DesignAssetView["operation"],
      parentAssetId: asset.parentAssetId,
      projectId: asset.projectId,
      restoredFromAssetId: asset.restoredFromAssetId,
      seed: asset.seed === null ? null : Number(asset.seed),
      thumbnailUrl: asset.thumbnailUrl
        ? displayAssetUrl(asset.id, "thumbnail", asset.thumbnailUrl)
        : null,
      url: displayAssetUrl(asset.id, "content", asset.url),
      width: asset.width,
    };
  }
}

function objectKeyFrom(value: string): string | null {
  return value.startsWith("s3://") ? value.slice("s3://".length) : null;
}

function displayAssetUrl(
  assetId: string,
  variant: "content" | "thumbnail",
  stored: string,
): string {
  return objectKeyFrom(stored)
    ? `/api/design-assets/${encodeURIComponent(assetId)}/${variant}`
    : stored;
}
