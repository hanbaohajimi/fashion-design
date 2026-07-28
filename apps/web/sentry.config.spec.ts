import { describe, expect, it } from "vitest";

import { sanitizeSentryEvent } from "./sentry.config";

describe("browser Sentry privacy filter", () => {
  it("删除用户内容与标识，仅保留匿名标签和异常堆栈", () => {
    const result = sanitizeSentryEvent({
      type: undefined,
      breadcrumbs: [{ message: "private prompt" }],
      contexts: {
        design: { prompt: "private prompt" },
        slow_api: { duration_ms: 3_501, threshold_ms: 3_000 },
      },
      exception: {
        values: [
          {
            stacktrace: {
              frames: [{ filename: "CandidateGrid.tsx", lineno: 42 }],
            },
            type: "Error",
            value: "person@example.com private prompt",
          },
        ],
      },
      extra: { prompt: "private prompt" },
      request: { data: { prompt: "private prompt" } },
      tags: {
        area: "generation",
        email: "person@example.com",
        runtime: "browser",
      },
      user: { email: "person@example.com", id: "user-a" },
    });

    expect(result.breadcrumbs).toBeUndefined();
    expect(result.contexts).toEqual({
      slow_api: { duration_ms: 3_501, threshold_ms: 3_000 },
    });
    expect(result.extra).toBeUndefined();
    expect(result.request).toBeUndefined();
    expect(result.user).toBeUndefined();
    expect(result.tags).toEqual({
      area: "generation",
      runtime: "browser",
    });
    expect(result.exception?.values?.[0]?.value).toBe("应用异常");
    expect(result.exception?.values?.[0]?.stacktrace).toBeDefined();
  });
});
