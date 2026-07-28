import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { lastValueFrom, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

const sentryMock = vi.hoisted(() => ({
  captureMessage: vi.fn(() => "event-id"),
  setContext: vi.fn(),
  setTag: vi.fn(),
}));

vi.mock("@sentry/nestjs", () => ({
  captureMessage: sentryMock.captureMessage,
  withScope: (
    callback: (scope: {
      setContext: typeof sentryMock.setContext;
      setTag: typeof sentryMock.setTag;
    }) => unknown,
  ) =>
    callback({
      setContext: sentryMock.setContext,
      setTag: sentryMock.setTag,
    }),
}));

import {
  SLOW_API_THRESHOLD_MS,
  SlowApiInterceptor,
} from "./slow-api.interceptor";

describe("SlowApiInterceptor", () => {
  it("超过 3 秒时只上报匿名路由上下文", async () => {
    const now = vi
      .spyOn(performance, "now")
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(10 + SLOW_API_THRESHOLD_MS + 1);
    const context = {
      getClass: () => class GenerationController {},
      getHandler: () => function create() {},
      switchToHttp: () => ({
        getRequest: () => ({
          body: { prompt: "secret prompt" },
          method: "POST",
        }),
        getResponse: () => ({ statusCode: 202 }),
      }),
    } as unknown as ExecutionContext;
    const next = { handle: () => of({ ok: true }) } as CallHandler;

    await lastValueFrom(new SlowApiInterceptor().intercept(context, next));

    expect(sentryMock.captureMessage).toHaveBeenCalledWith(
      "Slow API request",
      "warning",
    );
    expect(sentryMock.setTag).toHaveBeenCalledWith(
      "operation",
      "GenerationController.create",
    );
    expect(sentryMock.setContext).toHaveBeenCalledWith("slow_api", {
      duration_ms: SLOW_API_THRESHOLD_MS + 1,
      threshold_ms: SLOW_API_THRESHOLD_MS,
    });
    expect(
      JSON.stringify({
        contexts: sentryMock.setContext.mock.calls,
        tags: sentryMock.setTag.mock.calls,
      }),
    ).not.toContain("secret prompt");

    now.mockRestore();
  });
});
