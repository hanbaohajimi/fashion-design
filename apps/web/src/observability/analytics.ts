"use client";

import posthog from "posthog-js";

export const ANALYTICS_CONSENT_KEY = "fashion-analytics-consent";

export interface AnalyticsEventMap {
  readonly board_element_added: {
    readonly element_type: string;
  };
  readonly generation_submitted: {
    readonly has_reference: boolean;
    readonly selected_element_count: number;
    readonly task_type: "i2i" | "inpaint" | "t2i";
  };
  readonly generation_adopted: {
    readonly task_type: "i2i" | "inpaint" | "t2i";
  };
  readonly collection_created: Record<string, never>;
  readonly collection_look_generated: {
    readonly variation_axis:
      | "color"
      | "detail"
      | "fabric"
      | "silhouette"
      | "styling";
  };
  readonly export_completed: {
    readonly format: "jpg" | "pdf" | "png";
    readonly quality: "high" | "standard";
    readonly source_type: "asset" | "collection";
  };
}

export type AnalyticsEventName = keyof AnalyticsEventMap;

export const CORE_HYPOTHESIS_FUNNEL = [
  "board_element_added",
  "generation_submitted",
  "generation_adopted",
  "collection_created",
  "collection_look_generated",
  "export_completed",
] as const satisfies readonly AnalyticsEventName[];

const SAFE_PROPERTIES: {
  readonly [EventName in AnalyticsEventName]: ReadonlySet<
    keyof AnalyticsEventMap[EventName]
  >;
} = {
  board_element_added: new Set(["element_type"]),
  collection_created: new Set(),
  collection_look_generated: new Set(["variation_axis"]),
  export_completed: new Set(["format", "quality", "source_type"]),
  generation_adopted: new Set(["task_type"]),
  generation_submitted: new Set([
    "has_reference",
    "selected_element_count",
    "task_type",
  ]),
};

let initialized = false;

export function initializeAnalytics(): void {
  if (initialized || typeof window === "undefined") return;
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
  if (!token) return;

  posthog.init(token, {
    api_host:
      process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() ||
      "https://us.i.posthog.com",
    autocapture: false,
    capture_pageleave: false,
    capture_pageview: false,
    defaults: "2026-05-30",
    disable_session_recording: true,
    opt_out_capturing_by_default: true,
    opt_out_capturing_persistence_type: "localStorage",
    persistence: "localStorage",
    person_profiles: "identified_only",
  });
  initialized = true;

  if (trackingForbidden()) {
    posthog.opt_out_capturing();
  } else {
    posthog.opt_in_capturing();
  }
}

export function captureAnalytics<EventName extends AnalyticsEventName>(
  event: EventName,
  properties: AnalyticsEventMap[EventName],
): void {
  if (
    !initialized ||
    trackingForbidden() ||
    posthog.has_opted_out_capturing()
  ) {
    return;
  }
  posthog.capture(event, sanitizeAnalyticsProperties(event, properties));
}

export function identifyAnalyticsUser(userId: string): void {
  if (
    !initialized ||
    !userId ||
    trackingForbidden() ||
    posthog.has_opted_out_capturing()
  ) {
    return;
  }
  posthog.identify(userId);
}

export function resetAnalyticsUser(): void {
  if (!initialized) return;
  posthog.reset();
}

export function setAnalyticsConsent(enabled: boolean): void {
  if (typeof window === "undefined") return;
  if (!writeConsent(enabled ? "granted" : "denied")) {
    if (initialized) posthog.opt_out_capturing();
    return;
  }
  if (!initialized) return;
  if (enabled && !privacySignalEnabled()) {
    posthog.opt_in_capturing();
  } else {
    posthog.opt_out_capturing();
  }
}

export function sanitizeAnalyticsProperties<
  EventName extends AnalyticsEventName,
>(
  event: EventName,
  properties: AnalyticsEventMap[EventName],
): Record<string, boolean | number | string> {
  const allowlist = SAFE_PROPERTIES[event] as ReadonlySet<string>;
  return Object.fromEntries(
    Object.entries(properties).filter(
      ([key, value]) =>
        allowlist.has(key) &&
        (typeof value === "boolean" ||
          typeof value === "number" ||
          typeof value === "string"),
    ),
  );
}

function trackingForbidden(): boolean {
  if (typeof window === "undefined") return true;
  return (
    readConsent() === "denied" ||
    privacySignalEnabled()
  );
}

function readConsent(): "denied" | "granted" | null {
  try {
    const value = window.localStorage.getItem(ANALYTICS_CONSENT_KEY);
    return value === "denied" || value === "granted" ? value : null;
  } catch {
    return "denied";
  }
}

function writeConsent(value: "denied" | "granted"): boolean {
  try {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, value);
    return true;
  } catch {
    return false;
  }
}

function privacySignalEnabled(): boolean {
  const navigatorWithPrivacy = window.navigator as Navigator & {
    readonly globalPrivacyControl?: boolean;
  };
  return (
    navigatorWithPrivacy.globalPrivacyControl === true ||
    navigatorWithPrivacy.doNotTrack === "1"
  );
}
