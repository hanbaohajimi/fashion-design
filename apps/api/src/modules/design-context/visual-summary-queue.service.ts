import { visualSummaryJobId } from "@fashion/ai";
import { VISUAL_SUMMARY_QUEUE_NAME, type VisualSummaryJobData } from "@fashion/shared";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";

export interface VisualSummaryJobs {
  enqueue(data: VisualSummaryJobData): Promise<void>;
}

@Injectable()
export class BullVisualSummaryJobs implements VisualSummaryJobs, OnModuleDestroy {
  private queue: Queue<VisualSummaryJobData> | undefined;

  async enqueue(data: VisualSummaryJobData): Promise<void> {
    const redis = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
    this.queue ??= new Queue<VisualSummaryJobData>(VISUAL_SUMMARY_QUEUE_NAME, {
      connection: { host: redis.hostname, port: Number(redis.port || 6379),
        password: redis.password || undefined, username: redis.username || undefined },
    });
    const jobId = visualSummaryJobId(data);
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "failed") {
        try {
          // Atomic retry keeps the same job identity and avoids deleting a newly claimed job.
          await existing.retry("failed", { resetAttemptsMade: true, resetAttemptsStarted: true });
          return;
        } catch (error) {
          const current = await this.queue.getJob(jobId);
          if (current) {
            const currentState = await current.getState();
            if (currentState === "failed") throw error;
            if (currentState !== "completed" && currentState !== "unknown") return;
            if (currentState === "completed") await current.remove();
          }
        }
      } else if (state === "completed") {
        await existing.remove();
      } else if (state !== "unknown") return;
    }
    try {
      await this.queue.add("describe", data, {
        attempts: 3,
        backoff: { type: "exponential", delay: 2_000 },
        jobId,
        removeOnComplete: { age: 7 * 24 * 60 * 60 },
        removeOnFail: { age: 30 * 24 * 60 * 60 },
      });
    } catch (error) {
      if (await this.queue.getJob(jobId).catch(() => undefined)) return;
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> { await this.queue?.close(); }
}
