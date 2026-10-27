// @vitest-environment jsdom
import { expect, it, vi } from "vitest";

vi.mock("../components/drafts/draft-repository", () => ({ flushWorkspaceDrafts: async () => undefined }));

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
