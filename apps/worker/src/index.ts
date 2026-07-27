import "./load-env";

import { prisma } from "@fashion/db";
import {
  PLATFORM_NAME,
  THUMBNAIL_QUEUE_NAME,
  type ThumbnailJobData,
} from "@fashion/shared";
import { Worker } from "bullmq";

import { createThumbnailProcessor } from "./processors/thumbnail.processor";
import { S3ThumbnailStorage } from "./storage";

function redisConnection() {
  const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  return {
    host: redisUrl.hostname,
    password: redisUrl.password || undefined,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username || undefined,
  };
}

const processThumbnail = createThumbnailProcessor({
  database: prisma,
  storage: new S3ThumbnailStorage(),
});
const worker = new Worker<ThumbnailJobData>(
  THUMBNAIL_QUEUE_NAME,
  async (job) => processThumbnail(job.data.fileId),
  {
    concurrency: 2,
    connection: redisConnection(),
  },
);

async function start(): Promise<void> {
  await worker.waitUntilReady();
  console.log(`${PLATFORM_NAME} Worker 已连接 Redis，缩略图队列并发数：2。`);
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`收到 ${signal}，正在关闭 Worker。`);
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

worker.on("failed", (job, error) => {
  console.error(`缩略图任务 ${job?.id ?? "unknown"} 失败：`, error);
});

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

void start().catch(async (error: unknown) => {
  console.error("Worker 启动失败：无法连接 Redis 或对象存储配置无效。", error);
  await worker.close();
  await prisma.$disconnect();
  process.exitCode = 1;
});
