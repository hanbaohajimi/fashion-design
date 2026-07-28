"use client";

import * as Sentry from "@sentry/nextjs";

export const CLIENT_SLOW_API_THRESHOLD_MS = 3_000;

let installed = false;

export function installSlowApiMonitoring(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const shouldMonitor = isApplicationApiRequest(input);
    const startedAt = shouldMonitor ? performance.now() : 0;
    let statusCode = 0;
    try {
      const response = await originalFetch(input, init);
      statusCode = response.status;
      return response;
    } finally {
      if (shouldMonitor) {
        const durationMs = Math.round(performance.now() - startedAt);
        if (durationMs > CLIENT_SLOW_API_THRESHOLD_MS) {
          Sentry.withScope((scope) => {
            scope.setTag("method", requestMethod(input, init));
            scope.setTag("operation", "browser.fetch");
            scope.setTag("runtime", "browser");
            scope.setTag("status_code", String(statusCode || 0));
            scope.setContext("slow_api", {
              duration_ms: durationMs,
              threshold_ms: CLIENT_SLOW_API_THRESHOLD_MS,
            });
            Sentry.captureMessage("Slow API request", "warning");
          });
        }
      }
    }
  };
}

function isApplicationApiRequest(input: RequestInfo | URL): boolean {
  try {
    const raw = input instanceof Request ? input.url : input.toString();
    const url = new URL(raw, window.location.origin);
    return (
      url.origin === window.location.origin &&
      url.pathname.startsWith("/api/")
    );
  } catch {
    return false;
  }
}

function requestMethod(
  input: RequestInfo | URL,
  init?: RequestInit,
): string {
  const method =
    init?.method ?? (input instanceof Request ? input.method : "GET");
  return method.toUpperCase();
}
