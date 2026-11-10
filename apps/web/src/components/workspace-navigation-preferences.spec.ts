// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { navigationPreferenceKey, readNavigationPreference, saveNavigationPreference } from "./workspace-navigation-preferences";

describe("目录偏好", () => {
  it("按账号、页面类型分别记住，首次画布收起、资料展开", () => {
    expect(readNavigationPreference("first", "creation")).toBe(false);
    expect(readNavigationPreference("first", "document")).toBe(true);
    saveNavigationPreference("alice", "creation", true);
    saveNavigationPreference("alice", "document", false);
    expect(readNavigationPreference("alice", "creation")).toBe(true);
    expect(readNavigationPreference("alice", "document")).toBe(false);
    expect(readNavigationPreference("bob", "creation")).toBe(false);
    expect(readNavigationPreference("bob", "document")).toBe(true);
  });
  it("损坏的偏好使用默认值；存储被禁用时本次选择仍然有效", () => {
    localStorage.setItem(navigationPreferenceKey("corrupt", "document"), "{broken");
    expect(readNavigationPreference("corrupt", "document")).toBe(true);
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    saveNavigationPreference("private", "creation", true);
    expect(readNavigationPreference("private", "creation")).toBe(true);
    get.mockRestore(); set.mockRestore();
  });
  it("写入失败时本次选择优先于旧值，跨标签页删除后恢复默认", () => {
    saveNavigationPreference("quota", "creation", false);
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    saveNavigationPreference("quota", "creation", true);
    expect(readNavigationPreference("quota", "creation")).toBe(true);
    set.mockRestore();
    saveNavigationPreference("quota", "creation", true);
    localStorage.removeItem(navigationPreferenceKey("quota", "creation"));
    expect(readNavigationPreference("quota", "creation")).toBe(false);
  });
});
