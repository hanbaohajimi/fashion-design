import {
  GENERATION_QUEUE_NAME,
  type GenerationJobData,
  type GenerationTaskEvent,
} from "@fashion/shared";
import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { Queue, type Job } from "bullmq";

import type { GenerationJobs } from "./generation.service";

function redisConnection() {
  const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  return {
    commandTimeout: 5_000,
    maxRetriesPerRequest: 1,
    host: redisUrl.hostname,
    password: redisUrl.password || undefined,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username || undefined,
  };
}

@Injectable()
export class BullGenerationJobs implements GenerationJobs, OnModuleDestroy {
  private queue: Queue<GenerationJobData> | undefined;

  async state(taskId: string): Promise<string> {
    const job = await this.getQueue().getJob(taskId);
    return job ? job.getState() : "missing";
  }

  async enqueue(taskId: string, userId: string): Promise<void> {
    const queue = this.getQueue();
    let job = await queue.getJob(taskId);
    if (job) {
      const state = await job.getState();
      if (state === "failed") {
        await this.retryFinishedJob(job, "failed");
      } else if (state === "completed") {
        await this.retryFinishedJob(job, "completed");
      }
    }

    job ??= await queue.add(
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
    }).on("error", () => Logger.warn("生成队列连接异常，持久化任务将重试派发", "GenerationQueue"));
    return this.queue;
  }

  private async retryFinishedJob(
    job: Job<GenerationJobData>,
    state: "completed" | "failed",
  ): Promise<void> {
    try {
      await job.retry(state, {
        resetAttemptsMade: true,
        resetAttemptsStarted: true,
      });
    } catch (error) {
      if ((await job.getState()) === state) {
        throw error;
      }
    }
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
