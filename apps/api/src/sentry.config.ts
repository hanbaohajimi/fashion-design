import * as Sentry from "@sentry/nestjs";
import type { ErrorEvent } from "@sentry/nestjs";

const SAFE_TAGS = new Set([
  "environment",
  "method",
  "operation",
  "runtime",
  "status_code",
]);

export function sanitizeApiSentryEvent(event: ErrorEvent): ErrorEvent {
  const safeTags = Object.fromEntries(
    Object.entries(event.tags ?? {}).filter(([key]) => SAFE_TAGS.has(key)),
  );
  const slowApi = event.contexts?.slow_api;
  const exception = event.exception?.values?.map((value) => ({
    ...value,
    value: "API application error",
  }));

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

export function initializeApiSentry(): void {
  const dsn = process.env.SENTRY_DSN?.trim();
  Sentry.init({
    attachStacktrace: true,
    beforeSend: sanitizeApiSentryEvent,
    dsn,
    enabled: Boolean(dsn),
    environment:
      process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    includeLocalVariables: false,
    maxBreadcrumbs: 0,
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
  Sentry.setTag("runtime", "api");
}
