import { beforeEach, describe, expect, it, vi } from "vitest";

const posthogMock = vi.hoisted(() => {
  let optedOut = true;
  return {
    capture: vi.fn(),
    hasOptedOut: vi.fn(() => optedOut),
    identify: vi.fn(),
    init: vi.fn(),
    optIn: vi.fn(() => {
      optedOut = false;
    }),
    optOut: vi.fn(() => {
      optedOut = true;
    }),
    resetUser: vi.fn(),
    reset: () => {
      optedOut = true;
    },
  };
});

vi.mock("posthog-js", () => ({
  default: {
    capture: posthogMock.capture,
    has_opted_out_capturing: posthogMock.hasOptedOut,
    identify: posthogMock.identify,
    init: posthogMock.init,
    opt_in_capturing: posthogMock.optIn,
    opt_out_capturing: posthogMock.optOut,
    reset: posthogMock.resetUser,
  },
}));

import {
  captureAnalytics,
  CORE_HYPOTHESIS_FUNNEL,
  initializeAnalytics,
  sanitizeAnalyticsProperties,
  setAnalyticsConsent,
} from "./analytics";

describe("analytics privacy wrapper", () => {
  beforeEach(() => {
    posthogMock.reset();
    vi.clearAllMocks();
  });

  it("事件属性只保留漏斗所需的匿名白名单字段", () => {
    expect(CORE_HYPOTHESIS_FUNNEL).toEqual([
      "board_element_added",
      "generation_submitted",
      "generation_adopted",
      "collection_created",
      "collection_look_generated",
      "export_completed",
    ]);
    const result = sanitizeAnalyticsProperties(
      "generation_submitted",
      {
        email: "person@example.com",
        has_reference: true,
        prompt: "private prompt",
        selected_element_count: 2,
        task_type: "i2i",
      } as never,
    );

    expect(result).toEqual({
      has_reference: true,
      selected_element_count: 2,
      task_type: "i2i",
    });
    expect(JSON.stringify(result)).not.toContain("private prompt");
    expect(JSON.stringify(result)).not.toContain("person@example.com");
  });

  it("用户拒绝追踪后不初始化自动采集，也不发送手动事件", () => {
    const storage = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    };
    vi.stubGlobal("window", {
      localStorage,
      navigator: { doNotTrack: "0", globalPrivacyControl: false },
    });
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";

    initializeAnalytics();
    setAnalyticsConsent(false);
    captureAnalytics("collection_created", {});

    expect(posthogMock.init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        autocapture: false,
        disable_session_recording: true,
        opt_out_capturing_by_default: true,
      }),
    );
    expect(posthogMock.optOut).toHaveBeenCalled();
    expect(posthogMock.capture).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
