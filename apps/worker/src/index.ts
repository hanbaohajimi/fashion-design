import { PLATFORM_NAME } from "@fashion/shared";
import { Queue } from "bullmq";

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
const port = Number(redisUrl.port || 6379);

const queue = new Queue("ai-generation", {
  connection: {
    host: redisUrl.hostname,
    password: redisUrl.password || undefined,
    port,
    username: redisUrl.username || undefined,
  },
});

async function start(): Promise<void> {
  await queue.waitUntilReady();
  console.log(`${PLATFORM_NAME} Worker 已连接 Redis，等待后续任务处理器注册。`);
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`收到 ${signal}，正在关闭 Worker。`);
  await queue.close();
  process.exit(0);
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

void start().catch(async (error: unknown) => {
  console.error("Worker 启动失败：无法连接 Redis。", error);
  await queue.close();
  process.exitCode = 1;
});
