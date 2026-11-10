// @vitest-environment jsdom
import { act, fireEvent, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceChrome } from "./WorkspaceChrome";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "账号先于工作区恢复时不重建页面，窄屏=%s",
  async (compact) => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion") || compact,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const workspace = (accountId: string | null) => (
      <WorkspaceChrome
        accountId={accountId}
        kind="document"
        routeKey="/project/studio"
      >
        <input aria-label="修改说明" defaultValue="" />
      </WorkspaceChrome>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(workspace(null));
    document.body.append(container);
    const input = container.querySelector("input");
    if (!input) throw new Error("服务端表单缺失");
    input.value = "初始化时写下的修改说明";
    input.focus();
    input.setSelectionRange(2, 5);
    const errors = vi.fn();
    let root: Root | undefined;
    try {
      // Auth can resolve while the surrounding Suspense boundary is still hydrating.
      await act(async () => {
        root = hydrateRoot(container, workspace("restored-designer"), {
          onRecoverableError: errors,
        });
      });
      expect(errors).not.toHaveBeenCalled();
      expect(container.querySelector("input")).toBe(input);
      expect(input.value).toBe("初始化时写下的修改说明");
      expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
      expect(document.activeElement).toBe(input);
      fireEvent(window, new Event("offline"));
      expect(
        within(container).getByRole("status", {
          name: "网络已断开，已加载的内容仍可查看",
        }),
      ).toBeDefined();
      await act(async () => root?.render(workspace(null)));
      expect(within(container).queryByRole("status")).toBeNull();
      expect(container.querySelector("input")).toBe(input);
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  },
);
