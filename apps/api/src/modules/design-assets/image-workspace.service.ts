import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { Prisma, type PrismaClient } from "@fashion/db";
import { imageFeedbackSchema, type ImageFeedback } from "@fashion/shared";
import { createHash, randomBytes } from "node:crypto";
import { DESIGN_ASSETS_DB } from "./design-assets.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { S3FileStorage } from "../files/storage.service";

const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
@Injectable()
export class ImageWorkspaceService {
  constructor(
    @Inject(DESIGN_ASSETS_DB) private readonly db: PrismaClient,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy,
    @Inject(S3FileStorage) private readonly storage: S3FileStorage,
  ) {}

  async owned(userId: string, assetId: string, edit = false) {
    const asset = await this.db.designAsset.findFirst({
      where: { id: assetId, archivedAt: null },
    });
    if (!asset) throw new NotFoundException("图片不存在");
    await this.access.require(userId, asset.projectId, edit ? "edit" : "read");
    return asset;
  }
  async feedback(userId: string, assetId: string): Promise<ImageFeedback> {
    await this.owned(userId, assetId);
    const saved = await this.db.imageAssetFeedback.findUnique({
      where: { assetId },
    });
    return saved
      ? imageFeedbackSchema.parse({
          ...(saved.data as object),
          revision: saved.revision,
        })
      : { revision: 0, annotations: [], comments: [] };
  }
  async save(userId: string, assetId: string, input: ImageFeedback) {
    await this.owned(userId, assetId, true);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${assetId}))`;
      const current = await tx.imageAssetFeedback.findUnique({
        where: { assetId },
      });
      if ((current?.revision ?? 0) !== input.revision)
        throw new ConflictException("标注已在其他窗口更新，请重新加载后合并");
      const revision = input.revision + 1;
      const data = JSON.parse(
        JSON.stringify({
          annotations: input.annotations,
          comments: input.comments,
        }),
      ) as Prisma.InputJsonValue;
      await tx.imageAssetFeedback.upsert({
        where: { assetId },
        create: { assetId, revision, data },
        update: { revision, data },
      });
      return { ...input, revision };
    });
  }
  async shares(userId: string, assetId: string) {
    await this.owned(userId, assetId, true);
    return this.db.imageAssetShare.findMany({
      where: { assetId },
      select: { id: true, createdAt: true, expiresAt: true, revokedAt: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }
  async share(userId: string, assetId: string) {
    await this.owned(userId, assetId, true);
    const token = randomBytes(32).toString("base64url");
    const row = await this.db.imageAssetShare.create({
      data: {
        assetId,
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    return { id: row.id, path: `/share/${token}`, expiresAt: row.expiresAt };
  }
  async revoke(userId: string, assetId: string, id: string) {
    await this.owned(userId, assetId, true);
    await this.db.imageAssetShare.updateMany({
      where: { id, assetId },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }
  async shared(token: string) {
    if (!/^[\w-]{43}$/u.test(token))
      throw new NotFoundException("分享不存在或已失效");
    const row = await this.db.imageAssetShare.findFirst({
      where: {
        tokenHash: hash(token),
        revokedAt: null,
        expiresAt: { gt: new Date() },
        asset: { archivedAt: null, project: { deletedAt: null } },
      },
      include: { asset: true },
    });
    if (!row) throw new NotFoundException("分享不存在或已失效");
    return row.asset;
  }
  async bytes(asset: { url: string }) {
    if (!asset.url.startsWith("s3://"))
      throw new BadRequestException("图片尚未保存到私有存储");
    const key = asset.url.slice(5);
    const info = await this.storage.head(key);
    if (info.contentLength <= 0 || info.contentLength > 50 * 1024 * 1024)
      throw new BadRequestException("图片文件大小不受支持");
    return {
      body: Buffer.from(await this.storage.readPrefix(key, info.contentLength)),
      contentType: info.contentType ?? "image/png",
    };
  }
}
