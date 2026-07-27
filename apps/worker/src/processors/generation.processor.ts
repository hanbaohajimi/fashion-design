import {
  AiProviderError,
  aiGenerationRequestSchema,
  type AiProviderJob,
  type AiProviderResult,
  type AiRuntimeService,
} from "@fashion/ai";
import type { BillingService } from "@fashion/billing";
import {
  GenerationTaskStatus,
  Prisma,
  type PrismaClient,
} from "@fashion/db";
import type {
  GenerationJobData,
  GenerationTaskEvent,
} from "@fashion/shared";
import { UnrecoverableError, type Job } from "bullmq";
import { z } from "zod";

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
  "$transaction" | "generationTask"
>;

type GenerationAi = Pick<
  AiRuntimeService,
  "getResult" | "getStatus" | "submit"
>;

export interface GenerationProcessorDependencies {
  readonly ai: GenerationAi;
  readonly billing: Pick<BillingService, "incrementCount">;
  readonly database: GenerationDatabase;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
}

class GenerationCanceledError extends Error {}
class GenerationTimedOutError extends Error {}

export function createGenerationProcessor({
  ai,
  billing,
  database,
  pollIntervalMs = 500,
  timeoutMs = 120_000,
}: GenerationProcessorDependencies) {
  return async (
    job: Job<GenerationJobData>,
    workerSignal?: AbortSignal,
  ): Promise<{
    skipped?: true;
    status: "canceled" | "succeeded";
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
    if (
      task.status === GenerationTaskStatus.SUCCEEDED &&
      task.countedAt
    ) {
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
      const finalStatus = await persistSuccessOnce(
        database,
        billing,
        task.id,
        task.userId,
        result,
      );
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

      const finalAttempt =
        job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      const retryable =
        !(error instanceof AiProviderError) || error.retryable;
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
        status: GenerationTaskStatus.SUCCEEDED,
      },
    });
    if (claimed.count === 1) {
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

async function wait(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
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
      status: { not: GenerationTaskStatus.SUCCEEDED },
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

async function markFinalFailure(
  database: GenerationDatabase,
  taskId: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  await database.generationTask.updateMany({
    where: {
      id: taskId,
      status: { notIn: [
        GenerationTaskStatus.CANCELED,
        GenerationTaskStatus.SUCCEEDED,
      ] },
    },
    data: {
      completedAt: new Date(),
      errorCode,
      errorMessage,
      status: GenerationTaskStatus.FAILED,
    },
  });
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
  return error instanceof AiProviderError
    ? error.code
    : "GENERATION_FAILED";
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
