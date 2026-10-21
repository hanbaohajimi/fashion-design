import {
  Prisma,
  type Style,
  type StyleRevision,
  type StudioDocument,
} from "@fashion/db";
import {
  createStudioStyleSchema,
  updateStudioStyleSchema,
  studioStyleSchema,
  studioDocumentInputSchema,
  studioTechPackSchema,
  studioBrandSchema,
  studioBrandImportSchema,
  studioPublishIssues,
  studioMemberCreateSchema,
  studioMemberUpdateSchema,
  studioMemberDeleteSchema,
  type StudioDocumentInput,
  type StudioDocumentView,
  type StudioStyleView,
  type StudioSummary,
  type StudioAssetView,
} from "@fashion/shared";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { ZodType } from "zod";
import {
  ProjectAccessPolicy,
  STUDIO_DB,
  type StudioDatabase,
  type ProjectAction,
} from "./project-access.policy";

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const conflict = () =>
  new ConflictException({
    code: "REVISION_CONFLICT",
    message: "资料已更新，请刷新后基于最新版本提交",
  });
function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException({
      code: "INVALID_STUDIO_INPUT",
      message: result.error.issues.map((issue) => issue.message).join("；"),
    });
  return result.data;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
@Injectable()
export class StudioService {
  constructor(
    @Inject(STUDIO_DB) private readonly database: StudioDatabase,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy,
  ) {}

  private async assets(projectId: string): Promise<StudioAssetView[]> {
    const rows = await this.database.designAsset.findMany({
      where: { projectId },
      select: { id: true, url: true, thumbnailUrl: true },
      orderBy: { createdAt: "desc" },
    });
    // Resolve short-lived storage signatures only when the image is requested.
    // Stable app URLs also recheck current membership after a long editing session.
    return rows.map((row) => {
      const base = "/api/design-assets/" + encodeURIComponent(row.id);
      return {
        id: row.id,
        url: base + "/content",
        thumbnailUrl: row.thumbnailUrl ? base + "/thumbnail" : null,
      };
    });
  }
  private styleView(
    style: Style & { revisions: StyleRevision[] },
    assets: StudioAssetView[],
  ): StudioStyleView {
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const revisions = style.revisions.map((row) => {
      const payload = parse(studioStyleSchema, row.payload);
      return {
        id: row.id,
        revision: row.revision,
        payload,
        createdAt: row.createdAt.toISOString(),
        views: payload.views.map((view) => ({
          ...view,
          url: byId.get(view.assetId)?.url ?? "",
          thumbnailUrl: byId.get(view.assetId)?.thumbnailUrl ?? null,
        })),
      };
    });
    const currentRevision = revisions[0];
    if (!currentRevision) throw new ConflictException("款式缺少修订记录");
    return {
      id: style.id,
      code: style.code,
      name: style.name,
      category: style.category,
      season: style.season,
      status: style.status,
      version: style.version,
      currentRevision,
      revisions,
    };
  }
  private documentView(rows: StudioDocument[]): StudioDocumentView {
    const first = rows[0];
    if (!first) throw new NotFoundException("资料不存在");
    return {
      id: first.documentId,
      type: first.type,
      version: first.revision,
      currentRevision: this.revisionView(first),
      revisions: rows.map((row) => this.revisionView(row)),
    };
  }
  private revisionView(row: StudioDocument) {
    const parsed = parse(studioDocumentInputSchema, {
      type: row.type,
      payload: row.payload,
      requestKey: "stored-document",
    });
    return {
      id: row.id,
      revision: row.revision,
      payload: parsed.payload,
      createdAt: row.createdAt.toISOString(),
      createdById: row.createdById,
    };
  }
  async summary(userId: string, projectId: string): Promise<StudioSummary> {
    const permission = await this.access.require(userId, projectId);
    const [styles, docs, members, collections, assets] = await Promise.all([
      this.database.style.findMany({
        where: { projectId },
        include: { revisions: { orderBy: { revision: "desc" } } },
        orderBy: { updatedAt: "desc" },
      }),
      this.database.studioDocument.findMany({
        where: {
          projectId,
          OR: [{ type: { not: "BRAND_PROFILE" } }, { ownerId: userId }],
        },
        orderBy: { revision: "desc" },
      }),
      this.database.workspaceMember.findMany({
        where: { workspaceId: permission.workspaceId },
        include: { user: { select: { email: true } } },
      }),
      this.database.collection.findMany({
        where: { projectId },
        select: { id: true, name: true },
      }),
      this.assets(projectId),
    ]);
    const grouped = new Map<string, StudioDocument[]>();
    for (const doc of docs) {
      const group = grouped.get(doc.documentId) ?? [];
      group.push(doc);
      grouped.set(doc.documentId, group);
    }
    const views = Array.from(grouped.values()).map((rows) =>
      this.documentView(rows),
    );
    const ofType = (type: StudioDocumentInput["type"]) =>
      views.filter((view) => view.type === type);
    return {
      role: permission.role,
      capabilities: permission.capabilities,
      styles: styles.map((style) => this.styleView(style, assets)),
      brandProfiles: ofType("BRAND_PROFILE"),
      slots: ofType("COLLECTION_SLOT"),
      techPacks: ofType("TECH_PACK"),
      samples: ofType("SAMPLE_ROUND"),
      comments: ofType("COMMENT"),
      reviews: ofType("REVIEW"),
      patterns: ofType("PRINT_PATTERN"),
      presentationSets: ofType("PRESENTATION_SET"),
      members: members.map((member) => ({
        id: member.id,
        userId: member.userId,
        email: member.user.email,
        role: member.role,
        version: member.version,
      })),
      collections,
      assets,
    };
  }
  async brandLibrary(
    userId: string,
    projectId: string,
  ): Promise<StudioDocumentView[]> {
    await this.access.require(userId, projectId, "read");
    const rows = await this.database.studioDocument.findMany({
      where: {
        ownerId: userId,
        type: "BRAND_PROFILE",
        projectId: { not: projectId },
        project: {
          deletedAt: null,
          workspace: {
            OR: [{ ownerId: userId }, { members: { some: { userId } } }],
          },
        },
      },
      orderBy: [{ documentId: "asc" }, { revision: "desc" }],
      distinct: ["documentId"],
      take: 100,
    });
    return rows.map((row) =>
      this.documentView([
        {
          ...row,
          payload: json({
            ...parse(studioBrandSchema, row.payload),
            referenceAssetIds: [],
          }) as Prisma.JsonValue,
        },
      ]),
    );
  }
  async importBrand(userId: string, projectId: string, body: unknown) {
    const input = parse(studioBrandImportSchema, body);
    await this.access.require(userId, projectId, "edit");
    const source = await this.database.studioDocument.findFirst({
      where: { id: input.revisionId, ownerId: userId, type: "BRAND_PROFILE" },
    });
    if (!source) throw new NotFoundException("品牌资料不存在或不属于本人");
    await this.access.require(userId, source.projectId, "read");
    const brand = parse(studioBrandSchema, source.payload);
    return this.saveDocument(userId, projectId, {
      type: "BRAND_PROFILE",
      requestKey: input.requestKey,
      payload: {
        ...brand,
        referenceAssetIds: [],
        copiedFromRevisionId: source.id,
      },
    });
  }
  private async mutate<T extends object>(
    userId: string,
    projectId: string,
    requestKey: string,
    operation: string,
    input: unknown,
    action: ProjectAction,
    execute: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const fingerprint = createHash("sha256")
      .update(canonical({ operation, input }))
      .digest("hex");
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            await this.access.require(userId, projectId, action, tx);
            const existing = await tx.studioMutation.findUnique({
              where: {
                projectId_userId_requestKey: { projectId, userId, requestKey },
              },
            });
            if (existing) {
              if (existing.fingerprint !== fingerprint)
                throw new ConflictException({
                  code: "IDEMPOTENCY_KEY_REUSED",
                  message: "相同请求键不能用于不同操作或参数",
                });
              return existing.result as T;
            }
            const result = await execute(tx);
            await tx.studioMutation.create({
              data: {
                projectId,
                userId,
                requestKey,
                fingerprint,
                result: json(result),
              },
            });
            return result;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === "P2034" || error.code === "P2002")
        ) {
          if (attempt < 2) continue;
          throw conflict();
        }
        throw error;
      }
    }
    throw conflict();
  }
  private async assertAssets(
    tx: Prisma.TransactionClient,
    projectId: string,
    assetIds: string[],
  ) {
    const ids = [...new Set(assetIds)];
    if (!ids.length) return;
    const count = await tx.designAsset.count({
      where: { id: { in: ids }, projectId },
    });
    if (count !== ids.length)
      throw new BadRequestException({
        code: "ASSET_PROJECT_MISMATCH",
        message: "图片不存在或不属于此项目",
      });
  }
  private async getStyle(projectId: string, styleId: string) {
    const row = await this.database.style.findFirst({
      where: { id: styleId, projectId },
      include: { revisions: { orderBy: { revision: "desc" } } },
    });
    if (!row) throw new NotFoundException("款式不存在");
    return this.styleView(row, await this.assets(projectId));
  }
  async createStyle(userId: string, projectId: string, body: unknown) {
    const { requestKey, ...payload } = parse(createStudioStyleSchema, body);
    const result = await this.mutate(
      userId,
      projectId,
      requestKey,
      "create-style",
      payload,
      "edit",
      async (tx) => {
        await this.assertAssets(tx, projectId, [
          payload.sourceAssetId,
          ...payload.views.map((view) => view.assetId),
        ]);
        if (payload.status === "APPROVED")
          throw new BadRequestException("请先保存款式，再提交绑定修订的评审");
        const style = await tx.style.create({
          data: {
            projectId,
            name: payload.name,
            code: payload.code,
            category: payload.category,
            season: payload.season,
            status: payload.status,
          },
        });
        await tx.styleRevision.create({
          data: {
            styleId: style.id,
            revision: 1,
            sourceAssetId: payload.sourceAssetId,
            createdBy: userId,
            payload: json(payload),
          },
        });
        return { id: style.id };
      },
    );
    return this.getStyle(projectId, result.id);
  }
  async updateStyle(
    userId: string,
    projectId: string,
    styleId: string,
    body: unknown,
  ) {
    const { requestKey, expectedVersion, ...payload } = parse(
      updateStudioStyleSchema,
      body,
    );
    const result = await this.mutate(
      userId,
      projectId,
      requestKey,
      "update-style:" + styleId,
      { expectedVersion, payload },
      "edit",
      async (tx) => {
        await this.assertAssets(tx, projectId, [
          payload.sourceAssetId,
          ...payload.views.map((view) => view.assetId),
        ]);
        if (payload.status === "APPROVED")
          throw new BadRequestException("新修订需要重新评审，请先选择待评审");
        const changed = await tx.style.updateMany({
          where: { id: styleId, projectId, version: expectedVersion },
          data: {
            name: payload.name,
            code: payload.code,
            category: payload.category,
            season: payload.season,
            status: payload.status,
            version: { increment: 1 },
          },
        });
        if (!changed.count) throw conflict();
        await tx.styleRevision.create({
          data: {
            styleId,
            revision: expectedVersion + 1,
            sourceAssetId: payload.sourceAssetId,
            createdBy: userId,
            payload: json(payload),
          },
        });
        return { id: styleId };
      },
    );
    return this.getStyle(projectId, result.id);
  }
  private async target(
    tx: Prisma.TransactionClient,
    projectId: string,
    type: "STYLE" | "TECH_PACK",
    revisionId: string,
  ): Promise<{ assetIds: string[]; styleRevisionId: string }> {
    if (type === "STYLE") {
      const row = await tx.styleRevision.findFirst({
        where: { id: revisionId, style: { projectId } },
      });
      if (!row) throw new BadRequestException("款式修订不存在或不属于项目");
      const payload = parse(studioStyleSchema, row.payload);
      return {
        assetIds: [
          payload.sourceAssetId,
          ...payload.views.map((view) => view.assetId),
        ],
        styleRevisionId: row.id,
      };
    }
    const row = await tx.studioDocument.findFirst({
      where: { id: revisionId, projectId, type: "TECH_PACK" },
    });
    if (!row) throw new BadRequestException("技术包修订不存在或不属于项目");
    const payload = parse(studioTechPackSchema, row.payload);
    return {
      assetIds: payload.views.map((view) => view.assetId),
      styleRevisionId: payload.styleRevisionId,
    };
  }
  async saveDocument(userId: string, projectId: string, body: unknown) {
    const input = parse(studioDocumentInputSchema, body);
    const result = await this.mutate(
      userId,
      projectId,
      input.requestKey,
      "save-document",
      input,
      input.type === "COMMENT" ||
        input.type === "SAMPLE_ROUND" ||
        (input.type === "TECH_PACK" && input.payload.status === "PUBLISHED")
        ? "read"
        : input.type === "REVIEW"
          ? "review"
          : "edit",
      async (tx) => {
        if (input.type === "COMMENT") {
          const access = await this.access.require(
            userId,
            projectId,
            "read",
            tx,
          );
          if (!access.capabilities.edit && !access.capabilities.review)
            throw new ForbiddenException("当前角色没有批注权限");
        }
        const previous = input.documentId
          ? await tx.studioDocument.findFirst({
              where: { documentId: input.documentId, projectId },
              orderBy: { revision: "desc" },
            })
          : null;
        if (
          input.documentId &&
          (!previous || previous.revision !== input.expectedVersion)
        )
          throw conflict();
        if (previous && previous.type !== input.type)
          throw new BadRequestException("不能更换资料类型");
        if (previous?.type === "BRAND_PROFILE" && previous.ownerId !== userId)
          throw new ForbiddenException("品牌资料为个人私有");
        let styleRevisionId: string | undefined;
        let collectionId: string | undefined;
        switch (input.type) {
          case "PRESENTATION_SET":
            styleRevisionId = (
              await this.target(
                tx,
                projectId,
                "STYLE",
                input.payload.styleRevisionId,
              )
            ).styleRevisionId;
            await this.assertAssets(
              tx,
              projectId,
              input.payload.items.map((item) => item.assetId),
            );
            break;
          case "PRINT_PATTERN":
            await this.assertAssets(tx, projectId, [
              input.payload.sourceAssetId,
            ]);
            break;
          case "BRAND_PROFILE":
            await this.assertAssets(
              tx,
              projectId,
              input.payload.referenceAssetIds,
            );
            break;
          case "COLLECTION_SLOT": {
            const collection = await tx.collection.findFirst({
              where: { id: input.payload.collectionId, projectId },
            });
            if (!collection)
              throw new BadRequestException("系列不存在或不属于项目");
            collectionId = collection.id;
            if (input.payload.styleRevisionId)
              styleRevisionId = (
                await this.target(
                  tx,
                  projectId,
                  "STYLE",
                  input.payload.styleRevisionId,
                )
              ).styleRevisionId;
            if (input.payload.status === "DONE" && !styleRevisionId)
              throw new BadRequestException("完成的规划位置需要关联款式修订");
            break;
          }
          case "TECH_PACK": {
            styleRevisionId = (
              await this.target(
                tx,
                projectId,
                "STYLE",
                input.payload.styleRevisionId,
              )
            ).styleRevisionId;
            await this.assertAssets(tx, projectId, [
              ...input.payload.views.map((view) => view.assetId),
              ...input.payload.annotations.map(
                (annotation) => annotation.assetId,
              ),
            ]);
            if (
              input.payload.annotations.some(
                (annotation) =>
                  !input.payload.views.some(
                    (view) => view.assetId === annotation.assetId,
                  ),
              )
            )
              throw new BadRequestException("工艺标注必须绑定当前技术包视图");
            if (input.payload.status === "PUBLISHED") {
              const reviewer = await this.access.require(
                userId,
                projectId,
                "review",
                tx,
              );
              if (!reviewer.capabilities.edit) {
                const oldPayload = previous
                  ? parse(studioTechPackSchema, previous.payload)
                  : null;
                if (
                  !oldPayload ||
                  canonical({
                    ...oldPayload,
                    status: "DRAFT",
                    reviewConfirmed: false,
                  }) !==
                    canonical({
                      ...input.payload,
                      status: "DRAFT",
                      reviewConfirmed: false,
                    })
                )
                  throw new ForbiddenException(
                    "评审者只能发布已有且内容未改动的技术包修订",
                  );
              }
              const issues = studioPublishIssues(input.payload);
              if (issues.length)
                throw new BadRequestException({
                  code: "TECH_PACK_REVIEW_REQUIRED",
                  message: issues.join("；"),
                });
            }
            break;
          }
          case "SAMPLE_ROUND": {
            styleRevisionId = (
              await this.target(
                tx,
                projectId,
                "TECH_PACK",
                input.payload.techPackRevisionId,
              )
            ).styleRevisionId;
            await this.assertAssets(tx, projectId, input.payload.photoAssetIds);
            let oldPayload:
              | Extract<
                  StudioDocumentInput,
                  { type: "SAMPLE_ROUND" }
                >["payload"]
              | null = null;
            if (previous) {
              const old = parse(studioDocumentInputSchema, {
                type: "SAMPLE_ROUND",
                requestKey: "previous-sample",
                payload: previous.payload,
              });
              if (old.type !== "SAMPLE_ROUND")
                throw new BadRequestException("打样记录格式错误");
              oldPayload = old.payload;
              if (
                oldPayload.techPackRevisionId !==
                  input.payload.techPackRevisionId ||
                oldPayload.round !== input.payload.round
              )
                throw new BadRequestException(
                  "打样轮次及其技术包修订固定，新轮次请另建记录",
                );
            }
            const permission = await this.access.require(
              userId,
              projectId,
              "read",
              tx,
            );
            if (!permission.capabilities.edit) {
              if (!permission.capabilities.review || !oldPayload)
                throw new ForbiddenException("当前角色不能编辑样衣资料");
              const previousIssues = new Map(
                oldPayload.issues.map((issue) => [issue.id, issue]),
              );
              const withoutStatus = (value: typeof input.payload) => ({
                ...value,
                issues: value.issues.map((issue) => ({
                  ...issue,
                  status: "OPEN",
                })),
              });
              if (
                canonical(withoutStatus(oldPayload)) !==
                  canonical(withoutStatus(input.payload)) ||
                input.payload.issues.some((issue) => {
                  const old = previousIssues.get(issue.id);
                  return (
                    !old ||
                    (old.status !== issue.status &&
                      !(old.status === "FIXED" && issue.status === "VERIFIED"))
                  );
                })
              )
                throw new ForbiddenException(
                  "评审者只能将已解决问题标记为已复核",
                );
            }
            const oldById = new Map(
              oldPayload?.issues.map((issue) => [issue.id, issue]) ?? [],
            );
            const newById = new Map(
              input.payload.issues.map((issue) => [issue.id, issue]),
            );
            const verificationChanged =
              input.payload.issues.some(
                (issue) =>
                  issue.status === "VERIFIED" &&
                  canonical(issue) !== canonical(oldById.get(issue.id)),
              ) ||
              (oldPayload?.issues.some(
                (issue) =>
                  issue.status === "VERIFIED" &&
                  canonical(issue) !== canonical(newById.get(issue.id)),
              ) ??
                false);
            if (verificationChanged)
              await this.access.require(userId, projectId, "review", tx);
            for (const issue of input.payload.issues)
              if (issue.assigneeId)
                await this.access.require(
                  issue.assigneeId,
                  projectId,
                  "read",
                  tx,
                );
            break;
          }
          case "COMMENT":
          case "REVIEW": {
            const target = await this.target(
              tx,
              projectId,
              input.payload.targetType,
              input.payload.targetRevisionId,
            );
            styleRevisionId = target.styleRevisionId;
            if (
              input.type === "COMMENT" &&
              input.payload.assetId &&
              !target.assetIds.includes(input.payload.assetId)
            )
              throw new BadRequestException("批注图片必须属于目标修订");
            if (previous)
              throw new BadRequestException(
                "评审与批注记录不可改写，请新增记录",
              );
            if (
              input.type === "REVIEW" &&
              input.payload.targetType === "STYLE"
            ) {
              const revision = await tx.styleRevision.findUnique({
                where: { id: input.payload.targetRevisionId },
              });
              if (revision)
                await tx.style.updateMany({
                  where: { id: revision.styleId, version: revision.revision },
                  data: {
                    status:
                      input.payload.decision === "APPROVED"
                        ? "APPROVED"
                        : "REVIEW",
                  },
                });
            }
            break;
          }
        }
        const documentId = previous?.documentId ?? randomUUID();
        await tx.studioDocument.create({
          data: {
            documentId,
            projectId,
            ownerId: previous?.ownerId ?? userId,
            createdById: userId,
            type: input.type,
            revision: (previous?.revision ?? 0) + 1,
            payload: json(input.payload),
            collectionId: collectionId ?? null,
            styleRevisionId: styleRevisionId ?? null,
          },
        });
        return { id: documentId };
      },
    );
    return this.documentView(
      await this.database.studioDocument.findMany({
        where: { documentId: result.id, projectId },
        orderBy: { revision: "desc" },
      }),
    );
  }
  async createMember(userId: string, projectId: string, body: unknown) {
    const input = parse(studioMemberCreateSchema, body);
    return this.mutate(
      userId,
      projectId,
      input.requestKey,
      "create-member",
      input,
      "manage",
      async (tx) => {
        const permission = await this.access.require(
          userId,
          projectId,
          "manage",
          tx,
        );
        const user = await tx.user.findFirst({
          where: {
            email: { equals: input.email, mode: "insensitive" },
            deletedAt: null,
          },
        });
        if (!user)
          throw new NotFoundException("请先让该成员注册，再添加已有账号");
        if (user.id === permission.ownerId)
          throw new BadRequestException("工作区所有者无需添加为成员");
        const existing = await tx.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: permission.workspaceId,
              userId: user.id,
            },
          },
        });
        if (existing)
          throw new ConflictException("该用户已是成员，请更新现有角色");
        const member = await tx.workspaceMember.create({
          data: {
            workspaceId: permission.workspaceId,
            userId: user.id,
            role: input.role,
          },
        });
        return {
          id: member.id,
          userId: member.userId,
          email: user.email,
          role: member.role,
          version: member.version,
        };
      },
    );
  }
  async updateMember(
    userId: string,
    projectId: string,
    memberId: string,
    body: unknown,
    remove = false,
  ) {
    const input = remove
      ? parse(studioMemberDeleteSchema, body)
      : parse(studioMemberUpdateSchema, body);
    return this.mutate(
      userId,
      projectId,
      input.requestKey,
      (remove ? "remove-member:" : "update-member:") + memberId,
      input,
      "manage",
      async (tx) => {
        const permission = await this.access.require(
          userId,
          projectId,
          "manage",
          tx,
        );
        const where = {
          id: memberId,
          workspaceId: permission.workspaceId,
          version: input.expectedVersion,
        };
        if (remove) {
          const result = await tx.workspaceMember.deleteMany({ where });
          if (!result.count) throw conflict();
          return { id: memberId, removed: true };
        }
        const role = parse(studioMemberUpdateSchema, body).role;
        const result = await tx.workspaceMember.updateMany({
          where,
          data: { role, version: { increment: 1 } },
        });
        if (!result.count) throw conflict();
        return { id: memberId, version: input.expectedVersion + 1, role };
      },
    );
  }
  async exportTechPack(userId: string, projectId: string, revisionId: string) {
    await this.access.require(userId, projectId);
    const row = await this.database.studioDocument.findFirst({
      where: { id: revisionId, projectId, type: "TECH_PACK" },
    });
    if (!row) throw new NotFoundException("技术包修订不存在");
    const payload = parse(studioTechPackSchema, row.payload);
    const style = await this.database.styleRevision.findUnique({
      where: { id: payload.styleRevisionId },
      include: { style: true },
    });
    if (!style) throw new NotFoundException("款式修订不存在");
    const assets = await this.assets(projectId);
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const e = (value: unknown) =>
      String(value ?? "待确认").replace(
        /[&<>"']/g,
        (char) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[char] ?? char,
      );
    const table = (headers: string[], rows: unknown[][]) =>
      "<table><thead><tr>" +
      headers.map((item) => "<th>" + e(item) + "</th>").join("") +
      "</tr></thead><tbody>" +
      rows
        .map(
          (cells) =>
            "<tr>" +
            cells.map((cell) => "<td>" + e(cell) + "</td>").join("") +
            "</tr>",
        )
        .join("") +
      "</tbody></table>";
    return (
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>' +
      e(payload.name) +
      '</title><style>@page{size:A4;margin:16mm}body{font-family:Arial,"Microsoft YaHei",sans-serif;color:#222;font-size:12px;line-height:1.6}h1{font-size:26px}h2{margin-top:28px}table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{padding:8px;border:1px solid #ddd;overflow-wrap:anywhere}thead{display:table-header-group}tr,figure{break-inside:avoid}figure{display:inline-block;width:42%;margin:3%}img{width:100%;max-height:340px;object-fit:contain}.draft{border:2px solid #c78c43;padding:12px}button{padding:10px 20px}@media print{button{display:none}}</style><body><button onclick="window.print()">打印 / 保存 PDF</button><h1>' +
      e(payload.name) +
      "</h1><p>" +
      e(style.style.code) +
      " · 款式修订 " +
      style.revision +
      " · 技术包修订 " +
      row.revision +
      '</p><p class="draft">' +
      (payload.status === "DRAFT"
        ? "草稿 · 包含待确认资料，不可直接作为生产依据"
        : "已发布 · 人工复核完成") +
      "</p><h2>视图</h2>" +
      payload.views
        .map(
          (view) =>
            '<figure><img src="' +
            e(byId.get(view.assetId)?.url ?? "") +
            '"><figcaption>' +
            e(view.kind) +
            " " +
            e(view.label) +
            (view.reviewed ? " · 已复核" : " · 待复核") +
            "</figcaption></figure>",
        )
        .join("") +
      "<h2>工艺标注</h2>" +
      table(
        ["图片 / 位置", "说明", "复核"],
        payload.annotations.map((a) => [
          a.assetId + " (" + a.x + ", " + a.y + ")",
          a.text,
          a.reviewed ? "已复核" : "待复核",
        ]),
      ) +
      "<h2>配色</h2>" +
      table(
        ["名称", "色值", "复核"],
        payload.colors.map((c) => [
          c.name,
          c.hex,
          c.reviewed ? "已复核" : "待复核",
        ]),
      ) +
      "<h2>BOM</h2>" +
      table(
        ["项目", "材料", "用量", "单位", "供应商", "来源 / 复核"],
        payload.bom.map((b) => [
          b.name,
          b.material,
          b.quantity,
          b.unit,
          b.supplier,
          b.source + " / " + (b.reviewed ? "已复核" : "待复核"),
        ]),
      ) +
      "<h2>POM</h2>" +
      table(
        ["测量部位", "尺寸", "单位", "公差", "来源 / 复核"],
        payload.pom.map((p) => [
          p.name,
          p.value,
          p.unit,
          p.tolerance,
          p.source + " / " + (p.reviewed ? "已复核" : "待复核"),
        ]),
      ) +
      "<h2>工艺说明</h2><p>" +
      e(payload.constructionNotes) +
      "</p><h2>修订记录</h2><p>绑定款式修订 " +
      e(payload.styleRevisionId) +
      "<br>技术包修订 " +
      e(row.id) +
      "<br>保存时间 " +
      e(row.createdAt.toISOString()) +
      "</p></body></html>"
    );
  }
}
