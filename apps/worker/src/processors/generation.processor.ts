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
import { DelayedError, UnrecoverableError, type Job } from "bullmq";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp from "sharp";
import { z } from "zod";

import type {
  ContentModerationDecision,
  ContentModerationService,
} from "../content-moderation.service";
import type { ThumbnailStorage } from "../storage";

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

const MAX_GENERATED_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_GENERATED_IMAGE_PIXELS = 40_000_000;
const GENERATION_LEASE_MS = 30_000;
const GENERATION_HEARTBEAT_MS = 10_000;
const GENERATION_LEASE_RETRY_PADDING_MS = 250;
const MAX_GENERATED_IMAGE_REDIRECTS = 3;
const PROVIDER_CANCEL_TIMEOUT_MS = 5_000;
const MATERIALIZED_OBJECT_DELETE_ATTEMPTS = 3;
const MATERIALIZED_OBJECT_DELETE_RETRY_BASE_MS = 25;
const ALLOWED_GENERATED_IMAGE_TYPES = new Set([
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type GenerationDatabase = Pick<
  PrismaClient,
  "$transaction" | "collectionLook" | "designAsset" | "generationTask"
>;

type GenerationAi = Pick<
  AiRuntimeService,
  "getResult" | "getStatus" | "submit"
> &
  Partial<Pick<AiRuntimeService, "cancel">>;

type GenerationHostnameResolver = (
  hostname: string,
) => Promise<readonly string[]>;

export interface GenerationProcessorDependencies {
  readonly ai: GenerationAi;
  readonly billing: Pick<BillingService, "incrementCount">;
  readonly database: GenerationDatabase;
  readonly heartbeatIntervalMs?: number;
  readonly moderator: ContentModerationService;
  readonly pollIntervalMs?: number;
  readonly providerCancelTimeoutMs?: number;
  readonly resolveHostname?: GenerationHostnameResolver;
  readonly similarityJobs?: {
    enqueue(collectionId: string, designAssetId: string): Promise<void>;
  };
  readonly storage?: ThumbnailStorage;
  readonly timeoutMs?: number;
}

class GenerationCanceledError extends Error {}
class GenerationTimedOutError extends Error {}
class GenerationLeaseLostError extends UnrecoverableError {}
class GenerationStateConflictError extends UnrecoverableError {}
class ContentModerationUnavailableError extends Error {}

export function createGenerationProcessor({
  ai,
  billing,
  database,
  heartbeatIntervalMs = GENERATION_HEARTBEAT_MS,
  moderator,
  pollIntervalMs = 500,
  providerCancelTimeoutMs = PROVIDER_CANCEL_TIMEOUT_MS,
  resolveHostname = resolveGeneratedImageHostname,
  similarityJobs,
  storage,
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
    if (task.status === GenerationTaskStatus.SUCCEEDED) {
      return { skipped: true, status: "succeeded", taskId: task.id };
    }

    if (
      task.status !== GenerationTaskStatus.QUEUED &&
      task.status !== GenerationTaskStatus.RUNNING
    ) {
      throw new UnrecoverableError("生成任务当前不可领取");
    }
    const claimedAt = new Date();
    if (
      task.status === GenerationTaskStatus.RUNNING &&
      task.updatedAt.getTime() > claimedAt.getTime() - GENERATION_LEASE_MS
    ) {
      return delayForActiveLease(job, task.updatedAt);
    }
    const claimed = await database.generationTask.updateMany({
      where: {
        attemptCount: task.attemptCount,
        id: task.id,
        status: task.status,
        ...(task.status === GenerationTaskStatus.RUNNING
          ? { updatedAt: task.updatedAt }
          : {}),
        userId: job.data.userId,
      },
      data: {
        attemptCount: { increment: 1 },
        errorCode: null,
        errorMessage: null,
        startedAt: task.startedAt ?? claimedAt,
        status: GenerationTaskStatus.RUNNING,
        updatedAt: claimedAt,
      },
    });
    if (claimed.count !== 1) {
      const current = await database.generationTask.findUnique({
        where: { id: task.id },
        select: { status: true, updatedAt: true },
      });
      if (current?.status === GenerationTaskStatus.CANCELED) {
        return {
          skipped: true,
          status: "canceled",
          taskId: task.id,
        };
      }
      if (current?.status === GenerationTaskStatus.MODERATION_FAILED) {
        return {
          skipped: true,
          status: "moderation_failed",
          taskId: task.id,
        };
      }
      if (current?.status === GenerationTaskStatus.SUCCEEDED) {
        return {
          skipped: true,
          status: "succeeded",
          taskId: task.id,
        };
      }
      if (current?.status === GenerationTaskStatus.RUNNING) {
        return delayForActiveLease(job, current.updatedAt);
      }
      throw new UnrecoverableError("生成任务当前不可领取");
    }
    const leaseAttempt = task.attemptCount + 1;
    await updateProgressSafely(job, event(task.id, "running"));

    const timeoutController = new AbortController();
    const leaseController = new AbortController();
    const timeout = setTimeout(
      () =>
        timeoutController.abort(
          new GenerationTimedOutError("生成任务超过 120 秒"),
        ),
      timeoutMs,
    );
    const signal = AbortSignal.any([
      timeoutController.signal,
      leaseController.signal,
      ...(workerSignal ? [workerSignal] : []),
    ]);
    const stopLeaseHeartbeat = startLeaseHeartbeat(
      database,
      task.id,
      leaseAttempt,
      leaseController,
      heartbeatIntervalMs,
    );
    let materializedObjectKeys: string[] = [];
    let materializationCommitted = false;

    try {
      const result = await executeGeneration({
        ai,
        attemptCount: leaseAttempt,
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
          leaseAttempt,
          moderation.categories,
        );
        await updateProgressSafely(job, event(task.id, finalStatus));
        return {
          ...(finalStatus === "canceled" ? { skipped: true as const } : {}),
          status: finalStatus,
          taskId: task.id,
        };
      }
      if (moderation.status === "review_required") {
        throw new ContentModerationUnavailableError(
          moderation.reason === "timeout"
            ? "内容审核服务响应超时"
            : "内容审核服务暂时不可用",
        );
      }
      let durableResult = result;
      if (storage && task.projectId) {
        const materialized = await materializeResult(
          storage,
          task.userId,
          task.id,
          leaseAttempt,
          result,
          resolveHostname,
          signal,
        );
        durableResult = materialized.result;
        materializedObjectKeys = materialized.objectKeys;
      }
      const finalStatus = await persistSuccessOnce(
        database,
        billing,
        task.id,
        task.userId,
        leaseAttempt,
        durableResult,
        moderation,
        {
          collectionId: task.collectionId,
          parentAssetId: task.parentAssetId,
          projectId: task.projectId,
          taskType: task.taskType,
          variationAxis: task.variationAxis,
        },
      );
      materializationCommitted = finalStatus === "succeeded";
      if (finalStatus === "canceled" && storage) {
        await deleteMaterializedObjects(storage, materializedObjectKeys);
        materializedObjectKeys = [];
      }
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
      if (!materializationCommitted && storage) {
        await deleteMaterializedObjects(storage, materializedObjectKeys);
        materializedObjectKeys = [];
      }
      if (
        error instanceof GenerationLeaseLostError ||
        error instanceof GenerationStateConflictError
      ) {
        await updateProgressSafely(job, event(task.id, "failed"));
        throw error;
      }
      if (error instanceof GenerationCanceledError) {
        await cancelProviderJobSafely(
          ai,
          database,
          task.id,
          providerCancelTimeoutMs,
        );
        await markCanceled(database, task.id, leaseAttempt);
        await updateProgressSafely(job, event(task.id, "canceled"));
        return {
          skipped: true,
          status: "canceled",
          taskId: task.id,
        };
      }

      if (timeoutController.signal.aborted) {
        await cancelProviderJobSafely(
          ai,
          database,
          task.id,
          providerCancelTimeoutMs,
        );
        const finalStatus = await markFinalFailure(
          database,
          task.id,
          leaseAttempt,
          "GENERATION_TIMEOUT",
          "生成任务超过 120 秒",
        );
        await updateProgressSafely(job, event(task.id, finalStatus));
        if (finalStatus === "canceled") {
          return {
            skipped: true,
            status: "canceled",
            taskId: task.id,
          };
        }
        throw new UnrecoverableError("生成任务超过 120 秒");
      }

      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      const retryable = !(error instanceof AiProviderError) || error.retryable;
      if (!finalAttempt && retryable) {
        const released = await database.generationTask.updateMany({
          where: {
            attemptCount: leaseAttempt,
            id: task.id,
            status: GenerationTaskStatus.RUNNING,
          },
          data: {
            errorCode: standardErrorCode(error),
            errorMessage: safeErrorMessage(error),
            status: GenerationTaskStatus.QUEUED,
          },
        });
        if (released.count !== 1) {
          if (await isCanceled(database, task.id)) {
            await cancelProviderJobSafely(
              ai,
              database,
              task.id,
              providerCancelTimeoutMs,
            );
            await updateProgressSafely(job, event(task.id, "canceled"));
            return {
              skipped: true,
              status: "canceled",
              taskId: task.id,
            };
          }
          throw new GenerationLeaseLostError("生成任务执行租约已失效");
        }
        await updateProgressSafely(job, event(task.id, "queued"));
        throw error;
      }

      const finalStatus = await markFinalFailure(
        database,
        task.id,
        leaseAttempt,
        standardErrorCode(error),
        safeErrorMessage(error),
      );
      await updateProgressSafely(job, event(task.id, finalStatus));
      if (finalStatus === "canceled") {
        await cancelProviderJobSafely(
          ai,
          database,
          task.id,
          providerCancelTimeoutMs,
        );
        return {
          skipped: true,
          status: "canceled",
          taskId: task.id,
        };
      }
      if (!retryable) {
        throw new UnrecoverableError(safeErrorMessage(error));
      }
      throw error;
    } finally {
      stopLeaseHeartbeat();
      clearTimeout(timeout);
    }
  };
}

async function executeGeneration({
  ai,
  attemptCount,
  database,
  input,
  providerJob,
  signal,
  taskId,
  pollIntervalMs,
}: {
  ai: GenerationAi;
  attemptCount: number;
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
    await assertActive(database, taskId, attemptCount);
    remoteJob = await ai.submit(request, signal);
    const saved = await database.generationTask.updateMany({
      where: {
        attemptCount,
        id: taskId,
        status: GenerationTaskStatus.RUNNING,
      },
      data: { providerJob: toJson(remoteJob) },
    });
    if (saved.count !== 1) {
      throw new GenerationLeaseLostError("生成任务执行租约已失效");
    }
  }

  while (true) {
    await assertActive(database, taskId, attemptCount);
    assertNotAborted(signal);
    const status = await ai.getStatus(remoteJob, signal);
    if (status.status === "completed") {
      break;
    }
    await wait(pollIntervalMs, signal);
  }

  await assertActive(database, taskId, attemptCount);
  return ai.getResult(remoteJob, signal);
}

async function persistSuccessOnce(
  database: GenerationDatabase,
  billing: Pick<BillingService, "incrementCount">,
  taskId: string,
  userId: string,
  attemptCount: number,
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
        attemptCount,
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
    if (current?.status === GenerationTaskStatus.CANCELED) {
      return "canceled";
    }
    if (current?.status === GenerationTaskStatus.SUCCEEDED) {
      return "succeeded";
    }
    throw new GenerationStateConflictError(
      `生成任务成功落库状态冲突：${current?.status ?? "NOT_FOUND"}`,
    );
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
    const materialized = image as typeof image & { readonly assetId?: string };
    const assetId = materialized.assetId ?? randomUUID();
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
        thumbnailUrl:
          "thumbnailUrl" in materialized &&
          typeof materialized.thumbnailUrl === "string"
            ? materialized.thumbnailUrl
            : image.url,
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
    images.push({
      ...image,
      assetId,
      url: `/api/design-assets/${encodeURIComponent(assetId)}/content`,
    });
  }
  return { ...result, images };
}

async function materializeResult(
  storage: ThumbnailStorage,
  userId: string,
  taskId: string,
  attemptCount: number,
  result: AiProviderResult,
  resolveHostname: GenerationHostnameResolver,
  signal: AbortSignal,
): Promise<{
  readonly objectKeys: string[];
  readonly result: AiProviderResult;
}> {
  const images = [];
  const objectKeys: string[] = [];
  try {
    for (const [index, image] of result.images.entries()) {
      const response = await fetchImageResponse(
        image.url,
        resolveHostname,
        signal,
      );
      if (!response.ok) {
        throw new Error(`生成结果下载失败（HTTP ${response.status}）`);
      }
      const contentType = response.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase();
      if (!contentType || !ALLOWED_GENERATED_IMAGE_TYPES.has(contentType)) {
        throw new Error("生成结果 Content-Type 不受支持");
      }
      assertDeclaredImageSize(response.headers.get("content-length"));
      const body = await readBodyWithLimit(response, MAX_GENERATED_IMAGE_BYTES);
      if (body.byteLength === 0) {
        throw new Error("生成结果为空");
      }
      const metadata = await sharp(body, {
        failOn: "error",
        limitInputPixels: MAX_GENERATED_IMAGE_PIXELS,
      }).metadata();
      if (!metadata.format || !metadata.height || !metadata.width) {
        throw new Error("生成结果不是有效图片");
      }
      const assetId = `${taskId}-${index + 1}`;
      const attemptPrefix = `generated/${userId}/${assetId}/attempt-${attemptCount}`;
      const contentKey = `${attemptPrefix}/source`;
      const thumbnailKey = `${attemptPrefix}/thumbnail-1024.webp`;
      const thumbnail = await sharp(body, {
        failOn: "error",
        limitInputPixels: MAX_GENERATED_IMAGE_PIXELS,
      })
        .rotate()
        .resize({
          fit: "inside",
          height: 1_024,
          width: 1_024,
          withoutEnlargement: true,
        })
        .webp({ quality: 84 })
        .toBuffer();
      objectKeys.push(contentKey);
      await storage.put(contentKey, body, contentType);
      objectKeys.push(thumbnailKey);
      await storage.put(thumbnailKey, thumbnail, "image/webp");
      images.push({
        ...image,
        assetId,
        contentType,
        height: image.height ?? metadata.height,
        thumbnailUrl: `s3://${thumbnailKey}`,
        url: `s3://${contentKey}`,
        width: image.width ?? metadata.width,
      });
    }
  } catch (error) {
    await deleteMaterializedObjects(storage, objectKeys);
    throw error;
  }
  return {
    objectKeys,
    result: { ...result, images },
  };
}

async function fetchImageResponse(
  value: string,
  resolveHostname: GenerationHostnameResolver,
  signal: AbortSignal,
): Promise<Response> {
  let current = safeImageUrl(value);
  for (let redirectCount = 0; ; redirectCount += 1) {
    await assertHostnameResolvesPublicly(current, resolveHostname);
    const response = await fetch(current.toString(), {
      redirect: "manual",
      signal,
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }
    if (redirectCount >= MAX_GENERATED_IMAGE_REDIRECTS) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("生成结果重定向次数超过限制");
    }
    const location = response.headers.get("location");
    if (!location) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("生成结果重定向缺少 Location");
    }
    try {
      current = safeImageUrl(new URL(location, current).toString());
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
  }
}

async function resolveGeneratedImageHostname(
  hostname: string,
): Promise<string[]> {
  const addresses = await lookup(hostname, {
    all: true,
    verbatim: true,
  });
  return addresses.map(({ address }) => address);
}

async function assertHostnameResolvesPublicly(
  url: URL,
  resolveHostname: GenerationHostnameResolver,
): Promise<void> {
  const hostname = normalizedHostname(url);
  if (isIP(hostname) !== 0) {
    return;
  }

  let addresses: readonly string[];
  try {
    addresses = await resolveHostname(hostname);
  } catch {
    throw new Error("生成结果域名解析失败");
  }
  if (
    addresses.length === 0 ||
    addresses.some((address) => isIP(address) === 0)
  ) {
    throw new Error("生成结果域名解析失败");
  }
  if (addresses.some((address) => isPrivateIpLiteral(address))) {
    throw new Error("生成结果域名解析到不允许的地址");
  }

  // 标准 fetch 不暴露已解析地址绑定能力；网络出口仍需防御校验与连接间的 DNS rebinding。
}

function safeImageUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("生成结果 URL 无效");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("生成结果仅允许 HTTPS URL");
  }
  const hostname = normalizedHostname(parsed);
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    isPrivateIpLiteral(hostname)
  ) {
    throw new Error("生成结果 URL 不允许指向本机或私网地址");
  }
  return parsed;
}

function normalizedHostname(url: URL): string {
  return url.hostname
    .replace(/^\[|\]$/gu, "")
    .replace(/\.$/u, "")
    .toLowerCase();
}

function isPrivateIpLiteral(hostname: string): boolean {
  const family = isIP(hostname);
  if (family === 4) {
    const [first = 0, second = 0] = hostname
      .split(".")
      .map((part) => Number(part));
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      first >= 224
    );
  }
  if (family === 6) {
    const normalized = hostname.toLowerCase();
    const firstGroup = Number.parseInt(normalized.split(":")[0] || "0", 16);
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("::ffff:") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      (firstGroup & 0xffc0) === 0xfe80 ||
      (firstGroup & 0xff00) === 0xff00
    );
  }
  return false;
}

async function deleteMaterializedObjects(
  storage: ThumbnailStorage,
  objectKeys: readonly string[],
): Promise<void> {
  await Promise.all(
    [...new Set(objectKeys)].map((objectKey) =>
      deleteMaterializedObject(storage, objectKey),
    ),
  );
}

async function deleteMaterializedObject(
  storage: ThumbnailStorage,
  objectKey: string,
): Promise<void> {
  for (
    let attempt = 1;
    attempt <= MATERIALIZED_OBJECT_DELETE_ATTEMPTS;
    attempt += 1
  ) {
    try {
      await storage.delete(objectKey);
      return;
    } catch {
      if (attempt === MATERIALIZED_OBJECT_DELETE_ATTEMPTS) {
        return;
      }
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          MATERIALIZED_OBJECT_DELETE_RETRY_BASE_MS * 2 ** (attempt - 1),
        ),
      );
    }
  }
}

function assertDeclaredImageSize(value: string | null): void {
  if (value === null) {
    return;
  }
  const declaredSize = Number(value);
  if (!Number.isSafeInteger(declaredSize) || declaredSize < 0) {
    throw new Error("生成结果 Content-Length 无效");
  }
  if (declaredSize > MAX_GENERATED_IMAGE_BYTES) {
    throw new Error("生成结果超过 25MB，拒绝持久化");
  }
}

async function readBodyWithLimit(
  response: Response,
  limit: number,
): Promise<Buffer> {
  if (!response.body) {
    throw new Error("生成结果响应体为空");
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new Error("生成结果超过 25MB，拒绝持久化");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function operationFrom(taskType: string): DesignAssetOperation {
  if (taskType === "inpaint") return DesignAssetOperation.INPAINT;
  if (taskType === "i2i") return DesignAssetOperation.VARIATION;
  return DesignAssetOperation.GENERATED;
}

async function delayForActiveLease(
  job: Job<GenerationJobData>,
  leaseUpdatedAt: Date,
): Promise<never> {
  const retryAt = Math.max(
    Date.now() + GENERATION_LEASE_RETRY_PADDING_MS,
    leaseUpdatedAt.getTime() +
      GENERATION_LEASE_MS +
      GENERATION_LEASE_RETRY_PADDING_MS,
  );
  await job.moveToDelayed(retryAt, job.token);
  throw new DelayedError();
}

function startLeaseHeartbeat(
  database: GenerationDatabase,
  taskId: string,
  attemptCount: number,
  controller: AbortController,
  heartbeatIntervalMs: number,
): () => void {
  let refreshing = false;
  const heartbeat = setInterval(() => {
    if (refreshing || controller.signal.aborted) {
      return;
    }
    refreshing = true;
    void (async () => {
      try {
        const updated = await database.generationTask.updateMany({
          where: {
            attemptCount,
            id: taskId,
            status: GenerationTaskStatus.RUNNING,
          },
          data: { updatedAt: new Date() },
        });
        if (updated.count === 1 || controller.signal.aborted) {
          return;
        }
        const current = await database.generationTask.findUnique({
          where: { id: taskId },
          select: { status: true },
        });
        controller.abort(
          current?.status === GenerationTaskStatus.CANCELED
            ? new GenerationCanceledError("生成任务已取消")
            : new GenerationLeaseLostError("生成任务执行租约已失效"),
        );
      } catch {
        if (!controller.signal.aborted) {
          controller.abort(
            new GenerationLeaseLostError("生成任务租约刷新失败"),
          );
        }
      } finally {
        refreshing = false;
      }
    })();
  }, heartbeatIntervalMs);
  heartbeat.unref();
  return () => clearInterval(heartbeat);
}

async function assertActive(
  database: GenerationDatabase,
  taskId: string,
  attemptCount: number,
): Promise<void> {
  const current = await database.generationTask.findUnique({
    where: { id: taskId },
    select: { attemptCount: true, status: true },
  });
  if (current?.status === GenerationTaskStatus.CANCELED) {
    throw new GenerationCanceledError("生成任务已取消");
  }
  if (!current) {
    throw new UnrecoverableError("生成任务不存在");
  }
  if (
    current.status !== GenerationTaskStatus.RUNNING ||
    current.attemptCount !== attemptCount
  ) {
    throw new GenerationLeaseLostError("生成任务执行租约已失效");
  }
}

async function cancelProviderJobSafely(
  ai: GenerationAi,
  database: GenerationDatabase,
  taskId: string,
  timeoutMs: number,
): Promise<void> {
  if (!ai.cancel) {
    return;
  }
  try {
    const current = await database.generationTask.findUnique({
      where: { id: taskId },
      select: { providerJob: true },
    });
    const remoteJob = providerJobSchema.safeParse(current?.providerJob);
    if (remoteJob.success) {
      await settleBeforeTimeout(ai.cancel(remoteJob.data), timeoutMs);
    }
  } catch {
    // 数据库中的取消状态优先；远端取消仅作为资源补偿。
  }
}

async function settleBeforeTimeout(
  operation: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Provider cancel timeout")),
      Math.max(0, timeoutMs),
    );
    void operation.then(
      () => {
        clearTimeout(timeout);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function isCanceled(
  database: GenerationDatabase,
  taskId: string,
): Promise<boolean> {
  const current = await database.generationTask.findUnique({
    where: { id: taskId },
    select: { status: true },
  });
  return current?.status === GenerationTaskStatus.CANCELED;
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
  attemptCount: number,
): Promise<void> {
  await database.generationTask.updateMany({
    where: {
      attemptCount,
      id: taskId,
      status: GenerationTaskStatus.CANCELED,
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
  attemptCount: number,
  categories: readonly string[],
): Promise<"canceled" | "moderation_failed"> {
  const completedAt = new Date();
  const updated = await database.generationTask.updateMany({
    where: {
      attemptCount,
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
  if (current?.status === GenerationTaskStatus.CANCELED) {
    return "canceled";
  }
  if (current?.status === GenerationTaskStatus.MODERATION_FAILED) {
    return "moderation_failed";
  }
  throw new GenerationLeaseLostError("生成任务执行租约已失效");
}

async function markFinalFailure(
  database: GenerationDatabase,
  taskId: string,
  attemptCount: number,
  errorCode: string,
  errorMessage: string,
): Promise<"canceled" | "failed"> {
  const updated = await database.generationTask.updateMany({
    where: {
      attemptCount,
      id: taskId,
      status: GenerationTaskStatus.RUNNING,
    },
    data: {
      completedAt: new Date(),
      errorCode,
      errorMessage,
      status: GenerationTaskStatus.FAILED,
    },
  });
  if (updated.count === 1) {
    return "failed";
  }
  if (await isCanceled(database, taskId)) {
    return "canceled";
  }
  throw new GenerationLeaseLostError("生成任务执行租约已失效");
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
  if (error instanceof ContentModerationUnavailableError) {
    return "CONTENT_MODERATION_UNAVAILABLE";
  }
  return error instanceof AiProviderError ? error.code : "GENERATION_FAILED";
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof ContentModerationUnavailableError) {
    return `${error.message}，请稍后重试`;
  }
  if (error instanceof AiProviderError) {
    return error.message.slice(0, 500);
  }
  return "生成失败，请稍后重试";
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
