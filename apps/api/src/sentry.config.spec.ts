import { describe, expect, it } from "vitest";

import { sanitizeApiSentryEvent } from "./sentry.config";

describe("API Sentry privacy filter", () => {
  it("删除请求、用户与敏感正文，只保留堆栈和匿名慢请求上下文", () => {
    const result = sanitizeApiSentryEvent({
      type: undefined,
      breadcrumbs: [{ message: "prompt secret" }],
      contexts: {
        slow_api: { duration_ms: 3_501, threshold_ms: 3_000 },
        user_content: { prompt: "secret" },
      },
      exception: {
        values: [
          {
            stacktrace: { frames: [{ filename: "service.ts", lineno: 42 }] },
            type: "Error",
            value: "email@example.com prompt secret",
          },
        ],
      },
      extra: { prompt: "secret" },
      request: {
        cookies: { session: "secret" },
        data: { prompt: "secret" },
        headers: { authorization: "Bearer secret" },
      },
      tags: {
        method: "POST",
        operation: "GenerationController.create",
        prompt: "secret",
      },
      user: { email: "email@example.com", id: "user-a" },
    });

    expect(result.request).toBeUndefined();
    expect(result.user).toBeUndefined();
    expect(result.extra).toBeUndefined();
    expect(result.breadcrumbs).toBeUndefined();
    expect(result.contexts).toEqual({
      slow_api: { duration_ms: 3_501, threshold_ms: 3_000 },
    });
    expect(result.tags).toEqual({
      method: "POST",
      operation: "GenerationController.create",
    });
    expect(result.exception?.values?.[0]?.value).toBe(
      "API application error",
    );
    expect(result.exception?.values?.[0]?.stacktrace).toBeDefined();
  });
});
