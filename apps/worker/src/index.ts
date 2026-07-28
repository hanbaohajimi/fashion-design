import "./load-env";

import { createAiRuntimeFromEnv } from "@fashion/ai";
import { BillingService } from "@fashion/billing";
import { prisma } from "@fashion/db";
import {
  COLLECTION_SIMILARITY_QUEUE_NAME,
  EXPORT_QUEUE_NAME,
  GENERATION_QUEUE_NAME,
  PLATFORM_NAME,
  THUMBNAIL_QUEUE_NAME,
  VLM_INFERENCE_QUEUE_NAME,
  type CollectionSimilarityJobData,
  type ExportJobData,
  type GenerationJobData,
  type ThumbnailJobData,
  type VlmInferenceJobData,
} from "@fashion/shared";
import { Queue, Worker } from "bullmq";

import { ClipImageEmbedder } from "./clip-embedder";
import {
  createCollectionSimilarityProcessor,
  markCollectionSimilarityFailed,
} from "./processors/collection-similarity.processor";
import { createGenerationProcessor } from "./processors/generation.processor";
import {
  cleanupExport,
  cleanupExpiredExports,
  createExportProcessor,
  markExportFailed,
} from "./processors/export.processor";
import { createThumbnailProcessor } from "./processors/thumbnail.processor";
import {
  createVlmInferenceProcessor,
  markRoleInferenceFailed,
} from "./processors/vlm-inference.processor";
import { S3ThumbnailStorage } from "./storage";
import { OpenAiVlmClassifier } from "./vlm-classifier";

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
const exportQueue = new Queue<ExportJobData>(EXPORT_QUEUE_NAME, {
  connection: redisConnection(),
});
const processExport = createExportProcessor({
  database: prisma,
  storage,
});
const processThumbnail = createThumbnailProcessor({
  database: prisma,
  storage,
});
const processRoleInference = createVlmInferenceProcessor({
  classifier: new OpenAiVlmClassifier(),
  database: prisma,
  storage,
});
const collectionSimilarityQueue = new Queue<CollectionSimilarityJobData>(
  COLLECTION_SIMILARITY_QUEUE_NAME,
  { connection: redisConnection() },
);
const processCollectionSimilarity = createCollectionSimilarityProcessor({
  database: prisma,
  embedder: new ClipImageEmbedder(),
});
const processGeneration = createGenerationProcessor({
  ai: createAiRuntimeFromEnv(),
  billing: new BillingService(prisma),
  database: prisma,
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

async function start(): Promise<void> {
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
    inferenceWorker.waitUntilReady(),
    generationWorker.waitUntilReady(),
    collectionSimilarityWorker.waitUntilReady(),
    exportWorker.waitUntilReady(),
  ]);
  console.log(
    `${PLATFORM_NAME} Worker 已连接 Redis；生成、缩略图、角色推断并发数为 2，系列参考相似度与临时导出并发数为 1。`,
  );
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`收到 ${signal}，正在关闭 Worker。`);
  await Promise.all([
    generationWorker.close(),
    collectionSimilarityWorker.close(),
    exportWorker.close(),
    exportQueue.close(),
    collectionSimilarityQueue.close(),
    thumbnailWorker.close(),
    inferenceWorker.close(),
  ]);
  await prisma.$disconnect();
  process.exit(0);
}

thumbnailWorker.on("failed", (job, error) => {
  console.error(`缩略图任务 ${job?.id ?? "unknown"} 失败：`, error);
});
inferenceWorker.on("failed", (job, error) => {
  console.error(`角色推断任务 ${job?.id ?? "unknown"} 失败：`, error);
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    void markRoleInferenceFailed(prisma, job.data).catch((fallbackError) => {
      console.error("角色推断最终回退状态写入失败：", fallbackError);
    });
  }
});
generationWorker.on("failed", (job, error) => {
  console.error(`生成任务 ${job?.id ?? "unknown"} 失败：`, error);
});
collectionSimilarityWorker.on("failed", (job, error) => {
  console.error(`系列参考相似度任务 ${job?.id ?? "unknown"} 失败：`, error);
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    void markCollectionSimilarityFailed(prisma, job.data).catch(
      (fallbackError) => {
        console.error("系列参考相似度失败状态写入失败：", fallbackError);
      },
    );
  }
});
exportWorker.on("failed", (job, error) => {
  console.error(`导出任务 ${job?.id ?? "unknown"} 失败：`, error);
  if (
    job?.data.action === "render" &&
    job.attemptsMade >= (job.opts.attempts ?? 1)
  ) {
    void markExportFailed(prisma, job.data.exportId, error.message).catch(
      (fallbackError) => {
        console.error("导出任务最终失败状态写入失败：", fallbackError);
      },
    );
  }
});

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

void start().catch(async (error: unknown) => {
  console.error("Worker 启动失败：无法连接 Redis 或对象存储配置无效。", error);
  await Promise.all([
    generationWorker.close(),
    collectionSimilarityWorker.close(),
    exportWorker.close(),
    exportQueue.close(),
    collectionSimilarityQueue.close(),
    thumbnailWorker.close(),
    inferenceWorker.close(),
  ]);
  await prisma.$disconnect();
  process.exitCode = 1;
});
