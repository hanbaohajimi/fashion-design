// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GuidePreferences,
  guideStorageKey,
  guideSurfaceForPath,
  type GuideStatus,
} from "./guide-model";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("功能指引页面识别", () => {
  it.each([
    ["/", "projects"],
    ["/fabrics", "fabrics"],
    ["/trends", "trends"],
    ["/project-a", "workspace"],
    ["/project-a/", "workspace"],
    ["/project-a/studio", "studio"],
    ["/project-b/studio/", "studio"],
  ] as const)("将 %s 解析为 %s，共用项目内的页面导览", (path, surface) => {
    expect(guideSurfaceForPath(path)).toBe(surface);
  });

  it.each([
    "/login",
    "/login/studio",
    "/auth",
    "/auth/confirm",
    "/share",
    "/share/public-token",
    "/prototypes",
    "/prototypes/desktop-agent-ui",
    "/project-a/studio/export",
    "/tldraw-translations/zh-cn",
    "/api/projects/project-a",
    "",
  ])("不在未支持的路由 %s 启动导览", (path) => {
    expect(guideSurfaceForPath(path)).toBeNull();
  });
});

describe("功能指引的账号与页面偏好", () => {
  it("隔离账号与页面，同一项目功能不会替其他页面完成导览", () => {
    const preferences = new GuidePreferences();
    preferences.write("alice", "studio", "completed");

    expect(preferences.read("alice", "studio")).toBe("completed");
    expect(preferences.read("alice", "workspace")).toBeNull();
    expect(preferences.read("bob", "studio")).toBeNull();

    preferences.write("bob", "studio", "skipped");
    expect(preferences.read("alice", "studio")).toBe("completed");
    expect(preferences.read("bob", "studio")).toBe("skipped");
  });

  it.each<GuideStatus>(["viewed", "skipped", "completed"])(
    "在新的偏好实例中恢复 %s 状态",
    (status) => {
      new GuidePreferences().write("alice", "projects", status);
      expect(new GuidePreferences().read("alice", "projects")).toBe(status);
    },
  );

  it("忽略损坏的存储值，不把未知值当作已完成", () => {
    localStorage.setItem(guideStorageKey("alice", "fabrics"), "invalid");
    expect(new GuidePreferences().read("alice", "fabrics")).toBeNull();
  });

  it("浏览器禁止读写存储时保留当前会话选择，并保持账号隔离", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    const preferences = new GuidePreferences();

    expect(preferences.read("alice", "trends")).toBeNull();
    expect(() => preferences.write("alice", "trends", "skipped")).not.toThrow();
    expect(preferences.read("alice", "trends")).toBe("skipped");
    expect(preferences.read("bob", "trends")).toBeNull();
    expect(preferences.read("alice", "projects")).toBeNull();
  });

  it("写入失败后使用本次选择，不回退到存储中的旧状态", () => {
    const preferences = new GuidePreferences();
    preferences.write("alice", "studio", "viewed");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });

    preferences.write("alice", "studio", "completed");

    expect(preferences.read("alice", "studio")).toBe("completed");
  });
});
