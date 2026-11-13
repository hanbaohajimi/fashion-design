import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, StudioShareTarget, type PrismaClient } from "@fashion/db";
import {
  studioReviewSchema,
  studioCommentSchema,
  studioPublicReviewInputSchema,
  studioShareCreateSchema,
  studioStyleSchema,
  studioTechPackSchema,
  type StudioPublicShareView,
  type StudioShareAssetView,
} from "@fashion/shared";

import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { S3FileStorage } from "../files/storage.service";

export const STUDIO_SHARES_DB = Symbol("STUDIO_SHARES_DB");
type Database = Pick<
  PrismaClient,
  "studioShareLink" | "styleRevision" | "studioDocument" | "designAsset"
>;

const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const TOKEN_PATTERN = /^[\w-]{43}$/u;

function objectKey(value: string): string | null {
  return value.startsWith("s3://") ? value.slice(5) : null;
}

@Injectable()
export class StudioSharesService {
  constructor(
    @Inject(STUDIO_SHARES_DB) private readonly database: Database,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy,
    @Inject(S3FileStorage) private readonly storage: S3FileStorage,
  ) {}

  async create(
    userId: string,
    projectId: string,
    body: unknown,
  ): Promise<{ id: string; path: string; expiresAt: Date; targetType: StudioShareTarget; revisionId: string }> {
    const input = studioShareCreateSchema.parse(body);
    await this.access.require(userId, projectId, "edit");
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    let styleRevisionId: string | undefined;
    let studioDocumentId: string | undefined;
    if (input.targetType === "STYLE") {
      const revision = await this.database.styleRevision.findUnique({
        where: { id: input.revisionId },
        include: { style: { select: { projectId: true } } },
      });
      if (!revision || revision.style.projectId !== projectId)
        throw new NotFoundException("款式修订不存在或不属于当前项目");
      styleRevisionId = revision.id;
    } else {
      const document = await this.database.studioDocument.findUnique({
        where: { id: input.revisionId },
        select: { id: true, projectId: true, type: true },
      });
      if (
        !document ||
        document.projectId !== projectId ||
        document.type !== "TECH_PACK"
      )
        throw new NotFoundException("技术包修订不存在或不属于当前项目");
      studioDocumentId = document.id;
    }
    const record = await this.database.studioShareLink.create({
      data: {
        id: randomUUID(),
        ownerId: userId,
        projectId,
        targetType:
          input.targetType === "STYLE"
            ? StudioShareTarget.STYLE
            : StudioShareTarget.TECH_PACK,
        tokenHash: hash(token),
        expiresAt,
        ...(styleRevisionId ? { styleRevisionId } : {}),
        ...(studioDocumentId ? { studioDocumentId } : {}),
      },
    });
    return {
      expiresAt: record.expiresAt,
      id: record.id,
      path: `/review/${token}`,
      revisionId: input.revisionId,
      targetType: record.targetType,
    };
  }

  async list(userId: string, projectId: string) {
    await this.access.require(userId, projectId, "read");
    const records = await this.database.studioShareLink.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        targetType: true,
        styleRevisionId: true,
        studioDocumentId: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
    const now = Date.now();
    return records.map((record) => ({
      ...record,
      expired: record.expiresAt.getTime() <= now,
    }));
  }

  async revoke(userId: string, projectId: string, shareId: string) {
    await this.access.require(userId, projectId, "edit");
    const result = await this.database.studioShareLink.updateMany({
      where: { id: shareId, projectId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count !== 1) throw new NotFoundException("分享链接不存在或已撤销");
    return { ok: true };
  }

  async rotate(userId: string, projectId: string, shareId: string) {
    await this.access.require(userId, projectId, "edit");
    const existing = await this.database.studioShareLink.findFirst({
      where: { id: shareId, projectId },
      select: { id: true, targetType: true, styleRevisionId: true, studioDocumentId: true },
    });
    if (!existing) throw new NotFoundException("分享链接不存在");
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const updated = await this.database.studioShareLink.update({
      where: { id: existing.id },
      data: { tokenHash: hash(token), expiresAt, revokedAt: null },
    });
    return {
      expiresAt: updated.expiresAt,
      id: updated.id,
      path: `/review/${token}`,
      revisionId: existing.styleRevisionId ?? existing.studioDocumentId ?? "",
      targetType: existing.targetType,
    };
  }

  async publicView(token: string): Promise<StudioPublicShareView> {
    if (!TOKEN_PATTERN.test(token))
      throw new NotFoundException("分享不存在或已失效");
    const link = await this.database.studioShareLink.findFirst({
      where: {
        tokenHash: hash(token),
        revokedAt: null,
        expiresAt: { gt: new Date() },
        project: { deletedAt: null },
      },
      include: {
        project: { select: { id: true, name: true } },
        styleRevision: { include: { style: { select: { code: true } } } },
        studioDocument: true,
      },
    });
    if (!link) throw new NotFoundException("分享不存在或已失效");

    const target = await this.target(link);
    const views = await this.assetViews(link.projectId, target.views);
    const [reviews, comments] = await Promise.all([
      this.reviews(link.projectId, link.targetType, target.revisionId),
      this.comments(link.projectId, link.targetType, target.revisionId),
    ]);
    return {
      code: target.code,
      comments,
      expiresAt: link.expiresAt.toISOString(),
      projectName: link.project.name,
      revision: target.revision,
      reviews,
      status: target.status,
      styleRevisionId: target.styleRevisionId,
      targetType: link.targetType,
      title: target.title,
      views,
    };
  }

  async addPublicReview(token: string, body: unknown, requestKey: string) {
    const input = studioPublicReviewInputSchema.parse(body);
    const link = await this.database.studioShareLink.findFirst({
      where: {
        tokenHash: hash(token),
        revokedAt: null,
        expiresAt: { gt: new Date() },
        project: { deletedAt: null },
      },
      select: {
        ownerId: true,
        projectId: true,
        styleRevisionId: true,
        studioDocumentId: true,
        targetType: true,
      },
    });
    if (!link) throw new NotFoundException("分享不存在或已失效");
    const targetRevisionId = link.styleRevisionId ?? link.studioDocumentId;
    if (!targetRevisionId) throw new NotFoundException("分享目标已不存在");
    const name = input.reviewerName
      ? `公开评审 · ${input.reviewerName}`.slice(0, 120)
      : "公开评审";
    const payload = input.kind === "comment"
      ? studioCommentSchema.parse({
          ...(input.assetId ? { assetId: input.assetId } : {}),
          ...(input.x !== undefined ? { x: input.x } : {}),
          ...(input.y !== undefined ? { y: input.y } : {}),
          name,
          targetRevisionId,
          targetType: link.targetType,
          text: input.text,
        })
      : studioReviewSchema.parse({
          decision: input.decision,
          name,
          targetRevisionId,
          targetType: link.targetType,
          text: input.text,
        });
    const documentId = `public-review-${hash(`${token}\0${requestKey}`).slice(0, 48)}`;
    const existing = await this.database.studioDocument.findUnique({
      where: { documentId_revision: { documentId, revision: 1 } },
      select: { id: true },
    });
    if (existing) return { duplicate: true, ok: true };
    await this.database.studioDocument.create({
      data: {
        documentId,
        projectId: link.projectId,
        ownerId: link.ownerId,
        createdById: null,
        type: input.kind === "comment" ? "COMMENT" : "REVIEW",
        revision: 1,
        payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
      },
    });
    return { ok: true };
  }

  private async target(link: {
    targetType: StudioShareTarget;
    styleRevision: { id: string; revision: number; payload: Prisma.JsonValue; style: { code: string } } | null;
    studioDocument: { id: string; revision: number; payload: Prisma.JsonValue } | null;
  }) {
    if (link.targetType === StudioShareTarget.STYLE && link.styleRevision) {
      const payload = studioStyleSchema.parse(link.styleRevision.payload);
      const views = payload.views.length
        ? payload.views
        : [
            {
              assetId: payload.sourceAssetId,
              kind: "front" as const,
              label: "主视图",
              reviewed: false,
            },
          ];
      return {
        code: link.styleRevision.style.code,
        revision: link.styleRevision.revision,
        revisionId: link.styleRevision.id,
        status: payload.status,
        styleRevisionId: link.styleRevision.id,
        title: payload.name,
        views,
      };
    }
    if (link.targetType === StudioShareTarget.TECH_PACK && link.studioDocument) {
      const payload = studioTechPackSchema.parse(link.studioDocument.payload);
      return {
        code: null,
        revision: link.studioDocument.revision,
        revisionId: link.studioDocument.id,
        status: payload.status,
        styleRevisionId: payload.styleRevisionId,
        title: payload.name,
        views: payload.views,
      };
    }
    throw new NotFoundException("分享目标已不存在");
  }

  private async assetViews(
    projectId: string,
    views: readonly { assetId: string; kind: "front" | "back" | "detail"; label: string; reviewed: boolean }[],
  ): Promise<StudioShareAssetView[]> {
    const ids = [...new Set(views.map((view) => view.assetId))];
    const assets = await this.database.designAsset.findMany({
      where: { id: { in: ids }, projectId, archivedAt: null },
      select: { id: true, url: true, thumbnailUrl: true, width: true, height: true },
    });
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    return Promise.all(
      views.map(async (view) => {
        const asset = byId.get(view.assetId);
        if (!asset) throw new BadRequestException("评审图片已不可用");
        return {
          assetId: asset.id,
          height: asset.height,
          kind: view.kind,
          label: view.label || view.kind,
          reviewed: view.reviewed,
          thumbnailUrl: await this.signed(asset.thumbnailUrl ?? asset.url),
          url: await this.signed(asset.url),
          width: asset.width,
        };
      }),
    );
  }

  private async signed(value: string): Promise<string> {
    const key = objectKey(value);
    return key ? this.storage.createDownloadUrl(key, 5 * 60) : value;
  }

  private async reviews(projectId: string, targetType: StudioShareTarget, revisionId: string) {
    const documents = await this.database.studioDocument.findMany({
      where: { projectId, type: "REVIEW" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { payload: true, createdAt: true },
    });
    return documents.flatMap((document) => {
      const parsed = studioReviewSchema.safeParse(document.payload);
      if (!parsed.success || parsed.data.targetType !== targetType || parsed.data.targetRevisionId !== revisionId) return [];
      return [{ createdAt: document.createdAt.toISOString(), decision: parsed.data.decision, name: parsed.data.name, text: parsed.data.text }];
    });
  }

  private async comments(projectId: string, targetType: StudioShareTarget, revisionId: string) {
    const documents = await this.database.studioDocument.findMany({
      where: { projectId, type: "COMMENT" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { payload: true, createdAt: true },
    });
    return documents.flatMap((document) => {
      const parsed = studioCommentSchema.safeParse(document.payload);
      if (!parsed.success || parsed.data.targetType !== targetType || parsed.data.targetRevisionId !== revisionId) return [];
      return [{ createdAt: document.createdAt.toISOString(), name: parsed.data.name, text: parsed.data.text }];
    });
  }
}

