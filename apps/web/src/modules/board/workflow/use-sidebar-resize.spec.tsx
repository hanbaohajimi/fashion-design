// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSidebarResize } from "./use-sidebar-resize";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  class Pointer extends MouseEvent {
    readonly pointerId = 1;
    readonly isPrimary = true;
  }
  vi.stubGlobal("PointerEvent", Pointer);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("按帧写入且只在结束提交，取消恢复抓取点宽度", () => {
  let renders = 0;
  function Harness() {
    renders++;
    const resize = useSidebarResize(true);
    return (
      <div ref={resize.workspaceRef} data-testid="workspace">
        <output>{resize.width}</output>
        <div role="separator" {...resize.resizerProps} />
      </div>
    );
  }
  render(<Harness />);
  Object.defineProperty(screen.getByTestId("workspace"), "clientWidth", {
    value: 1440,
  });
  act(() => vi.advanceTimersByTime(16));
  const target = screen.getByRole("separator");
  target.setPointerCapture = vi.fn();
  target.releasePointerCapture = vi.fn();
  target.hasPointerCapture = () => true;
  const baseline = renders;
  fireEvent.pointerDown(target, { clientX: 900, button: 0 });
  fireEvent.pointerMove(target, { clientX: 880 });
  fireEvent.pointerMove(target, { clientX: 870 });
  expect(renders).toBe(baseline);
  act(() => vi.advanceTimersByTime(16));
  expect(target.getAttribute("aria-valuenow")).toBe("414");
  fireEvent.pointerCancel(target);
  expect(screen.getByTestId("workspace").hasAttribute("data-resizing")).toBe(
    false,
  );
  fireEvent.keyDown(target, { key: "End" });
  expect(screen.getByRole("status").textContent).toBe("480");
});
