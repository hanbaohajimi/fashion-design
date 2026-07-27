import type { GenerationJobData } from "@fashion/shared";
import { Queue, Worker } from "bullmq";
import { afterEach, describe, expect, it } from "vitest";

function redisConnection() {
  const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  return {
    host: redisUrl.hostname,
    password: redisUrl.password || undefined,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username || undefined,
  };
}

const resources: Array<{ close(): Promise<unknown> }> = [];

describe("BullMQ stalled generation recovery", () => {
  afterEach(async () => {
    await Promise.allSettled(
      resources.splice(0).map((resource) => resource.close()),
    );
  });

  it("worker 崩溃后 stalled job 被另一 worker 重新消费", async () => {
    const queueName = `generation-stalled-${crypto.randomUUID()}`;
    const queue = new Queue<GenerationJobData>(queueName, {
      connection: redisConnection(),
    });
    resources.push(queue);
    let firstStarted!: () => void;
    const active = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const crashedWorker = new Worker<GenerationJobData>(
      queueName,
      async () => {
        firstStarted();
        return new Promise<never>(() => undefined);
      },
      {
        connection: redisConnection(),
        lockDuration: 100,
        maxStalledCount: 1,
        stalledInterval: 100,
      },
    );
    resources.push(crashedWorker);
    await queue.add(
      "generate",
      { taskId: "task-stalled", userId: "user-1" },
      { jobId: "task-stalled" },
    );
    await active;
    await crashedWorker.close(true);

    let secondConsumptionCount = 0;
    const recovered = new Promise<void>((resolve) => {
      const recoveryWorker = new Worker<GenerationJobData>(
        queueName,
        async () => {
          secondConsumptionCount += 1;
          resolve();
        },
        {
          connection: redisConnection(),
          lockDuration: 100,
          maxStalledCount: 1,
          stalledInterval: 100,
        },
      );
      resources.push(recoveryWorker);
    });

    await Promise.race([
      recovered,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("stalled job 未在 5 秒内恢复")),
          5_000,
        ),
      ),
    ]);

    expect(secondConsumptionCount).toBe(1);
    await queue.obliterate({ force: true });
  });

  it("两个 worker 实例不会同时消费同一个 job", async () => {
    const queueName = `generation-lock-${crypto.randomUUID()}`;
    const queue = new Queue<GenerationJobData>(queueName, {
      connection: redisConnection(),
    });
    resources.push(queue);
    let consumptionCount = 0;
    let completed!: () => void;
    const done = new Promise<void>((resolve) => {
      completed = resolve;
    });
    const processor = async () => {
      consumptionCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      completed();
    };
    const firstWorker = new Worker<GenerationJobData>(
      queueName,
      processor,
      { connection: redisConnection() },
    );
    const secondWorker = new Worker<GenerationJobData>(
      queueName,
      processor,
      { connection: redisConnection() },
    );
    resources.push(firstWorker, secondWorker);

    await queue.add("generate", {
      taskId: "task-locked",
      userId: "user-1",
    });
    await done;
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(consumptionCount).toBe(1);
    await queue.obliterate({ force: true });
  });
});
