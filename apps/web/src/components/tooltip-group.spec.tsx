// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Tooltip, TooltipGroup } from "./ui";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));
function setup() {
  render(
    <>
      <TooltipGroup>
        <Tooltip content="第一个提示">
          <button>一</button>
        </Tooltip>
        <Tooltip content="第二个提示">
          <button>二</button>
        </Tooltip>
      </TooltipGroup>
      <TooltipGroup>
        <Tooltip content="独立组提示">
          <button>三</button>
        </Tooltip>
      </TooltipGroup>
    </>,
  );
  return ["一", "二", "三"].map(
    (label) =>
      screen.getByRole("button", { name: label }).parentElement as HTMLElement,
  );
}
it("首次延迟、关闭延迟、暖机 299/300ms 和组隔离", () => {
  const [one, two, three] = setup();
  if (!one || !two || !three) throw new Error("缺少提示");
  fireEvent.pointerEnter(one);
  tick(179);
  expect(screen.queryByRole("tooltip")).toBeNull();
  tick(1);
  expect(screen.getByRole("tooltip").textContent).toBe("第一个提示");
  fireEvent.pointerLeave(one);
  tick(119);
  expect(screen.getByRole("tooltip")).toBeTruthy();
  tick(1);
  tick(299);
  fireEvent.pointerEnter(two);
  expect(screen.getByRole("tooltip").textContent).toBe("第二个提示");
  fireEvent.pointerLeave(two);
  tick(120);
  tick(300);
  fireEvent.pointerEnter(one);
  expect(screen.queryByRole("tooltip")).toBeNull();
  tick(180);
  fireEvent.pointerEnter(three);
  expect(screen.getAllByRole("tooltip")).toHaveLength(1);
  tick(180);
  expect(screen.getAllByRole("tooltip")).toHaveLength(2);
});
it("快速划过不暖机，悬停提示可继续阅读", () => {
  const [one, two] = setup();
  if (!one || !two) throw new Error("缺少提示");
  fireEvent.pointerEnter(one);
  tick(100);
  fireEvent.pointerLeave(one);
  fireEvent.pointerEnter(two);
  tick(179);
  expect(screen.queryByRole("tooltip")).toBeNull();
  tick(1);
  fireEvent.pointerLeave(two);
  tick(80);
  fireEvent.pointerEnter(screen.getByRole("tooltip"));
  tick(120);
  expect(screen.getByRole("tooltip").textContent).toBe("第二个提示");
});
it("触摸不打开提示，键盘焦点仍即时可用", () => {
  class Pointer extends MouseEvent {
    readonly pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  vi.stubGlobal("PointerEvent", Pointer);
  const [one] = setup();
  if (!one) throw new Error("缺少提示");
  fireEvent.pointerEnter(one, { pointerType: "touch" });
  tick(200);
  expect(screen.queryByRole("tooltip")).toBeNull();
  const button = screen.getByRole("button", { name: "一" });
  fireEvent.pointerDown(button, { pointerType: "touch" });
  fireEvent.focus(button);
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.blur(button);
  fireEvent.focus(button);
  expect(screen.getByRole("tooltip")).toBeTruthy();
  fireEvent.keyDown(button, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
});
