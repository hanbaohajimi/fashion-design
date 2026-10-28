// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../components/drafts/draft-repository", () => ({ flushWorkspaceDrafts: async () => undefined }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function nativeTraversal() {
  return Object.assign(new Event("navigate", { cancelable: true }), {
    navigationType: "traverse",
    canIntercept: true,
    destination: { key: "previous-page", sameDocument: true },
  });
}

async function installNativeNavigation(save = vi.fn(async () => undefined)) {
  vi.useFakeTimers();
  const navigation = Object.assign(new EventTarget(), {
    currentEntry: { key: "editor-page" },
    traverseTo: vi.fn((key: string) => {
      expect(key).toBe("previous-page");
      const replay = nativeTraversal();
      navigation.dispatchEvent(replay);
      expect(replay.defaultPrevented).toBe(false);
      return { committed: Promise.resolve(), finished: Promise.resolve() };
    }),
  });
  vi.stubGlobal("navigation", navigation);
  const navigationModule = await import("./navigation");
  const unsave = navigationModule.registerNavigationGuard(save);
  const untraverse = navigationModule.registerTraversalGuard(() => undefined);
  const uninstall = navigationModule.installNavigationHistory();
  return {
    navigation,
    save,
    uninstall,
    cleanup() { uninstall(); untraverse(); unsave(); },
  };
}

it("快速保存后等原生后退事件结束再重放，不在同一微任务中调用 traverseTo", async () => {
  const fixture = await installNativeNavigation();
  try {
    const event = nativeTraversal();
    fixture.navigation.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(fixture.navigation.traverseTo).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.navigation.traverseTo).toHaveBeenCalledExactlyOnceWith("previous-page");
    expect(fixture.save).toHaveBeenCalledTimes(1);
  } finally { fixture.cleanup(); }
});

it.each(["uninstalled", "navigated"] as const)("等待重放时已 %s 不再把用户带回旧页面", async (change) => {
  const fixture = await installNativeNavigation();
  try {
    fixture.navigation.dispatchEvent(nativeTraversal());
    await Promise.resolve();
    await Promise.resolve();
    if (change === "uninstalled") fixture.uninstall();
    else fixture.navigation.currentEntry = { key: "another-page" };
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.navigation.traverseTo).not.toHaveBeenCalled();
  } finally { fixture.cleanup(); }
});

it("原生重放两个阶段均失败时处理全部拒绝，仍允许下次后退", async () => {
  const fixture = await installNativeNavigation();
  try {
    fixture.navigation.traverseTo.mockImplementationOnce(() => ({
      committed: Promise.reject(new DOMException("Invalid key", "InvalidStateError")),
      finished: Promise.reject(new DOMException("Invalid key", "InvalidStateError")),
    }));
    fixture.navigation.dispatchEvent(nativeTraversal());
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.navigation.traverseTo).toHaveBeenCalledTimes(1);

    fixture.navigation.dispatchEvent(nativeTraversal());
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.navigation.traverseTo).toHaveBeenCalledTimes(2);
    expect(fixture.save).toHaveBeenCalledTimes(2);
  } finally { fixture.cleanup(); }
});

it("保存失败保留当前页面，重试成功才重放后退", async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error("保存失败")).mockResolvedValue(undefined);
  const fixture = await installNativeNavigation(save);
  try {
    fixture.navigation.dispatchEvent(nativeTraversal());
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.navigation.traverseTo).not.toHaveBeenCalled();
    fixture.navigation.dispatchEvent(nativeTraversal());
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.navigation.traverseTo).toHaveBeenCalledExactlyOnceWith("previous-page");
  } finally { fixture.cleanup(); }
});

it("路由与布局模块重新载入后仍共享离开保护与历史位置", async () => {
  const route = await import("./navigation");
  vi.resetModules();
  const layout = await import("./navigation");
  const save = vi.fn(async () => undefined);
  const navigate = vi.fn();
  const traverse = vi.fn();
  const unsave = route.registerNavigationGuard(save);
  const untraverse = route.registerTraversalGuard(traverse);
  const uninstall = layout.installNavigationHistory();
  try {
    expect(await layout.navigateAfterSave(navigate)).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    history.pushState({}, "", "/navigation-fixture");
    expect(route.navigationPosition()).toBe(layout.navigationPosition());
    window.dispatchEvent(new PopStateEvent("popstate", { state: { [layout.HISTORY_POSITION]: 0 } }));
    expect(traverse).toHaveBeenCalledTimes(1);
  } finally { uninstall(); unsave(); untraverse(); }
});
