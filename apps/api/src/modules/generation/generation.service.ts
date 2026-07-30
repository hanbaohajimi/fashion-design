import {
  CollectionVariationAxis,
  GenerationTaskStatus,
  Prisma,
  type PrismaClient,
} from "@fashion/db";
import type { AiGenerationRequest } from "@fashion/ai";
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
import { BillingService } from "../billing/billing.service";
import { S3FileStorage } from "../files/storage.service";
import { ContextCompilerService } from "./compiler/context-compiler.service";
import {
  generationCreateRequestSchema,
  type GenerationCreateRequest,
  type GenerationListQuery,
} from "./generation.schemas";

export const GENERATION_DB = Symbol("GENERATION_DB");
export const GENERATION_JOBS = Symbol("GENERATION_JOBS");
const STYLE_REFERENCE_STRENGTH = 0.72;
const SILHOUETTE_REFERENCE_STRENGTH = 0.55;

type GenerationDatabase = Pick<PrismaClient, "designAsset" | "generationTask">;

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
  ): Promise<{ taskId: string }> {
    return this.createTask(userId, request, idempotencyKey);
  }

  async createForCollection(
    userId: string,
    request: GenerationCreateRequest,
    context: CollectionGenerationContext,
    idempotencyKey: string = randomUUID(),
  ): Promise<{ taskId: string }> {
    return this.createTask(userId, request, idempotencyKey, context);
  }

  private async createTask(
    userId: string,
    request: GenerationCreateRequest,
    idempotencyKey: string,
    context?: CollectionGenerationContext,
  ): Promise<{ taskId: string }> {
    const taskId = createHash("sha256")
      .update(`${userId}\0${idempotencyKey}`)
      .digest("hex");
    const requestFingerprint = generationRequestFingerprint(request, context);
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

    const compiledPrompt = await this.compiler.compile(
      userId,
      request.projectId,
      request.prompt,
      request.shapeIds,
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
      const styleReference = compiledPrompt.styleReferences?.[0]?.imageUrl;
      const silhouetteReference =
        compiledPrompt.silhouetteReferences?.[0]?.edgeImageUrl;
      const boardReference = styleReference ?? silhouetteReference;
      if (boardReference) {
        providerRequest.referenceImageUrl = boardReference;
        providerRequest.strength = styleReference
          ? STYLE_REFERENCE_STRENGTH
          : SILHOUETTE_REFERENCE_STRENGTH;
      }
    }
    const input: AiGenerationRequest = {
      ...providerRequest,
      negativePrompt: compiledPrompt.negativePrompt.slice(0, 3_000),
      prompt: compiledPrompt.positivePrompt.slice(0, 4_000),
    };
    const persistedCompiledPrompt = {
      ...compiledPrompt,
      request,
      requestFingerprint,
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
            ...(context
              ? {
                  collectionId: context.collectionId,
                  variationAxis: context.variationAxis,
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
      const canceled = await this.database.generationTask.updateMany({
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
      const current = await this.database.generationTask.findFirst({
        where: { id: taskId, userId },
      });
      if (!current) {
        throw new NotFoundException({
          code: "GENERATION_TASK_NOT_FOUND",
          message: "生成任务不存在",
        });
      }
      if (canceled.count === 1) {
        await this.jobs.cancel(task.id).catch(() => undefined);
      }
      return this.toView(current);
    }

    return this.toView(task);
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
): string {
  return createHash("sha256")
    .update(stableJson({ context: context ?? null, request }))
    .digest("hex");
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
