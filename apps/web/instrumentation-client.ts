import * as Sentry from "@sentry/nextjs";

import { initializeAnalytics } from "./src/observability/analytics";
import { installSlowApiMonitoring } from "./src/observability/slow-api-monitor";
import { webSentryOptions } from "./sentry.config";

Sentry.init(webSentryOptions("browser"));
installSlowApiMonitoring();
initializeAnalytics();

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
