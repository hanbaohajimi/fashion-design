import {
  CollectionVariationAxis,
  GenerationTaskStatus,
  Prisma,
  appendGenerationTerminalOutbox,
  type PrismaClient,
} from "@fashion/db";
import type { AiGenerationRequest } from "@fashion/ai";
import type { DesignStepSnapshot } from "@fashion/shared";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";

import { GenerationLimitExceededException } from "../billing/billing.errors";
import type { CompiledGenInput } from "./compiler/compiler.types";
import { BillingService } from "../billing/billing.service";
import { S3FileStorage } from "../files/storage.service";
import {
  ContextCompilerService,
  type ContextCompilerOptions,
} from "./compiler/context-compiler.service";
import {
  generationCreateRequestSchema,
  type GenerationCreateRequest,
  type GenerationListQuery,
} from "./generation.schemas";

export const GENERATION_DB = Symbol("GENERATION_DB");
export const GENERATION_JOBS = Symbol("GENERATION_JOBS");
const STYLE_REFERENCE_STRENGTH = 0.72;
const SILHOUETTE_REFERENCE_STRENGTH = 0.55;
const FABRIC_REFERENCE_STRENGTH = 0.7;
const DETAIL_REFERENCE_STRENGTH = 0.65;
const PALETTE_REFERENCE_STRENGTH = 0.6;
const PRESENTATION_POLICY_VERSION = 1;
const GARMENT_ONLY_POSITIVE_CONSTRAINT =
  "Presentation constraint, highest priority: create a garment-only design or product image. " +
  "Show the garment without any human wearer. Use an isolated garment, flat lay, hanger, " +
  "dress form, ghost mannequin, or technical fashion illustration as appropriate. " +
  "Do not use on-model, try-on, portrait, runway-model, or lifestyle-model presentation.";
const GARMENT_ONLY_NEGATIVE_TERMS = [
  "human",
  "person",
  "people",
  "fashion model",
  "wearer",
  "model wearing garment",
  "try-on",
  "on-body clothing",
  "portrait",
  "face",
  "head",
  "hands",
  "arms",
  "legs",
  "visible skin",
  "runway model",
  "lifestyle fashion photography",
] as const;

type PresentationMode = "garment_only" | "on_model" | "preserve_source";

interface PresentationPolicy {
  readonly matchedSignals: readonly string[];
  readonly mode: PresentationMode;
  readonly version: typeof PRESENTATION_POLICY_VERSION;
}

type GenerationDatabase = Pick<PrismaClient, "$transaction" | "designAsset" | "generationTask">;

export interface GenerationJobs {
  enqueue(taskId: string, userId: string): Promise<void>;
  cancel(taskId: string): Promise<void>;
}

export interface GenerationTaskView {
  readonly id: string;
  readonly status: Lowercase<keyof typeof GenerationTaskStatus>;
  readonly taskType: string;
  readonly request: GenerationCreateRequest | null;
  readonly compiledPrompt: unknown;
  readonly output: unknown;
  readonly error: {
    readonly code: string;
    readonly message: string;
  } | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface GenerationTaskListView {
  readonly items: readonly GenerationTaskView[];
  readonly nextCursor: string | null;
}

export interface CollectionGenerationContext {
  readonly collectionId: string;
  readonly garmentTypeCode?: string;
  readonly garmentTypeLabel?: string;
  readonly slotKey?: string;
  readonly variationAxis: CollectionVariationAxis;
}

interface ExistingGenerationTask {
  readonly compiledPrompt: Prisma.JsonValue | null;
  readonly id: string;
  readonly status: GenerationTaskStatus;
  readonly userId: string;
}

type GenerationAdmission =
  | { readonly kind: "created"; readonly taskId: string }
  | { readonly kind: "denied" }
  | { readonly kind: "existing"; readonly task: ExistingGenerationTask };

@Injectable()
export class GenerationService {
  constructor(
    @Inject(GENERATION_DB) private readonly database: GenerationDatabase,
    @Inject(GENERATION_JOBS) private readonly jobs: GenerationJobs,
    @Inject(BillingService) private readonly billingService: BillingService,
    @Inject(ContextCompilerService)
    private readonly compiler: ContextCompilerService,
    @Inject(S3FileStorage)
    private readonly storage: S3FileStorage,
  ) {}

  async create(
    userId: string,
    request: GenerationCreateRequest,
    idempotencyKey: string = randomUUID(),
    rawUserIntent: string = request.prompt,
  ): Promise<{ taskId: string }> {
    return this.createTask(
      userId,
      request,
      idempotencyKey,
      undefined,
      rawUserIntent,
    );
  }

  async createFromAgent(
    userId: string,
    request: GenerationCreateRequest,
    idempotencyKey: string,
    rawUserIntent: string,
    frozenCompiled?: CompiledGenInput,
  ): Promise<{ taskId: string }> {
    return this.createTask(
      userId,
      request,
      idempotencyKey,
      undefined,
      rawUserIntent,
      { modelCalls: "skip" },
      frozenCompiled,
    );
  }

  async resumeQueuedTask(userId: string, taskId: string): Promise<void> {
    const task = await this.database.generationTask.findUnique({
      where: { id: taskId },
      select: { id: true, userId: true, status: true },
    });
    if (!task)
      throw new NotFoundException({
        code: "TASK_NOT_FOUND",
        message: "生成任务不存在",
      });
    if (task.userId !== userId)
      throw new ForbiddenException({
        code: "TASK_FORBIDDEN",
        message: "无权访问生成任务",
      });
    if (task.status !== GenerationTaskStatus.QUEUED) return;
    try {
      await this.jobs.enqueue(task.id, userId);
    } catch (error) {
      throw new ServiceUnavailableException(
        {
          code: "QUEUE_UNAVAILABLE",
          message: "生成队列暂时不可用，请稍后重试",
        },
        { cause: error },
      );
    }
  }

  async createForCollection(
    userId: string,
    request: GenerationCreateRequest,
    context: CollectionGenerationContext,
    idempotencyKey: string = randomUUID(),
  ): Promise<{ taskId: string }> {
    return this.createTask(
      userId,
      request,
      idempotencyKey,
      context,
      request.prompt,
    );
  }

  private async createTask(
    userId: string,
    request: GenerationCreateRequest,
    idempotencyKey: string,
    context?: CollectionGenerationContext,
    rawUserIntent: string = request.prompt,
    compilerOptions: ContextCompilerOptions = {},
    frozenCompiled?: CompiledGenInput,
  ): Promise<{ taskId: string }> {
    const taskId = createHash("sha256")
      .update(`${userId}\0${idempotencyKey}`)
      .digest("hex");
    const compiledPrompt =
      frozenCompiled ??
      (compilerOptions.modelCalls
        ? await this.compiler.compile(
            userId,
            request.projectId,
            request.prompt,
            request.shapeIds,
            compilerOptions,
          )
        : await this.compiler.compile(
            userId,
            request.projectId,
            request.prompt,
            request.shapeIds,
          ));
    const presentationPolicy = resolvePresentationPolicy(
      [rawUserIntent, ...(compiledPrompt.notes ?? []), request.negativePrompt]
        .filter(Boolean)
        .join("\n"),
      request.taskType,
    );
    const requestFingerprint = generationRequestFingerprint(
      request,
      context,
      presentationPolicy,
    );
    const existing = await this.database.generationTask.findUnique({
      where: { id: taskId },
      select: {
        compiledPrompt: true,
        id: true,
        status: true,
        userId: true,
      },
    });
    if (existing?.userId === userId) {
      return this.replayExistingTask(existing, userId, requestFingerprint);
    }

    const quota = await this.billingService.canGenerate(userId);
    if (!quota.allowed) {
      throw new GenerationLimitExceededException();
    }
    const parentAsset = await this.assertParentAsset(
      userId,
      request.projectId,
      request.parentAssetId,
    );
    const providerRequest = { ...request };
    delete providerRequest.parentAssetId;
    delete providerRequest.projectId;
    delete providerRequest.shapeIds;
    const parentObjectKey = parentAsset ? objectKeyFrom(parentAsset.url) : null;
    if (parentObjectKey && "referenceImageUrl" in providerRequest) {
      providerRequest.referenceImageUrl = await this.storage.createDownloadUrl(
        parentObjectKey,
        24 * 60 * 60,
      );
    }
    if (
      providerRequest.taskType === "t2i" &&
      !providerRequest.referenceImageUrl
    ) {
      // 收集所有参考图片及其权重
      interface WeightedReference {
        role:
          | "detail_ref"
          | "fabric_texture"
          | "palette_ref"
          | "silhouette_ref"
          | "style_ref";
        url: string;
        weight: number;
        priority: number; // 类型优先级：style=3, fabric=2, silhouette=1
      }

      const allReferences: WeightedReference[] = [];

      // Style references (最高优先级)
      for (const ref of compiledPrompt.styleReferences ?? []) {
        allReferences.push({
          url: ref.imageUrl,
          role: "style_ref",
          weight: "weight" in ref ? ref.weight : STYLE_REFERENCE_STRENGTH,
          priority: 3,
        });
      }

      // Fabric references (中优先级)
      for (const ref of compiledPrompt.fabricReferences ?? []) {
        allReferences.push({
          url: ref.imageUrl,
          role: "fabric_texture",
          weight: "weight" in ref ? ref.weight : FABRIC_REFERENCE_STRENGTH,
          priority: 2,
        });
      }

      // Silhouette references (低优先级)
      for (const ref of compiledPrompt.silhouetteReferences ?? []) {
        allReferences.push({
          url: ref.edgeImageUrl,
          role: "silhouette_ref",
          weight: SILHOUETTE_REFERENCE_STRENGTH,
          priority: 1,
        });
      }

      for (const ref of compiledPrompt.detailReferences ?? []) {
        allReferences.push({
          role: "detail_ref",
          url: ref.imageUrl,
          weight: DETAIL_REFERENCE_STRENGTH,
          priority: 2,
        });
      }

      for (const ref of compiledPrompt.paletteReferences ?? []) {
        allReferences.push({
          role: "palette_ref",
          url: ref.imageUrl,
          weight: PALETTE_REFERENCE_STRENGTH,
          priority: 2,
        });
      }

      // 设置所有参考图片到请求中
      if (allReferences.length > 0) {
        // 按权重和优先级排序，权重高的在前
        const sorted = allReferences.sort((a, b) => {
          if (b.weight !== a.weight) return b.weight - a.weight;
          return b.priority - a.priority;
        });

        // 使用 referenceImageUrls 传递所有图片（最多16张）
        const selected = sorted.slice(0, 16);
        providerRequest.referenceImageUrls = selected.map(
          (reference) => reference.url,
        );
        providerRequest.referenceImages = selected.map((reference, order) => ({
          order,
          role: reference.role,
          url: reference.url,
          weight: reference.weight,
        }));
        // 保持向后兼容：referenceImageUrl 设为权重最高的
        const primaryReference = sorted[0];
        if (primaryReference) {
          providerRequest.referenceImageUrl = primaryReference.url;
        }
      }
    }
    const requestedPalette =
      request.taskType === "inpaint" ? request.palette : undefined;
    const providerPrompts =
      request.taskType === "inpaint"
        ? {
            negativePrompt: request.negativePrompt?.trim() ?? "",
            positivePrompt: applyLocalEditPalette(
              `Local-edit request, highest priority: ${request.prompt.trim()}`,
              requestedPalette,
            ),
          }
        : applyPresentationPolicy(
            compiledPrompt.positivePrompt,
            request.negativePrompt,
            compiledPrompt.negativePrompt,
            presentationPolicy,
          );
    const input: AiGenerationRequest = {
      ...providerRequest,
      negativePrompt: providerPrompts.negativePrompt,
      prompt:
        context && request.taskType !== "inpaint"
          ? collectionProviderPrompt(
              providerPrompts.positivePrompt,
              request.prompt,
            )
          : providerPrompts.positivePrompt,
    };
    const persistedCompiledPrompt = {
      ...compiledPrompt,
      ...(context ? { collectionContext: context } : {}),
      presentationPolicy,
      request,
      requestFingerprint,
    };
    const generationInputs = compiledPrompt.fabricInputs ?? [];
    const stepSnapshot: DesignStepSnapshot = {
      version: 1,
      sources: [
        ...(compiledPrompt.sources ?? []),
        ...(request.parentAssetId &&
        !compiledPrompt.sources?.some(
          (source) => source.assetId === request.parentAssetId,
        )
          ? [
              {
                elementId: request.parentAssetId,
                assetId: request.parentAssetId,
                role: "edit_source",
                title: "编辑来源",
              },
            ]
          : []),
      ],
      constraints: {
        palette: compiledPrompt.palette ?? [],
        notes: compiledPrompt.notes ?? [],
        avoidLabels: compiledPrompt.avoidLabels ?? [],
        fabricTerms: [
          ...new Set(
            compiledPrompt.fabricReferences?.flatMap((reference) => [
              ...reference.labels,
            ]) ?? [],
          ),
        ],
      },
      parameters: {
        taskType: request.taskType,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt ?? "",
        width: request.width,
        height: request.height,
        ...(request.quality ? { quality: request.quality } : {}),
        ...(context
          ? {
              collectionId: context.collectionId,
              variationAxis: context.variationAxis,
            }
          : {}),
      },
    };

    const admission = await this.billingService.withLockedGenerationQuota(
      userId,
      async (transaction, quota): Promise<GenerationAdmission> => {
        const concurrent = await transaction.generationTask.findUnique({
          where: { id: taskId },
          select: {
            compiledPrompt: true,
            id: true,
            status: true,
            userId: true,
          },
        });
        if (concurrent?.userId === userId) {
          return { kind: "existing", task: concurrent };
        }
        if (!quota.allowed) {
          return { kind: "denied" };
        }

        const task = await transaction.generationTask.create({
          data: {
            id: taskId,
            compiledPrompt:
              persistedCompiledPrompt as unknown as Prisma.InputJsonValue,
            input: input as Prisma.InputJsonValue,
            ...(request.parentAssetId
              ? { parentAssetId: request.parentAssetId }
              : {}),
            ...(request.projectId ? { projectId: request.projectId } : {}),
            ...(request.projectId
              ? {
                  designStep: {
                    create: {
                      projectId: request.projectId,
                      actor: context
                        ? "collection"
                        : compilerOptions.modelCalls === "skip"
                          ? "agent"
                          : "manual",
                      tool: request.taskType,
                      intent: rawUserIntent,
                      inputSnapshot:
                        stepSnapshot as unknown as Prisma.InputJsonValue,
                    },
                  },
                }
              : {}),
            ...(context
              ? {
                  collectionId: context.collectionId,
                  variationAxis: context.variationAxis,
                  ...(context.garmentTypeCode
                    ? { garmentTypeCode: context.garmentTypeCode }
                    : {}),
                  ...(context.garmentTypeLabel
                    ? { garmentTypeLabel: context.garmentTypeLabel }
                    : {}),
                  ...(context.slotKey ? { slotKey: context.slotKey } : {}),
                }
              : {}),
            ...(generationInputs.length
              ? {
                  generationInputs: {
                    create: generationInputs.map((generationInput) => ({
                      boardElementId: generationInput.boardElementId,
                      fabricId: generationInput.fabricId,
                      inputType: "fabric",
                      role: generationInput.role,
                      tagsSnapshot: [...generationInput.tags],
                      weight: generationInput.weight,
                    })),
                  },
                }
              : {}),
            status: GenerationTaskStatus.QUEUED,
            taskType: input.taskType,
            userId,
          },
          select: { id: true },
        });
        return { kind: "created", taskId: task.id };
      },
    );
    if (admission.kind === "denied") {
      throw new GenerationLimitExceededException();
    }
    if (admission.kind === "existing") {
      return this.replayExistingTask(
        admission.task,
        userId,
        requestFingerprint,
      );
    }

    try {
      await this.jobs.enqueue(admission.taskId, userId);
    } catch (error) {
      throw new ServiceUnavailableException(
        {
          code: "QUEUE_UNAVAILABLE",
          message: "生成队列暂时不可用，请稍后重试",
        },
        { cause: error },
      );
    }

    return { taskId: admission.taskId };
  }

  private async replayExistingTask(
    task: ExistingGenerationTask,
    userId: string,
    requestFingerprint: string,
  ): Promise<{ taskId: string }> {
    const persistedFingerprint = compiledPromptFingerprint(task.compiledPrompt);
    if (
      persistedFingerprint !== null &&
      persistedFingerprint !== requestFingerprint
    ) {
      throw new ConflictException({
        code: "IDEMPOTENCY_KEY_REUSED",
        message: "该幂等键已用于不同的生成请求",
      });
    }

    if (task.status === GenerationTaskStatus.QUEUED) {
      try {
        await this.jobs.enqueue(task.id, userId);
      } catch (error) {
        throw new ServiceUnavailableException(
          {
            code: "QUEUE_UNAVAILABLE",
            message: "生成队列暂时不可用，请稍后重试",
          },
          { cause: error },
        );
      }
    }
    return { taskId: task.id };
  }

  private async assertParentAsset(
    userId: string,
    projectId: string | undefined,
    parentAssetId: string | undefined,
  ): Promise<{ readonly url: string } | null> {
    if (!parentAssetId) return null;
    if (!projectId) {
      throw new BadRequestException({
        code: "PARENT_ASSET_REQUIRES_PROJECT",
        message: "血缘资产必须关联项目",
      });
    }
    const parent = await this.database.designAsset.findUnique({
      where: { id: parentAssetId },
      include: {
        project: {
          select: {
            workspace: { select: { ownerId: true } },
          },
        },
      },
    });
    if (!parent) {
      throw new NotFoundException({
        code: "DESIGN_ASSET_NOT_FOUND",
        message: "父资产不存在",
      });
    }
    if (parent.project.workspace.ownerId !== userId) {
      throw new ForbiddenException({
        code: "DESIGN_ASSET_FORBIDDEN",
        message: "无权使用该父资产",
      });
    }
    if (parent.projectId !== projectId) {
      throw new BadRequestException({
        code: "ASSET_PROJECT_MISMATCH",
        message: "父资产不属于当前项目",
      });
    }
    return { url: parent.url };
  }

  async get(userId: string, taskId: string): Promise<GenerationTaskView> {
    const task = await this.database.generationTask.findFirst({
      where: { id: taskId, userId },
    });
    if (!task) {
      throw new NotFoundException({
        code: "GENERATION_TASK_NOT_FOUND",
        message: "生成任务不存在",
      });
    }
    return this.toView(task);
  }

  async list(
    userId: string,
    query: GenerationListQuery,
  ): Promise<GenerationTaskListView> {
    const cursor = query.cursor
      ? await this.database.generationTask.findFirst({
          where: {
            id: query.cursor,
            projectId: query.projectId,
            userId,
          },
          select: {
            createdAt: true,
            id: true,
          },
        })
      : null;
    if (query.cursor && !cursor) {
      throw new BadRequestException({
        code: "INVALID_GENERATION_CURSOR",
        message: "生成任务游标无效",
      });
    }

    const tasks = await this.database.generationTask.findMany({
      where: {
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                {
                  createdAt: cursor.createdAt,
                  id: { lt: cursor.id },
                },
              ],
            }
          : {}),
        projectId: query.projectId,
        userId,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const hasNextPage = tasks.length > query.limit;
    const visibleTasks = hasNextPage ? tasks.slice(0, query.limit) : tasks;

    return {
      items: visibleTasks.map((task) => this.toView(task)),
      nextCursor: hasNextPage ? (visibleTasks.at(-1)?.id ?? null) : null,
    };
  }

  async cancel(userId: string, taskId: string): Promise<GenerationTaskView> {
    const task = await this.database.generationTask.findFirst({
      where: { id: taskId, userId },
    });
    if (!task) {
      throw new NotFoundException({
        code: "GENERATION_TASK_NOT_FOUND",
        message: "生成任务不存在",
      });
    }

    if (
      task.status === GenerationTaskStatus.QUEUED ||
      task.status === GenerationTaskStatus.RUNNING
    ) {
      const canceledAt = new Date();
      const { canceled, current } = await this.database.$transaction(async (transaction) => {
      const canceled = await transaction.generationTask.updateMany({
        where: {
          id: task.id,
          status: {
            in: [GenerationTaskStatus.QUEUED, GenerationTaskStatus.RUNNING],
          },
          userId,
        },
        data: {
          canceledAt,
          completedAt: canceledAt,
          errorCode: null,
          errorMessage: null,
          status: GenerationTaskStatus.CANCELED,
        },
      });
      const current = await transaction.generationTask.findFirst({
        where: { id: taskId, userId },
      });
      if (!current) {
        throw new NotFoundException({
          code: "GENERATION_TASK_NOT_FOUND",
          message: "生成任务不存在",
        });
      }
      if (current.status === GenerationTaskStatus.CANCELED) await appendGenerationTerminalOutbox(transaction, { taskId, status: "CANCELED" });
      return { canceled, current };
      });
      if (canceled.count === 1) {
        await this.jobs.cancel(task.id).catch(() => undefined);
      }
      return this.toView(current);
    }

    return this.toView(task);
  }

  async setCandidateDisposition(
    userId: string,
    taskId: string,
    index: number,
    disposition: "adopted" | "dismissed",
  ): Promise<GenerationTaskView> {
    const task = await this.database.generationTask.findFirst({
      where: { id: taskId, userId },
    });
    if (!task) {
      throw new NotFoundException({
        code: "GENERATION_TASK_NOT_FOUND",
        message: "生成任务不存在",
      });
    }
    const output = jsonObject(task.output);
    if (
      !output ||
      !Array.isArray(output.images) ||
      index >= output.images.length
    ) {
      throw new BadRequestException({
        code: "GENERATION_CANDIDATE_NOT_FOUND",
        message: "生成候选不存在",
      });
    }
    const existingDispositions = jsonObject(
      output.candidateDispositions as Prisma.JsonValue | null,
    );
    const updatedOutput: Prisma.InputJsonObject = {
      ...output,
      candidateDispositions: {
        ...existingDispositions,
        [String(index)]: disposition,
      },
    };
    const updated = await this.database.generationTask.update({
      data: { output: updatedOutput },
      where: { id: taskId },
    });
    return this.toView(updated);
  }

  private toView(task: {
    id: string;
    status: GenerationTaskStatus;
    taskType: string;
    input: Prisma.JsonValue;
    compiledPrompt: Prisma.JsonValue | null;
    projectId: string | null;
    parentAssetId: string | null;
    output: Prisma.JsonValue | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): GenerationTaskView {
    return {
      id: task.id,
      status: task.status.toLowerCase() as GenerationTaskView["status"],
      taskType: task.taskType,
      request: recoverGenerationRequest(task),
      compiledPrompt: task.compiledPrompt,
      output: task.output,
      error:
        task.errorCode && task.errorMessage
          ? { code: task.errorCode, message: task.errorMessage }
          : null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }
}

function recoverGenerationRequest(task: {
  readonly compiledPrompt: Prisma.JsonValue | null;
  readonly input: Prisma.JsonValue;
  readonly parentAssetId: string | null;
  readonly projectId: string | null;
  readonly taskType: string;
}): GenerationCreateRequest | null {
  const compiledPrompt = jsonObject(task.compiledPrompt);
  const persisted = generationCreateRequestSchema.safeParse(
    compiledPrompt?.request,
  );
  if (persisted.success) {
    return persisted.data;
  }

  const input = jsonObject(task.input);
  if (!input) return null;
  const candidate: Record<string, unknown> = {
    ...input,
    taskType:
      typeof input.taskType === "string" ? input.taskType : task.taskType,
  };
  if (
    typeof candidate.prompt !== "string" &&
    typeof compiledPrompt?.positivePrompt === "string"
  ) {
    candidate.prompt = compiledPrompt.positivePrompt;
  }
  if (
    candidate.negativePrompt === undefined &&
    typeof compiledPrompt?.negativePrompt === "string"
  ) {
    candidate.negativePrompt = compiledPrompt.negativePrompt;
  }
  if (task.projectId) {
    candidate.projectId = task.projectId;
  }
  if (task.parentAssetId) {
    candidate.parentAssetId = task.parentAssetId;
  }

  const recovered = generationCreateRequestSchema.safeParse(candidate);
  return recovered.success ? recovered.data : null;
}

function jsonObject(value: Prisma.JsonValue | null): Prisma.JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

function objectKeyFrom(value: string | undefined): string | null {
  return value?.startsWith("s3://") ? value.slice("s3://".length) : null;
}

function compiledPromptFingerprint(
  value: Prisma.JsonValue | null,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const fingerprint = value.requestFingerprint;
  return typeof fingerprint === "string" ? fingerprint : null;
}

function generationRequestFingerprint(
  request: GenerationCreateRequest,
  context: CollectionGenerationContext | undefined,
  presentationPolicy: PresentationPolicy,
): string {
  return createHash("sha256")
    .update(
      stableJson({
        context: context ?? null,
        presentationPolicy: {
          mode: presentationPolicy.mode,
          version: presentationPolicy.version,
        },
        request,
      }),
    )
    .digest("hex");
}

const ON_MODEL_DENIAL_SIGNALS = [
  {
    id: "zh_explicit_denial",
    pattern:
      /(?:不要|无需|不需要|禁止|避免|去掉|移除|排除|不能|别).{0,10}(?:模特|真人|人物|试穿|上身|穿着展示)/u,
  },
  {
    id: "en_explicit_denial",
    pattern:
      /\b(?:no|without|exclude|avoid|remove)\s+(?:a\s+|any\s+)?(?:human|person|people|model|wearer|try[-\s]?on)\b/iu,
  },
] as const;

const ON_MODEL_ALLOW_SIGNALS = [
  {
    id: "zh_model_try_on",
    pattern: /(?:模特|真人|人物).{0,8}(?:试穿|上身|穿|展示)/u,
  },
  {
    id: "zh_explicit_model_subject",
    pattern: /(?:生成|使用|添加|保留|换成|改成).{0,6}(?:模特|真人|人物)/u,
  },
  {
    id: "zh_try_on_result",
    pattern: /(?:试穿|上身)(?:效果|展示|图|照|图片)/u,
  },
  {
    id: "zh_worn_on_person",
    pattern: /(?:穿在|穿到).{0,8}(?:模特|真人|人物|我|人).{0,3}身上/u,
  },
  {
    id: "zh_virtual_try_on",
    pattern: /(?:虚拟试衣|虚拟试穿|AI试衣|AI试穿)/iu,
  },
  {
    id: "zh_runway_model",
    pattern: /(?:T台|走秀|秀场).{0,6}(?:模特|试穿|穿着)/iu,
  },
  {
    id: "en_on_model",
    pattern:
      /\b(?:on[-\s]?model|model\s+(?:wearing|wears)|worn\s+by\s+(?:a\s+)?model|human\s+wearing|virtual\s+try[-\s]?on|fashion\s+model|runway\s+model)\b/iu,
  },
] as const;

function resolvePresentationPolicy(
  userIntent: string,
  taskType: GenerationCreateRequest["taskType"],
): PresentationPolicy {
  if (taskType === "inpaint") {
    return {
      matchedSignals: ["inpaint_source_preservation"],
      mode: "preserve_source",
      version: PRESENTATION_POLICY_VERSION,
    };
  }
  const normalized = userIntent.normalize("NFKC").toLowerCase();
  const denial = ON_MODEL_DENIAL_SIGNALS.find(({ pattern }) =>
    pattern.test(normalized),
  );
  if (denial) {
    return {
      matchedSignals: [denial.id],
      mode: "garment_only",
      version: PRESENTATION_POLICY_VERSION,
    };
  }

  const allow = ON_MODEL_ALLOW_SIGNALS.find(({ pattern }) =>
    pattern.test(normalized),
  );
  return allow
    ? {
        matchedSignals: [allow.id],
        mode: "on_model",
        version: PRESENTATION_POLICY_VERSION,
      }
    : {
        matchedSignals: [],
        mode: "garment_only",
        version: PRESENTATION_POLICY_VERSION,
      };
}

function applyPresentationPolicy(
  positivePrompt: string,
  requestNegativePrompt: string | undefined,
  compiledNegativePrompt: string,
  policy: PresentationPolicy,
): { readonly negativePrompt: string; readonly positivePrompt: string } {
  const garmentOnly = policy.mode === "garment_only";
  return {
    negativePrompt: joinUniquePromptSections(
      [
        garmentOnly ? GARMENT_ONLY_NEGATIVE_TERMS.join(", ") : null,
        requestNegativePrompt,
        compiledNegativePrompt,
      ],
      ", ",
      3_000,
    ),
    positivePrompt: joinUniquePromptSections(
      [garmentOnly ? GARMENT_ONLY_POSITIVE_CONSTRAINT : null, positivePrompt],
      "\n\n",
      4_000,
    ),
  };
}

function applyLocalEditPalette(
  positivePrompt: string,
  palette:
    readonly { readonly hex: string; readonly name: string }[] | undefined,
): string {
  if (!palette?.length) return positivePrompt;
  const colors = palette
    .map((color) => `${color.name} ${color.hex}`)
    .join(", ");
  const directive =
    "Local-edit color constraint, high priority: apply only these palette " +
    `colors inside the masked area: ${colors}. Preserve all colors outside ` +
    "the masked area.";
  return joinUniquePromptSections([directive, positivePrompt], "\n\n", 4_000);
}

function joinUniquePromptSections(
  values: readonly (string | null | undefined)[],
  separator: string,
  limit: number,
): string {
  const seen = new Set<string>();
  const sections = values.flatMap((value) => {
    const cleaned = value?.trim();
    if (!cleaned) return [];
    const key = cleaned.toLocaleLowerCase("en-US");
    if (seen.has(key)) return [];
    seen.add(key);
    return [cleaned];
  });
  return sections.join(separator).slice(0, limit);
}

function collectionProviderPrompt(
  enhancedPrompt: string,
  originalPrompt: string,
): string {
  if (enhancedPrompt.includes(originalPrompt)) {
    return enhancedPrompt.slice(0, 4_000);
  }
  const directive = `系列变化硬约束（必须逐条执行）：\n${originalPrompt}`;
  const enhancedLimit = Math.max(0, 4_000 - directive.length - 2);
  const prefix = enhancedPrompt.slice(0, enhancedLimit);
  return prefix ? `${prefix}\n\n${directive}` : directive.slice(0, 4_000);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
  return `{${entries.join(",")}}`;
}
