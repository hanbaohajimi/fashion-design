import { describe, expect, it, vi } from "vitest";

import {
  TREND_DIGEST_CRON,
  TREND_DIGEST_QUEUE_NAME,
  registerTrendSchedule,
} from "./trend.queue";

describe("trend digest queue", () => {
  it("以周一凌晨 2 点注册唯一调度器，并配置三次指数退避", async () => {
    const queue = {
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    };

    await registerTrendSchedule(queue, "Asia/Shanghai");

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      "weekly-trend-digest",
      {
        pattern: TREND_DIGEST_CRON,
        tz: "Asia/Shanghai",
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
    expect(TREND_DIGEST_QUEUE_NAME).toBe("trend-digest");
    expect(TREND_DIGEST_CRON).toBe("0 2 * * MON");
  });
});
