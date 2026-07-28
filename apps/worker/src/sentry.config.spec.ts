import { describe, expect, it } from "vitest";

import { sanitizeWorkerSentryEvent } from "./sentry.config";

describe("Worker Sentry privacy filter", () => {
  it("不上传队列数据、用户内容或异常正文", () => {
    const result = sanitizeWorkerSentryEvent({
      type: undefined,
      contexts: { job: { prompt: "secret" } },
      exception: {
        values: [
          {
            stacktrace: { frames: [{ filename: "processor.ts", lineno: 18 }] },
            type: "Error",
            value: "generated prompt secret",
          },
        ],
      },
      extra: { jobData: { prompt: "secret" } },
      tags: {
        phase: "failed",
        prompt: "secret",
        queue: "generation",
      },
      user: { id: "user-a" },
    });

    expect(result.contexts).toBeUndefined();
    expect(result.extra).toBeUndefined();
    expect(result.user).toBeUndefined();
    expect(result.tags).toEqual({
      phase: "failed",
      queue: "generation",
    });
    expect(result.exception?.values?.[0]?.value).toBe(
      "Worker application error",
    );
    expect(result.exception?.values?.[0]?.stacktrace).toBeDefined();
  });
});
