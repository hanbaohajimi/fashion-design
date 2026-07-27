import "./load-env";

import { prisma } from "@fashion/db";
import {
  PLATFORM_NAME,
  THUMBNAIL_QUEUE_NAME,
  VLM_INFERENCE_QUEUE_NAME,
  type ThumbnailJobData,
  type VlmInferenceJobData,
} from "@fashion/shared";
import { Worker } from "bullmq";

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
const processThumbnail = createThumbnailProcessor({
  database: prisma,
  storage,
});
const processRoleInference = createVlmInferenceProcessor({
  classifier: new OpenAiVlmClassifier(),
  database: prisma,
  storage,
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

async function start(): Promise<void> {
  await Promise.all([
    thumbnailWorker.waitUntilReady(),
    inferenceWorker.waitUntilReady(),
  ]);
  console.log(
    `${PLATFORM_NAME} Worker 已连接 Redis，缩略图与角色推断队列并发数均为 2。`,
  );
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`收到 ${signal}，正在关闭 Worker。`);
  await Promise.all([thumbnailWorker.close(), inferenceWorker.close()]);
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

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

void start().catch(async (error: unknown) => {
  console.error("Worker 启动失败：无法连接 Redis 或对象存储配置无效。", error);
  await Promise.all([thumbnailWorker.close(), inferenceWorker.close()]);
  await prisma.$disconnect();
  process.exitCode = 1;
});
