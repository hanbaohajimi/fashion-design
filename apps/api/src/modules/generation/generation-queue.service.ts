import {
  GENERATION_QUEUE_NAME,
  type GenerationJobData,
  type GenerationTaskEvent,
} from "@fashion/shared";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";

import type { GenerationJobs } from "./generation.service";

function redisConnection() {
  const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  return {
    host: redisUrl.hostname,
    password: redisUrl.password || undefined,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username || undefined,
  };
}

@Injectable()
export class BullGenerationJobs
  implements GenerationJobs, OnModuleDestroy
{
  private queue: Queue<GenerationJobData> | undefined;

  async enqueue(taskId: string, userId: string): Promise<void> {
    const job = await this.getQueue().add(
      "generate",
      { taskId, userId },
      {
        attempts: 2,
        backoff: { delay: 1_000, type: "exponential" },
        jobId: taskId,
        removeOnComplete: { age: 7 * 24 * 60 * 60 },
        removeOnFail: { age: 30 * 24 * 60 * 60 },
      },
    );
    await job
      .updateProgress(this.event(taskId, "queued"))
      .catch(() => undefined);
  }

  async cancel(taskId: string): Promise<void> {
    const job = await this.getQueue().getJob(taskId);
    if (!job) {
      return;
    }

    await job
      .updateProgress(this.event(taskId, "canceled"))
      .catch(() => undefined);
    const state = await job.getState();
    if (state !== "active") {
      await job.remove();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  private getQueue(): Queue<GenerationJobData> {
    this.queue ??= new Queue<GenerationJobData>(GENERATION_QUEUE_NAME, {
      connection: redisConnection(),
    });
    return this.queue;
  }

  private event(
    taskId: string,
    status: GenerationTaskEvent["status"],
  ): GenerationTaskEvent {
    return {
      taskId,
      status,
      timestamp: new Date().toISOString(),
    };
  }
}
