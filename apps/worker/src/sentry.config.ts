import * as Sentry from "@sentry/node";
import type { ErrorEvent } from "@sentry/node";

const SAFE_TAGS = new Set([
  "environment",
  "phase",
  "queue",
  "runtime",
]);

export function sanitizeWorkerSentryEvent(event: ErrorEvent): ErrorEvent {
  const safeTags = Object.fromEntries(
    Object.entries(event.tags ?? {}).filter(([key]) => SAFE_TAGS.has(key)),
  );
  const exception = event.exception?.values?.map((value) => ({
    ...value,
    value: "Worker application error",
  }));
  const sanitized: ErrorEvent = {
    ...event,
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
  delete sanitized.contexts;
  delete sanitized.extra;
  delete sanitized.request;
  delete sanitized.user;
  delete sanitized.message;
  return sanitized;
}

export function initializeWorkerSentry(): void {
  const dsn = process.env.SENTRY_DSN?.trim();
  Sentry.init({
    attachStacktrace: true,
    beforeSend: sanitizeWorkerSentryEvent,
    dsn,
    enabled: Boolean(dsn),
    environment:
      process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    includeLocalVariables: false,
    maxBreadcrumbs: 0,
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
  Sentry.setTag("runtime", "worker");
}

export function captureWorkerException(
  error: unknown,
  context: {
    readonly phase: "bootstrap" | "failed" | "fallback";
    readonly queue:
      | "collection-similarity"
      | "export"
      | "generation"
      | "thumbnail"
      | "trend-digest"
      | "vlm-inference"
      | "visual-summary"
      | "worker";
  },
): void {
  Sentry.withScope((scope) => {
    scope.setTag("phase", context.phase);
    scope.setTag("queue", context.queue);
    scope.setTag("runtime", "worker");
    Sentry.captureException(error);
  });
}

export async function flushWorkerSentry(): Promise<void> {
  await Sentry.flush(2_000);
}
