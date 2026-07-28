import type { ErrorEvent } from "@sentry/nextjs";

const SAFE_TAGS = new Set([
  "area",
  "environment",
  "method",
  "operation",
  "runtime",
  "status_code",
]);

export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  const safeTags = Object.fromEntries(
    Object.entries(event.tags ?? {}).filter(([key]) => SAFE_TAGS.has(key)),
  );
  const exception = event.exception?.values?.map((value) => ({
    ...value,
    value: "应用异常",
  }));
  const slowApi = event.contexts?.slow_api;

  const sanitized: ErrorEvent = {
    ...event,
    ...(slowApi ? { contexts: { slow_api: slowApi } } : {}),
    tags: safeTags,
    ...(exception
      ? {
          exception: {
            ...event.exception,
            values: exception,
          },
        }
      : {}),
  };
  delete sanitized.breadcrumbs;
  delete sanitized.extra;
  delete sanitized.request;
  delete sanitized.user;
  if (!slowApi) delete sanitized.contexts;
  if (sanitized.message !== "Slow API request") delete sanitized.message;
  return sanitized;
}

export function webSentryOptions(runtime: "browser" | "edge" | "server") {
  const dsn =
    runtime === "browser"
      ? process.env.NEXT_PUBLIC_SENTRY_DSN
      : process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  return {
    attachStacktrace: true,
    beforeSend: sanitizeSentryEvent,
    dsn,
    enabled: Boolean(dsn),
    environment:
      process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    maxBreadcrumbs: 0,
    replaysOnErrorSampleRate: 0,
    replaysSessionSampleRate: 0,
    sendDefaultPii: false,
    tags: { runtime },
    tracesSampleRate: 0,
  };
}
