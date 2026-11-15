// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Editor, TLShape } from "tldraw";
import { useReferenceNavigation } from "./use-reference-navigation";
vi.mock("../../../components/ui", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../../components/ui-config", () => ({ motionOptions: () => ({}) }));
vi.mock("./canvas-visibility", () => ({ visibleCanvasBounds: vi.fn() }));
afterEach(cleanup);
it("引用定位只移动视野，连续查看后返回最初视野而不切换选择", () => {
  const editor = {
    getCamera: () => ({ x: 10, y: 20, z: 0.7 }),
    getViewportScreenBounds: () => ({ w: 1200, h: 800 }),
    getShapePageBounds: () => ({ x: 200, y: 200, w: 300, h: 400 }),
    isShapeHidden: () => false,
    zoomToBounds: vi.fn(),
    setCamera: vi.fn(),
    select: vi.fn(),
  };
  let visit: (id: string) => boolean = () => false;
  function View() {
    const nav = useReferenceNavigation(
      editor as unknown as Editor,
      "project",
      () => [{ id: "shape:a" } as TLShape],
    );
    visit = nav.visit;
    return nav.hud;
  }
  render(<View />);
  act(() => {
    visit("a");
    visit("b");
  });
  expect(editor.select).not.toHaveBeenCalled();
  expect(editor.zoomToBounds).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "返回节点" }));
  expect(editor.setCamera).toHaveBeenCalledWith({ x: 10, y: 20, z: 0.7 }, {});
  expect(screen.queryByRole("button", { name: "返回节点" })).toBeNull();
});
it("不可见引用不伪造定位，关闭提示不改变当前视野", () => {
  const editor = {
    getCamera: () => ({ x: 0, y: 0, z: 1 }),
    getViewportScreenBounds: () => ({ w: 1200, h: 800 }),
    getShapePageBounds: () => ({ x: 0, y: 0, w: 100, h: 100 }),
    isShapeHidden: () => false,
    zoomToBounds: vi.fn(),
    setCamera: vi.fn(),
  };
  let visit: (id: string) => boolean = () => false;
  function View() {
    const nav = useReferenceNavigation(
      editor as unknown as Editor,
      "project",
      (id) => (id === "missing" ? [] : [{ id: "shape:a" } as TLShape]),
    );
    visit = nav.visit;
    return nav.hud;
  }
  render(<View />);
  act(() => {
    expect(visit("missing")).toBe(false);
    visit("a");
  });
  fireEvent.click(screen.getByRole("button", { name: "关闭引用定位提示" }));
  expect(editor.setCamera).not.toHaveBeenCalled();
});
