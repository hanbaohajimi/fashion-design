import * as Sentry from "@sentry/nextjs";

import { webSentryOptions } from "./sentry.config";

Sentry.init(webSentryOptions("server"));
