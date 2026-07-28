import { describe, expect, it, vi } from "vitest";

const sentryMock = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  setContext: vi.fn(),
  setTag: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
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
  CLIENT_SLOW_API_THRESHOLD_MS,
  installSlowApiMonitoring,
} from "./slow-api-monitor";

describe("browser slow API monitor", () => {
  it("超过 3 秒只上报匿名 API 元数据，忽略外部资源请求", async () => {
    const originalFetch = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("window", {
      fetch: originalFetch,
      location: { origin: "http://localhost:3000" },
    });
    const now = vi
      .spyOn(performance, "now")
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(10 + CLIENT_SLOW_API_THRESHOLD_MS + 1);

    installSlowApiMonitoring();
    await window.fetch("/api/generations/private-id", {
      body: JSON.stringify({ prompt: "private prompt" }),
      method: "POST",
    });

    expect(sentryMock.captureMessage).toHaveBeenCalledWith(
      "Slow API request",
      "warning",
    );
    expect(sentryMock.setTag).toHaveBeenCalledWith(
      "operation",
      "browser.fetch",
    );
    expect(sentryMock.setContext).toHaveBeenCalledWith("slow_api", {
      duration_ms: CLIENT_SLOW_API_THRESHOLD_MS + 1,
      threshold_ms: CLIENT_SLOW_API_THRESHOLD_MS,
    });
    const reportedContext = JSON.stringify({
      contexts: sentryMock.setContext.mock.calls,
      tags: sentryMock.setTag.mock.calls,
    });
    expect(reportedContext).not.toContain("private prompt");
    expect(reportedContext).not.toContain("private-id");

    sentryMock.captureMessage.mockClear();
    await window.fetch("https://assets.example.com/private-image.png");
    expect(sentryMock.captureMessage).not.toHaveBeenCalled();

    now.mockRestore();
    vi.unstubAllGlobals();
  });
});
