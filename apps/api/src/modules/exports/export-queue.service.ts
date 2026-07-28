import { EXPORT_QUEUE_NAME, type ExportJobData } from "@fashion/shared";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";

export interface ExportJobs {
  enqueue(exportId: string): Promise<void>;
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
export class BullExportJobs implements ExportJobs, OnModuleDestroy {
  private queue: Queue<ExportJobData> | undefined;

  async enqueue(exportId: string): Promise<void> {
    await this.getQueue().add(
      "render",
      { action: "render", exportId },
      {
        attempts: 2,
        backoff: { delay: 2_000, type: "exponential" },
        jobId: `render-${exportId}`,
        removeOnComplete: { age: 7 * 24 * 60 * 60 },
        removeOnFail: { age: 30 * 24 * 60 * 60 },
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  private getQueue(): Queue<ExportJobData> {
    this.queue ??= new Queue<ExportJobData>(EXPORT_QUEUE_NAME, {
      connection: redisConnection(),
    });
    return this.queue;
  }
}
