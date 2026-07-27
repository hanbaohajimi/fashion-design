import type { GenerationJobData } from "@fashion/shared";
import { Queue } from "bullmq";
import { describe, expect, it } from "vitest";

import { GenerationEventsService } from "./generation-events.service";

function redisConnection() {
  const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  return {
    host: redisUrl.hostname,
    password: redisUrl.password || undefined,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username || undefined,
  };
}

describe("GenerationEventsService", () => {
  it("QueueEvents 状态在 1 秒内推送给 SSE 订阅者", async () => {
    const queueName = `generation-events-${crypto.randomUUID()}`;
    const taskId = crypto.randomUUID();
    const service = new GenerationEventsService(queueName);
    const queue = new Queue<GenerationJobData>(queueName, {
      connection: redisConnection(),
    });

    try {
      const stream = await service.stream({
        taskId,
        status: "queued",
        timestamp: new Date().toISOString(),
      });
      let pushedAt = 0;
      const running = new Promise<void>((resolve) => {
        stream.subscribe((message) => {
          if (
            typeof message.data === "object" &&
            message.data !== null &&
            "status" in message.data &&
            message.data.status === "running"
          ) {
            pushedAt = Date.now();
            resolve();
          }
        });
      });
      const job = await queue.add(
        "generate",
        { taskId, userId: "user-1" },
        { jobId: taskId },
      );
      const emittedAt = Date.now();
      await job.updateProgress({
        taskId,
        status: "running",
        timestamp: new Date().toISOString(),
      });

      await Promise.race([
        running,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("SSE 状态未在 1 秒内到达")),
            1_000,
          ),
        ),
      ]);
      expect(pushedAt - emittedAt).toBeLessThan(1_000);
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
      await service.onModuleDestroy();
    }
  });
});
