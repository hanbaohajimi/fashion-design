import { THUMBNAIL_QUEUE_NAME, type ThumbnailJobData } from "@fashion/shared";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";

export interface ThumbnailJobs {
  enqueue(fileId: string): Promise<void>;
}

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
export class BullThumbnailJobs implements ThumbnailJobs, OnModuleDestroy {
  private queue: Queue<ThumbnailJobData> | undefined;

  async enqueue(fileId: string): Promise<void> {
    await this.getQueue().add(
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
    });
    return this.queue;
  }
}
