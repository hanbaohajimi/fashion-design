import type { JobsOptions } from "bullmq";

export const TREND_DIGEST_QUEUE_NAME = "trend-digest";
export const TREND_DIGEST_CRON = "0 2 * * MON";
export const TREND_DIGEST_SCHEDULER_ID = "weekly-trend-digest";

export interface TrendDigestJobData {
  readonly trigger: "manual" | "scheduled";
}

interface TrendSchedulerQueue {
  upsertJobScheduler(
    schedulerId: string,
    repeat: { pattern: string; tz: string },
    template: {
      data: TrendDigestJobData;
      name: string;
      opts: JobsOptions;
    },
  ): Promise<unknown>;
}

export async function registerTrendSchedule(
  queue: TrendSchedulerQueue,
  timeZone = process.env.TREND_DIGEST_TIMEZONE?.trim() || "Asia/Shanghai",
): Promise<void> {
  await queue.upsertJobScheduler(
    TREND_DIGEST_SCHEDULER_ID,
    {
      pattern: TREND_DIGEST_CRON,
      tz: timeZone,
    },
    {
      data: { trigger: "scheduled" },
      name: "weekly-digest",
      opts: {
        attempts: 3,
        backoff: { delay: 5_000, type: "exponential" },
        removeOnComplete: { age: 30 * 24 * 60 * 60 },
        removeOnFail: { age: 90 * 24 * 60 * 60 },
      },
    },
  );
}
