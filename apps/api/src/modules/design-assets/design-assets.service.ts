import {
  DesignAssetOperation,
  FileStatus,
  Prisma,
  type DesignAsset,
  type DesignAssetDecision,
  type PrismaClient,
} from "@fashion/db";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  DESIGN_PATH_MAX_ASSETS,
  type DesignDecisionView,
  type DesignPathStep,
  type DesignPathView,
  type DesignStepSnapshot,
} from "@fashion/shared";
import { S3FileStorage } from "../files/storage.service";
import {
  designDecisionSchema,
  designStepSnapshotSchema,
  type DesignDecisionInput,
} from "./design-path.schemas";

export const DESIGN_ASSETS_DB = Symbol("DESIGN_ASSETS_DB");

type DesignAssetDatabase = Pick<
  PrismaClient,
  "designAsset" | "designAssetDecision" | "fileAsset" | "project"
>;

interface OwnedDesignAsset extends DesignAsset {
  readonly project: {
    readonly deletedAt: Date | null;
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
        designStep: {
          create: {
            projectId,
            actor: "manual",
            tool: "imported",
            intent: "导入设计素材",
            inputSnapshot: {
              version: 1,
              sources: [
                {
                  elementId: file.id,
                  fileAssetId: file.id,
                  role: "import_source",
                  title: file.originalName,
                },
              ],
              constraints: {
                palette: [],
                notes: [],
                avoidLabels: [],
                fabricTerms: [],
              },
              parameters: {},
            },
          },
        },
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

  async path(userId: string, assetId: string): Promise<DesignPathView> {
    const target = await this.ownedAsset(userId, assetId);
    const pending = [assetId];
    const visited = new Set<string>();
    const available = new Set<string>();
    const steps = new Map<string, DesignPathStep>();
    let incomplete = false;
    while (pending.length && visited.size < DESIGN_PATH_MAX_ASSETS) {
      const id = pending.shift();
      if (!id) continue;
      if (visited.has(id)) continue;
      visited.add(id);
      const asset = await this.database.designAsset.findFirst({
        where: { id, projectId: target.projectId },
        include: {
          designStep: true,
          generationTask: {
            include: {
              designStep: true,
              generatedAssets: true,
              agentMessage: { select: { conversationId: true } },
              agentRunAttempt: {
                select: {
                  step: {
                    select: { run: { select: { conversationId: true } } },
                  },
                },
              },
            },
          },
        },
      });
      if (!asset) {
        incomplete = true;
        continue;
      }
      available.add(asset.id);
      const recorded = asset.designStep ?? asset.generationTask?.designStep;
      const parsed = designStepSnapshotSchema.safeParse(
        recorded?.inputSnapshot,
      );
      const fallbackSources = [
        ...(asset.parentAssetId
          ? [
              {
                elementId: asset.parentAssetId,
                assetId: asset.parentAssetId,
                role: "edit_source",
                title: "上一设计版本",
              },
            ]
          : []),
        ...(asset.restoredFromAssetId
          ? [
              {
                elementId: asset.restoredFromAssetId,
                assetId: asset.restoredFromAssetId,
                role: "restore_source",
                title: "恢复来源",
              },
            ]
          : []),
        ...(asset.sourceFileId
          ? [
              {
                elementId: asset.sourceFileId,
                fileAssetId: asset.sourceFileId,
                role: "import_source",
                title: "原始上传素材",
              },
            ]
          : []),
      ];
      const snapshot: DesignStepSnapshot = parsed.success
        ? parsed.data
        : {
            version: 1,
            sources: fallbackSources,
            constraints: {
              palette: [],
              notes: [],
              avoidLabels: [],
              fabricTerms: [],
            },
            parameters: {},
          };
      const outputs =
        asset.generationTask?.generatedAssets.filter(
          (output) => output.projectId === target.projectId,
        ) ?? [];
      for (const output of outputs) available.add(output.id);
      const stepId = recorded?.id ?? `legacy:${asset.id}`;
      steps.set(stepId, {
        ...snapshot,
        id: stepId,
        tool: recorded?.tool ?? asset.operation.toLowerCase(),
        actor: recorded?.actor ?? "legacy",
        intent: recorded?.intent ?? "历史资产，仅保留已有血缘信息",
        createdAt: (recorded?.createdAt ?? asset.createdAt).toISOString(),
        status: asset.generationTask?.status.toLowerCase() ?? "succeeded",
        snapshotAvailable: parsed.success,
        outputs: (outputs.length ? outputs : [asset]).map((output) =>
          this.toView(output),
        ),
        conversationId:
          asset.generationTask?.agentMessage?.conversationId ??
          asset.generationTask?.agentRunAttempt?.step.run.conversationId ??
          null,
      });
      const dependencies = [
        asset.parentAssetId,
        asset.restoredFromAssetId,
        ...snapshot.sources.map((source) => source.assetId),
      ];
      for (const dependency of dependencies) {
        if (dependency && !visited.has(dependency)) pending.push(dependency);
      }
    }
    if (pending.some((id) => !visited.has(id))) incomplete = true;
    const decisions = await this.database.designAssetDecision.findMany({
      where: { assetId: { in: [...available] }, userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    });
    const ordered = orderDesignSteps([...steps.values()]);
    return {
      assetId,
      steps: ordered.steps,
      decisions: decisions.map(decisionView),
      incomplete: incomplete || ordered.cyclic,
    };
  }

  async decide(
    userId: string,
    assetId: string,
    input: DesignDecisionInput,
  ): Promise<DesignDecisionView> {
    await this.ownedAsset(userId, assetId);
    const parsed = designDecisionSchema.parse(input);
    const decision = await this.database.designAssetDecision
      .upsert({
        where: {
          assetId_clientRequestId: {
            assetId,
            clientRequestId: parsed.clientRequestId,
          },
        },
        update: {},
        create: { ...parsed, assetId, userId },
      })
      .catch((error: unknown) => {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== "P2002"
        )
          throw error;
        return this.database.designAssetDecision.findUniqueOrThrow({
          where: {
            assetId_clientRequestId: {
              assetId,
              clientRequestId: parsed.clientRequestId,
            },
          },
        });
      });
    if (
      decision.kind !== parsed.kind ||
      decision.reason !== parsed.reason ||
      decision.userId !== userId
    ) {
      throw new ConflictException({
        code: "DECISION_REQUEST_REUSED",
        message: "该请求已用于另一项设计决策，请刷新后重试",
      });
    }
    return decisionView(decision);
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
        designStep: {
          create: {
            projectId: current.projectId,
            tool: "restore",
            actor: "manual",
            intent: "恢复已有结果为新版本",
            inputSnapshot: {
              version: 1,
              sources: [
                {
                  elementId: current.id,
                  assetId: current.id,
                  role: "edit_source",
                  title: "恢复前版本",
                },
                {
                  elementId: target.id,
                  assetId: target.id,
                  role: "restore_source",
                  title: "恢复来源",
                },
              ],
              constraints: {
                palette: [],
                notes: [],
                avoidLabels: [],
                fabricTerms: [],
              },
              parameters: {},
            },
          },
        },
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
            deletedAt: true,
            workspace: { select: { ownerId: true } },
          },
        },
      },
    });
    if (!asset || asset.project.deletedAt) {
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

function orderDesignSteps(steps: DesignPathStep[]): {
  steps: DesignPathStep[];
  cyclic: boolean;
} {
  const byAsset = new Map(
    steps.flatMap((step) =>
      step.outputs.map((output) => [output.id, step] as const),
    ),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: DesignPathStep[] = [];
  let cyclic = false;
  const visit = (step: DesignPathStep) => {
    if (visited.has(step.id)) return;
    if (visiting.has(step.id)) {
      cyclic = true;
      return;
    }
    visiting.add(step.id);
    const sourceIds = [
      ...step.sources.map((source) => source.assetId),
      ...step.outputs.map((output) => output.parentAssetId),
    ];
    for (const id of sourceIds) {
      const source = id ? byAsset.get(id) : undefined;
      if (source) visit(source);
    }
    visiting.delete(step.id);
    visited.add(step.id);
    ordered.push(step);
  };
  steps
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )
    .forEach(visit);
  return { steps: ordered, cyclic };
}

function decisionView(decision: DesignAssetDecision): DesignDecisionView {
  return {
    id: decision.id,
    assetId: decision.assetId,
    kind: designDecisionSchema.shape.kind.parse(decision.kind),
    reason: decision.reason,
    createdAt: decision.createdAt.toISOString(),
  };
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
