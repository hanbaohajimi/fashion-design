import { EXPORT_QUEUE_NAME, type ExportJobData } from "@fashion/shared";
import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";

export interface ExportJobs {
  enqueue(exportId: string): Promise<void>;
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
export class BullExportJobs implements ExportJobs, OnModuleDestroy {
  private queue: Queue<ExportJobData> | undefined;

  async enqueue(exportId: string): Promise<void> {
    const job = await this.getQueue().getJob(`render-${exportId}`);
    if (job) {
      const state = await job.getState();
      if (state === "failed" || state === "completed") await job.retry(state);
      return;
    }
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

  async state(exportId: string): Promise<string> {
    const job = await this.getQueue().getJob(`render-${exportId}`);
    return job ? job.getState() : "missing";
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  private getQueue(): Queue<ExportJobData> {
    this.queue ??= new Queue<ExportJobData>(EXPORT_QUEUE_NAME, {
      connection: redisConnection(),
    }).on("error", () => Logger.warn("导出队列连接异常，持久化任务将重试派发", "ExportQueue"));
    return this.queue;
  }
}
