import { THUMBNAIL_QUEUE_NAME, type ThumbnailJobData } from "@fashion/shared";
import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";

export interface ThumbnailJobs {
  enqueue(fileId: string): Promise<void>;
}

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
export class BullThumbnailJobs implements ThumbnailJobs, OnModuleDestroy {
  private queue: Queue<ThumbnailJobData> | undefined;

  async enqueue(fileId: string): Promise<void> {
    const queue = this.getQueue();
    const existing = await queue.getJob(fileId);
    if (existing) {
      const state = await existing.getState();
      if (state === "failed") {
        try {
          await existing.retry("failed", {
            resetAttemptsMade: true,
            resetAttemptsStarted: true,
          });
          return;
        } catch (error) {
          const current = await queue.getJob(fileId);
          if (current) {
            const currentState = await current.getState();
            if (currentState === "failed") {
              throw error;
            }
            if (currentState !== "completed" && currentState !== "unknown") {
              return;
            }
            if (currentState === "completed") {
              await current.remove();
            }
          }
        }
      } else if (state === "completed") {
        await existing.remove();
      } else if (state !== "unknown") {
        return;
      }
    }

    try {
      await this.addJob(queue, fileId);
    } catch (error) {
      const reconciled = await queue.getJob(fileId).catch(() => undefined);
      if (reconciled) {
        return;
      }
      throw error;
    }
  }

  private async addJob(
    queue: Queue<ThumbnailJobData>,
    fileId: string,
  ): Promise<void> {
    await queue.add(
      "generate",
      { fileId },
      {
        attempts: 5,
        backoff: { delay: 1_000, type: "exponential" },
        jobId: fileId,
        removeOnComplete: { age: 7 * 24 * 60 * 60 },
        removeOnFail: { age: 30 * 24 * 60 * 60 },
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  private getQueue(): Queue<ThumbnailJobData> {
    this.queue ??= new Queue<ThumbnailJobData>(THUMBNAIL_QUEUE_NAME, {
      connection: redisConnection(),
    }).on("error", () => Logger.warn("缩略图队列连接异常，已确认上传将自动重试派发", "ThumbnailQueue"));
    return this.queue;
  }
}
