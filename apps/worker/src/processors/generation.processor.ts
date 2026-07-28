import {
  AiProviderError,
  aiGenerationRequestSchema,
  type AiProviderJob,
  type AiProviderResult,
  type AiRuntimeService,
} from "@fashion/ai";
import type { BillingService } from "@fashion/billing";
import {
  ContentModerationStatus,
  DesignAssetOperation,
  GenerationTaskStatus,
  Prisma,
  SimilarityAnalysisStatus,
  type PrismaClient,
} from "@fashion/db";
import type { GenerationJobData, GenerationTaskEvent } from "@fashion/shared";
import { UnrecoverableError, type Job } from "bullmq";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type {
  ContentModerationDecision,
  ContentModerationService,
} from "../content-moderation.service";

const providerJobSchema = z.object({
  provider: z.string().min(1),
  providerJobId: z.string().min(1),
  model: z.string().min(1),
  taskType: z.enum(["t2i", "i2i", "inpaint"]),
  submittedAt: z.iso.datetime(),
  cost: z.object({
    rawCost: z.number().nonnegative(),
    credits: z.number().int().nonnegative(),
    currency: z.literal("USD"),
    billableMegapixels: z.number().int().positive(),
    estimated: z.literal(true),
  }),
});

type GenerationDatabase = Pick<
  PrismaClient,
  "$transaction" | "collectionLook" | "designAsset" | "generationTask"
>;

type GenerationAi = Pick<
  AiRuntimeService,
  "getResult" | "getStatus" | "submit"
>;

export interface GenerationProcessorDependencies {
  readonly ai: GenerationAi;
  readonly billing: Pick<BillingService, "incrementCount">;
  readonly database: GenerationDatabase;
  readonly moderator: ContentModerationService;
  readonly pollIntervalMs?: number;
  readonly similarityJobs?: {
    enqueue(collectionId: string, designAssetId: string): Promise<void>;
  };
  readonly timeoutMs?: number;
}

class GenerationCanceledError extends Error {}
class GenerationTimedOutError extends Error {}

export function createGenerationProcessor({
  ai,
  billing,
  database,
  moderator,
  pollIntervalMs = 500,
  similarityJobs,
  timeoutMs = 120_000,
}: GenerationProcessorDependencies) {
  return async (
    job: Job<GenerationJobData>,
    workerSignal?: AbortSignal,
  ): Promise<{
    skipped?: true;
    status: "canceled" | "moderation_failed" | "succeeded";
    taskId: string;
  }> => {
    const task = await database.generationTask.findUnique({
      where: { id: job.data.taskId },
    });
    if (!task || task.userId !== job.data.userId) {
      throw new UnrecoverableError("生成任务不存在或队列数据无效");
    }
    if (task.status === GenerationTaskStatus.CANCELED) {
      return { skipped: true, status: "canceled", taskId: task.id };
    }
    if (task.status === GenerationTaskStatus.MODERATION_FAILED) {
      return {
        skipped: true,
        status: "moderation_failed",
        taskId: task.id,
      };
    }
    if (task.status === GenerationTaskStatus.SUCCEEDED && task.countedAt) {
      return { skipped: true, status: "succeeded", taskId: task.id };
    }

    await database.generationTask.update({
      where: { id: task.id },
      data: {
        attemptCount: { increment: 1 },
        errorCode: null,
        errorMessage: null,
        startedAt: task.startedAt ?? new Date(),
        status: GenerationTaskStatus.RUNNING,
      },
    });
    await updateProgressSafely(job, event(task.id, "running"));

    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () =>
        timeoutController.abort(
          new GenerationTimedOutError("生成任务超过 120 秒"),
        ),
      timeoutMs,
    );
    const signal = workerSignal
      ? AbortSignal.any([workerSignal, timeoutController.signal])
      : timeoutController.signal;

    try {
      const result = await executeGeneration({
        ai,
        database,
        input: task.input,
        providerJob: task.providerJob,
        signal,
        taskId: task.id,
        pollIntervalMs,
      });
      const moderation = await moderateSafely(
        moderator,
        result.images.map((image) => image.url),
      );
      if (moderation.status === "rejected") {
        const finalStatus = await markModerationFailed(
          database,
          task.id,
          moderation.categories,
        );
        await updateProgressSafely(job, event(task.id, finalStatus));
        return {
          ...(finalStatus === "canceled" ? { skipped: true as const } : {}),
          status: finalStatus,
          taskId: task.id,
        };
      }
      const finalStatus = await persistSuccessOnce(
        database,
        billing,
        task.id,
        task.userId,
        result,
        moderation,
        {
          collectionId: task.collectionId,
          parentAssetId: task.parentAssetId,
          projectId: task.projectId,
          taskType: task.taskType,
          variationAxis: task.variationAxis,
        },
      );
      const collectionId = task.collectionId;
      if (finalStatus === "succeeded" && collectionId && similarityJobs) {
        const generatedAssets = await database.designAsset.findMany({
          where: { generationTaskId: task.id },
          select: { id: true },
        });
        try {
          await Promise.all(
            generatedAssets.map((asset) =>
              similarityJobs.enqueue(collectionId, asset.id),
            ),
          );
        } catch {
          await database.collectionLook.updateMany({
            where: { collectionId },
            data: { analysisStatus: SimilarityAnalysisStatus.FAILED },
          });
        }
      }
      await updateProgressSafely(job, event(task.id, finalStatus));
      return {
        ...(finalStatus === "canceled" ? { skipped: true as const } : {}),
        status: finalStatus,
        taskId: task.id,
      };
    } catch (error) {
      if (error instanceof GenerationCanceledError) {
        await markCanceled(database, task.id);
        await updateProgressSafely(job, event(task.id, "canceled"));
        return {
          skipped: true,
          status: "canceled",
          taskId: task.id,
        };
      }

      if (timeoutController.signal.aborted) {
        await markFinalFailure(
          database,
          task.id,
          "GENERATION_TIMEOUT",
          "生成任务超过 120 秒",
        );
        await updateProgressSafely(job, event(task.id, "failed"));
        throw new UnrecoverableError("生成任务超过 120 秒");
      }

      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      const retryable = !(error instanceof AiProviderError) || error.retryable;
      if (!finalAttempt && retryable) {
        await database.generationTask.updateMany({
          where: {
            id: task.id,
            status: GenerationTaskStatus.RUNNING,
          },
          data: {
            errorCode: standardErrorCode(error),
            errorMessage: safeErrorMessage(error),
            status: GenerationTaskStatus.QUEUED,
          },
        });
        await updateProgressSafely(job, event(task.id, "queued"));
        throw error;
      }

      await markFinalFailure(
        database,
        task.id,
        standardErrorCode(error),
        safeErrorMessage(error),
      );
      await updateProgressSafely(job, event(task.id, "failed"));
      if (!retryable) {
        throw new UnrecoverableError(safeErrorMessage(error));
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
}

async function executeGeneration({
  ai,
  database,
  input,
  providerJob,
  signal,
  taskId,
  pollIntervalMs,
}: {
  ai: GenerationAi;
  database: GenerationDatabase;
  input: Prisma.JsonValue;
  providerJob: Prisma.JsonValue | null;
  signal: AbortSignal;
  taskId: string;
  pollIntervalMs: number;
}): Promise<AiProviderResult> {
  const request = aiGenerationRequestSchema.parse(input);
  let remoteJob: AiProviderJob;

  if (providerJob) {
    remoteJob = providerJobSchema.parse(providerJob);
  } else {
    await assertActive(database, taskId);
    remoteJob = await ai.submit(request, signal);
    await database.generationTask.updateMany({
      where: { id: taskId, status: GenerationTaskStatus.RUNNING },
      data: { providerJob: toJson(remoteJob) },
    });
  }

  while (true) {
    await assertActive(database, taskId);
    assertNotAborted(signal);
    const status = await ai.getStatus(remoteJob, signal);
    if (status.status === "completed") {
      break;
    }
    await wait(pollIntervalMs, signal);
  }

  await assertActive(database, taskId);
  return ai.getResult(remoteJob, signal);
}

async function persistSuccessOnce(
  database: GenerationDatabase,
  billing: Pick<BillingService, "incrementCount">,
  taskId: string,
  userId: string,
  result: AiProviderResult,
  moderation: Extract<
    ContentModerationDecision,
    { status: "approved" | "review_required" }
  >,
  lineage: {
    readonly collectionId: string | null;
    readonly parentAssetId: string | null;
    readonly projectId: string | null;
    readonly taskType: string;
    readonly variationAxis:
      "COLOR" | "DETAIL" | "FABRIC" | "SILHOUETTE" | "STYLING" | null;
  },
): Promise<"canceled" | "succeeded"> {
  return database.$transaction(async (transaction) => {
    const completedAt = new Date();
    const claimed = await transaction.generationTask.updateMany({
      where: {
        countedAt: null,
        id: taskId,
        status: GenerationTaskStatus.RUNNING,
      },
      data: {
        completedAt,
        countedAt: completedAt,
        errorCode: null,
        errorMessage: null,
        output: toJson(result),
        manualReviewRequired: moderation.status === "review_required",
        moderationCategories: [...moderation.categories],
        moderationCheckedAt: completedAt,
        moderationStatus:
          moderation.status === "approved"
            ? ContentModerationStatus.APPROVED
            : ContentModerationStatus.REVIEW_REQUIRED,
        status: GenerationTaskStatus.SUCCEEDED,
      },
    });
    if (claimed.count === 1) {
      const output = await persistDesignAssets(
        transaction,
        taskId,
        result,
        lineage,
      );
      await transaction.generationTask.update({
        where: { id: taskId },
        data: { output: toJson(output) },
      });
      await billing.incrementCount(userId, transaction);
      return "succeeded";
    }
    const current = await transaction.generationTask.findUnique({
      where: { id: taskId },
      select: { status: true },
    });
    return current?.status === GenerationTaskStatus.CANCELED
      ? "canceled"
      : "succeeded";
  });
}

async function persistDesignAssets(
  transaction: Prisma.TransactionClient,
  taskId: string,
  result: AiProviderResult,
  lineage: {
    readonly collectionId: string | null;
    readonly parentAssetId: string | null;
    readonly projectId: string | null;
    readonly taskType: string;
    readonly variationAxis:
      "COLOR" | "DETAIL" | "FABRIC" | "SILHOUETTE" | "STYLING" | null;
  },
): Promise<AiProviderResult> {
  if (!lineage.projectId) return result;

  const parent = lineage.parentAssetId
    ? await transaction.designAsset.findFirst({
        where: {
          id: lineage.parentAssetId,
          projectId: lineage.projectId,
        },
        select: { rootAssetId: true },
      })
    : null;
  if (lineage.parentAssetId && !parent) {
    throw new UnrecoverableError("父资产不存在或不属于当前项目");
  }

  let nextOrdinal = 0;
  if (lineage.collectionId) {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "collections" WHERE "id" = ${lineage.collectionId} FOR UPDATE`,
    );
    const current = await transaction.collectionLook.aggregate({
      where: { collectionId: lineage.collectionId },
      _max: { ordinal: true },
    });
    nextOrdinal = current._max.ordinal ?? 0;
  }

  const images = [];
  for (const image of result.images) {
    const assetId = randomUUID();
    await transaction.designAsset.create({
      data: {
        id: assetId,
        generationTaskId: taskId,
        height: image.height ?? null,
        operation: operationFrom(lineage.taskType),
        parentAssetId: lineage.parentAssetId,
        projectId: lineage.projectId,
        rootAssetId: parent?.rootAssetId ?? assetId,
        seed: result.seed === undefined ? null : BigInt(result.seed),
        thumbnailUrl: image.url,
        url: image.url,
        width: image.width ?? null,
      },
    });
    if (lineage.collectionId) {
      nextOrdinal += 1;
      await transaction.collectionLook.create({
        data: {
          analysisStatus: SimilarityAnalysisStatus.PENDING,
          collectionId: lineage.collectionId,
          designAssetId: assetId,
          ordinal: nextOrdinal,
          variationAxis: lineage.variationAxis,
        },
      });
    }
    images.push({ ...image, assetId });
  }
  return { ...result, images };
}

function operationFrom(taskType: string): DesignAssetOperation {
  if (taskType === "inpaint") return DesignAssetOperation.INPAINT;
  if (taskType === "i2i") return DesignAssetOperation.VARIATION;
  return DesignAssetOperation.GENERATED;
}

async function assertActive(
  database: GenerationDatabase,
  taskId: string,
): Promise<void> {
  const current = await database.generationTask.findUnique({
    where: { id: taskId },
    select: { status: true },
  });
  if (current?.status === GenerationTaskStatus.CANCELED) {
    throw new GenerationCanceledError("生成任务已取消");
  }
  if (!current) {
    throw new UnrecoverableError("生成任务不存在");
  }
}

function assertNotAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }
  if (signal.reason instanceof Error) {
    throw signal.reason;
  }
  const error = new Error("生成任务已中止");
  error.name = "AbortError";
  throw error;
}

async function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("生成任务已中止"),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function markCanceled(
  database: GenerationDatabase,
  taskId: string,
): Promise<void> {
  await database.generationTask.updateMany({
    where: {
      id: taskId,
      status: {
        notIn: [
          GenerationTaskStatus.SUCCEEDED,
          GenerationTaskStatus.MODERATION_FAILED,
        ],
      },
    },
    data: {
      canceledAt: new Date(),
      completedAt: new Date(),
      errorCode: null,
      errorMessage: null,
      status: GenerationTaskStatus.CANCELED,
    },
  });
}

async function markModerationFailed(
  database: GenerationDatabase,
  taskId: string,
  categories: readonly string[],
): Promise<"canceled" | "moderation_failed"> {
  const completedAt = new Date();
  const updated = await database.generationTask.updateMany({
    where: {
      countedAt: null,
      id: taskId,
      status: GenerationTaskStatus.RUNNING,
    },
    data: {
      completedAt,
      errorCode: "CONTENT_MODERATION_FAILED",
      errorMessage: "该内容不符合平台规范",
      manualReviewRequired: false,
      moderationCategories: [...categories],
      moderationCheckedAt: completedAt,
      moderationStatus: ContentModerationStatus.REJECTED,
      output: Prisma.DbNull,
      status: GenerationTaskStatus.MODERATION_FAILED,
    },
  });
  if (updated.count === 1) return "moderation_failed";
  const current = await database.generationTask.findUnique({
    where: { id: taskId },
    select: { status: true },
  });
  return current?.status === GenerationTaskStatus.CANCELED
    ? "canceled"
    : "moderation_failed";
}

async function markFinalFailure(
  database: GenerationDatabase,
  taskId: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  await database.generationTask.updateMany({
    where: {
      id: taskId,
      status: {
        notIn: [
          GenerationTaskStatus.CANCELED,
          GenerationTaskStatus.MODERATION_FAILED,
          GenerationTaskStatus.SUCCEEDED,
        ],
      },
    },
    data: {
      completedAt: new Date(),
      errorCode,
      errorMessage,
      status: GenerationTaskStatus.FAILED,
    },
  });
}

async function moderateSafely(
  moderator: ContentModerationService,
  imageUrls: readonly string[],
): Promise<ContentModerationDecision> {
  try {
    return await moderator.moderate(imageUrls);
  } catch {
    return {
      categories: [],
      reason: "unavailable",
      status: "review_required",
    };
  }
}

function event(
  taskId: string,
  status: GenerationTaskEvent["status"],
): GenerationTaskEvent {
  return {
    taskId,
    status,
    timestamp: new Date().toISOString(),
  };
}

async function updateProgressSafely(
  job: Job<GenerationJobData>,
  taskEvent: GenerationTaskEvent,
): Promise<void> {
  await job.updateProgress(taskEvent).catch(() => undefined);
}

function standardErrorCode(error: unknown): string {
  return error instanceof AiProviderError ? error.code : "GENERATION_FAILED";
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof AiProviderError) {
    return error.message.slice(0, 500);
  }
  return "生成失败，请稍后重试";
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
