import "./instrument";

import {
  createAiRuntimeFromEnv,
  createAmuxClaudeClientFromEnv,
  amuxClaudeClientConfigFromEnv,
  visualSummaryJobId,
} from "@fashion/ai";
import { BillingService } from "@fashion/billing";
import { prisma } from "@fashion/db";
import {
  COLLECTION_SIMILARITY_QUEUE_NAME,
  EXPORT_QUEUE_NAME,
  GENERATION_QUEUE_NAME,
  PLATFORM_NAME,
  THUMBNAIL_QUEUE_NAME,
  VLM_INFERENCE_QUEUE_NAME,
  VISUAL_SUMMARY_QUEUE_NAME,
  VISUAL_SUMMARY_SCHEMA_VERSION,
  type CollectionSimilarityJobData,
  type ExportJobData,
  type GenerationJobData,
  type ThumbnailJobData,
  type VlmInferenceJobData,
  type VisualSummaryJobData,
  type VisualSummarySource,
} from "@fashion/shared";
import { Queue, Worker } from "bullmq";

import { ClipImageEmbedder } from "./clip-embedder";
import {
  createCollectionSimilarityProcessor,
  markCollectionSimilarityFailed,
} from "./processors/collection-similarity.processor";
import { createGenerationProcessor } from "./processors/generation.processor";
import { createImageTransformProcessor } from "./processors/image-transform.processor";
import { IMAGE_TRANSFORM_QUEUE, type ImageTransformJob } from "@fashion/shared";
import {
  cleanupExport,
  cleanupExpiredExports,
  createExportProcessor,
  validateExportFont,
  markExportFailed,
} from "./processors/export.processor";
import { createThumbnailProcessor } from "./processors/thumbnail.processor";
import { createVisualSummaryProcessor } from "./processors/visual-summary.processor";
import {
  AmuxTrendLlmService,
  AnthropicTrendLlmService,
  BraveTrendSearchService,
  S3TrendCoverService,
  TrendDigestProcessor,
} from "./processors/trend.digest.processor";
import {
  createVlmInferenceProcessor,
  markRoleInferenceFailed,
} from "./processors/vlm-inference.processor";
import { S3ThumbnailStorage } from "./storage";
import { AmuxClaudeVlmClassifier } from "./vlm-classifier";
import { AmuxClaudeContentModerationService } from "./content-moderation.service";
import { captureWorkerException, flushWorkerSentry } from "./sentry.config";
import {
  TREND_DIGEST_QUEUE_NAME,
  syncTrendSchedule,
  type TrendDigestJobData,
} from "./queues/trend.queue";

function redisConnection() {
  const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  return {
    host: redisUrl.hostname,
    password: redisUrl.password || undefined,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username || undefined,
  };
}

const storage = new S3ThumbnailStorage();
const imageTransformWorker = new Worker<ImageTransformJob>(IMAGE_TRANSFORM_QUEUE, createImageTransformProcessor(prisma, storage), { connection: redisConnection(), concurrency: 2 });
imageTransformWorker.on("error", (error) => captureWorkerException(error, { phase: "failed", queue: IMAGE_TRANSFORM_QUEUE }));
const amuxClaude = createAmuxClaudeClientFromEnv();
const missingTrendDigestConfiguration = [
  !process.env.BRAVE_SEARCH_API_KEY?.trim() ? "BRAVE_SEARCH_API_KEY" : null,
  !process.env.AMUX_API_KEY?.trim() && !process.env.ANTHROPIC_API_KEY?.trim()
    ? "AMUX_API_KEY 或 ANTHROPIC_API_KEY"
    : null,
].filter((value): value is string => value !== null);
const trendDigestEnabled = missingTrendDigestConfiguration.length === 0;
const trendDigestLlm = process.env.AMUX_API_KEY?.trim()
  ? new AmuxTrendLlmService(amuxClaude)
  : new AnthropicTrendLlmService();
const exportQueue = new Queue<ExportJobData>(EXPORT_QUEUE_NAME, {
  connection: redisConnection(),
});
const processExport = createExportProcessor({
  database: prisma,
  storage,
});
const visualSummaryQueue = new Queue<VisualSummaryJobData>(VISUAL_SUMMARY_QUEUE_NAME, {
  connection: redisConnection(),
});
const visualSummaryJobs = {
  async enqueue(source: VisualSummarySource) {
    const data: VisualSummaryJobData = { source, model: amuxClaudeClientConfigFromEnv().model,
      schemaVersion: VISUAL_SUMMARY_SCHEMA_VERSION };
    await visualSummaryQueue.add("describe", data, {
      attempts: 3, backoff: { type: "exponential", delay: 2_000 },
      jobId: visualSummaryJobId(data),
      removeOnComplete: { age: 7 * 24 * 60 * 60 },
      removeOnFail: { age: 30 * 24 * 60 * 60 },
    });
  },
};
const processVisualSummary = createVisualSummaryProcessor({ database: prisma, storage, client: amuxClaude });
const processThumbnail = createThumbnailProcessor({
  database: prisma,
  storage,
  visualSummaryJobs,
});
const processRoleInference = createVlmInferenceProcessor({
  classifier: new AmuxClaudeVlmClassifier(amuxClaude),
  database: prisma,
  storage,
});
const collectionSimilarityQueue = new Queue<CollectionSimilarityJobData>(
  COLLECTION_SIMILARITY_QUEUE_NAME,
  { connection: redisConnection() },
);
const trendDigestQueue = new Queue<TrendDigestJobData>(
  TREND_DIGEST_QUEUE_NAME,
  { connection: redisConnection() },
);
const trendDigestProcessor = new TrendDigestProcessor({
  covers: new S3TrendCoverService({ database: prisma, storage, visualSummaryJobs }),
  database: prisma,
  llm: trendDigestLlm,
  search: new BraveTrendSearchService(),
  timeZone: process.env.TREND_DIGEST_TIMEZONE?.trim() || "Asia/Shanghai",
});
const processCollectionSimilarity = createCollectionSimilarityProcessor({
  database: prisma,
  embedder: new ClipImageEmbedder(storage),
});
const processGeneration = createGenerationProcessor({
  ai: createAiRuntimeFromEnv(),
  billing: new BillingService(prisma),
  database: prisma,
  moderator: new AmuxClaudeContentModerationService(amuxClaude),
  storage,
  visualSummaryJobs,
  similarityJobs: {
    async enqueue(collectionId, designAssetId) {
      await collectionSimilarityQueue.add(
        "analyze-collection",
        { collectionId, designAssetId },
        {
          attempts: 2,
          backoff: { delay: 2_000, type: "exponential" },
          jobId: designAssetId,
          removeOnComplete: { age: 7 * 24 * 60 * 60 },
          removeOnFail: { age: 30 * 24 * 60 * 60 },
        },
      );
    },
  },
});
const thumbnailWorker = new Worker<ThumbnailJobData>(
  THUMBNAIL_QUEUE_NAME,
  async (job) => processThumbnail(job.data.fileId),
  {
    concurrency: 2,
    connection: redisConnection(),
  },
);
const visualSummaryWorker = new Worker<VisualSummaryJobData>(VISUAL_SUMMARY_QUEUE_NAME,
  async (job) => processVisualSummary(job.data),
  { concurrency: 2, connection: redisConnection(), lockDuration: 120_000, maxStalledCount: 1 });
const inferenceWorker = new Worker<VlmInferenceJobData>(
  VLM_INFERENCE_QUEUE_NAME,
  async (job) => processRoleInference(job.data),
  {
    concurrency: 2,
    connection: redisConnection(),
  },
);
const generationWorker = new Worker<GenerationJobData>(
  GENERATION_QUEUE_NAME,
  async (job, _token, signal) => processGeneration(job, signal),
  {
    concurrency: 2,
    connection: redisConnection(),
    lockDuration: 30_000,
    maxStalledCount: 1,
    stalledInterval: 30_000,
  },
);
const collectionSimilarityWorker = new Worker<CollectionSimilarityJobData>(
  COLLECTION_SIMILARITY_QUEUE_NAME,
  async (job) => processCollectionSimilarity(job.data),
  {
    concurrency: 1,
    connection: redisConnection(),
    lockDuration: 120_000,
    maxStalledCount: 1,
  },
);
const exportWorker = new Worker<ExportJobData>(
  EXPORT_QUEUE_NAME,
  async (job) => {
    if (job.data.action === "sweep") {
      await cleanupExpiredExports(prisma, storage);
      return;
    }
    if (job.data.action === "cleanup") {
      await cleanupExport(
        prisma,
        storage,
        job.data.exportId,
        job.data.objectKey,
      );
      return;
    }
    const result = await processExport(job.data.exportId);
    await exportQueue.add(
      "cleanup",
      {
        action: "cleanup",
        exportId: job.data.exportId,
        objectKey: result.objectKey,
      },
      {
        delay: Math.max(result.expiresAt.getTime() - Date.now(), 0),
        attempts: 10,
        backoff: { delay: 60_000, type: "exponential" },
        jobId: `cleanup-${job.data.exportId}`,
        removeOnComplete: true,
        removeOnFail: { age: 30 * 24 * 60 * 60 },
      },
    );
  },
  {
    concurrency: 1,
    connection: redisConnection(),
    lockDuration: 120_000,
    maxStalledCount: 1,
  },
);
const trendDigestWorker = new Worker<TrendDigestJobData>(
  TREND_DIGEST_QUEUE_NAME,
  async (job) => {
    if (!trendDigestEnabled) {
      await job.log(
        `趋势周报已跳过：缺少 ${missingTrendDigestConfiguration.join("、")}。`,
      );
      return {
        digestPeriod: null,
        failed: 0,
        found: 0,
        processed: 0,
      };
    }
    return trendDigestProcessor.process(job);
  },
  {
    concurrency: 1,
    connection: redisConnection(),
    lockDuration: 10 * 60 * 1_000,
    maxStalledCount: 1,
  },
);

async function start(): Promise<void> {
  validateExportFont();
  await syncTrendSchedule(
    trendDigestQueue,
    trendDigestEnabled,
    process.env.TREND_DIGEST_TIMEZONE?.trim() || "Asia/Shanghai",
  );
  await exportQueue.add(
    "sweep",
    { action: "sweep" },
    {
      jobId: "export-expiry-sweep",
      removeOnComplete: true,
      removeOnFail: { age: 30 * 24 * 60 * 60 },
      repeat: { every: 60 * 60 * 1_000 },
    },
  );
  await Promise.all([
    thumbnailWorker.waitUntilReady(),
    imageTransformWorker.waitUntilReady(),
    visualSummaryWorker.waitUntilReady(),
    inferenceWorker.waitUntilReady(),
    generationWorker.waitUntilReady(),
    collectionSimilarityWorker.waitUntilReady(),
    exportWorker.waitUntilReady(),
    trendDigestWorker.waitUntilReady(),
  ]);
  console.log(
    `${PLATFORM_NAME} Worker 已连接 Redis；生成、缩略图、角色推断与视觉摘要并发数为 2，系列参考相似度、临时导出与趋势周报并发数为 1。`,
  );
  if (!trendDigestEnabled) {
    console.warn(
      `趋势周报调度已禁用并清理：缺少 ${missingTrendDigestConfiguration.join("、")}。补齐配置并重启 Worker 后自动恢复。`,
    );
  }
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`收到 ${signal}，正在关闭 Worker。`);
  await Promise.all([
    imageTransformWorker.close(),
    generationWorker.close(),
    collectionSimilarityWorker.close(),
    exportWorker.close(),
    exportQueue.close(),
    trendDigestWorker.close(),
    trendDigestQueue.close(),
    collectionSimilarityQueue.close(),
    thumbnailWorker.close(),
    visualSummaryWorker.close(),
    visualSummaryQueue.close(),
    inferenceWorker.close(),
  ]);
  await prisma.$disconnect();
  await flushWorkerSentry();
  process.exit(0);
}

thumbnailWorker.on("failed", (job, error) => {
  console.error(`缩略图任务 ${job?.id ?? "unknown"} 失败：`, error);
  captureWorkerException(error, { phase: "failed", queue: "thumbnail" });
});
visualSummaryWorker.on("failed", (job, error) => {
  console.error(`视觉摘要任务 ${job?.id ?? "unknown"} 失败：`, error);
  captureWorkerException(error, { phase: "failed", queue: "visual-summary" });
});
inferenceWorker.on("failed", (job, error) => {
  console.error(`角色推断任务 ${job?.id ?? "unknown"} 失败：`, error);
  captureWorkerException(error, {
    phase: "failed",
    queue: "vlm-inference",
  });
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    void markRoleInferenceFailed(prisma, job.data).catch((fallbackError) => {
      console.error("角色推断最终回退状态写入失败：", fallbackError);
      captureWorkerException(fallbackError, {
        phase: "fallback",
        queue: "vlm-inference",
      });
    });
  }
});
generationWorker.on("failed", (job, error) => {
  console.error(`生成任务 ${job?.id ?? "unknown"} 失败：`, error);
  captureWorkerException(error, { phase: "failed", queue: "generation" });
});
collectionSimilarityWorker.on("failed", (job, error) => {
  console.error(`系列参考相似度任务 ${job?.id ?? "unknown"} 失败：`, error);
  captureWorkerException(error, {
    phase: "failed",
    queue: "collection-similarity",
  });
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    void markCollectionSimilarityFailed(prisma, job.data).catch(
      (fallbackError) => {
        console.error("系列参考相似度失败状态写入失败：", fallbackError);
        captureWorkerException(fallbackError, {
          phase: "fallback",
          queue: "collection-similarity",
        });
      },
    );
  }
});
exportWorker.on("failed", (job, error) => {
  console.error(`导出任务 ${job?.id ?? "unknown"} 失败：`, error);
  captureWorkerException(error, { phase: "failed", queue: "export" });
  if (
    job?.data.action === "render" &&
    job.attemptsMade >= (job.opts.attempts ?? 1)
  ) {
    void markExportFailed(prisma, job.data.exportId, error.message).catch(
      (fallbackError) => {
        console.error("导出任务最终失败状态写入失败：", fallbackError);
        captureWorkerException(fallbackError, {
          phase: "fallback",
          queue: "export",
        });
      },
    );
  }
});
trendDigestWorker.on("failed", (job, error) => {
  console.error(`趋势周报任务 ${job?.id ?? "unknown"} 失败：`, error);
  captureWorkerException(error, { phase: "failed", queue: "trend-digest" });
});

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

void start().catch(async (error: unknown) => {
  console.error("Worker 启动失败：无法连接 Redis 或对象存储配置无效。", error);
  captureWorkerException(error, { phase: "bootstrap", queue: "worker" });
  await Promise.all([
    imageTransformWorker.close(),
    generationWorker.close(),
    collectionSimilarityWorker.close(),
    exportWorker.close(),
    exportQueue.close(),
    trendDigestWorker.close(),
    trendDigestQueue.close(),
    collectionSimilarityQueue.close(),
    thumbnailWorker.close(),
    visualSummaryWorker.close(),
    visualSummaryQueue.close(),
    inferenceWorker.close(),
  ]);
  await prisma.$disconnect();
  await flushWorkerSentry();
  process.exitCode = 1;
});
