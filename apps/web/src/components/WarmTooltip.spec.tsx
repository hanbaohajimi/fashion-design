// @vitest-environment jsdom
import type { HTMLAttributes, ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WarmTooltip, { WarmTooltipGroup } from "./WarmTooltip";

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  useReducedMotion: () => true,
  motion: { span: ({ children, className, style, id, role }: HTMLAttributes<HTMLSpanElement>) => <span className={className} style={style} id={id} role={role}>{children}</span> },
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("PointerEvent", class extends MouseEvent { pointerType: string; constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerType = init.pointerType ?? "mouse"; } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const advance = (time: number) => act(() => vi.advanceTimersByTime(time));

describe("WarmTooltip adapted canvas behavior", () => {
  it("cold delay then warm switching keeps one label and preserves existing description", () => {
    render(<WarmTooltipGroup><WarmTooltip content="上传参考"><button aria-describedby="original">上传</button></WarmTooltip><WarmTooltip content="历史"><button>历史</button></WarmTooltip></WarmTooltipGroup>);
    const first = screen.getByRole("button", { name: "上传" }), second = screen.getByRole("button", { name: "历史" });
    fireEvent.pointerEnter(first, { pointerType: "mouse", buttons: 0 }); advance(399); expect(screen.queryByRole("tooltip")).toBeNull();
    advance(1); expect(screen.getByRole("tooltip").textContent).toBe("上传参考"); expect(first.getAttribute("aria-describedby")).toMatch(/^original /);
    fireEvent.pointerLeave(first); fireEvent.pointerEnter(second, { pointerType: "mouse", buttons: 0 });
    expect(screen.getAllByRole("tooltip")).toHaveLength(1); expect(screen.getByRole("tooltip").textContent).toBe("历史");
    expect(first.getAttribute("aria-describedby")).toBe("original");
    fireEvent.keyDown(document, { key: "Escape" }); expect(screen.queryByRole("tooltip")).toBeNull();
  });
  it("long press explains without executing; movement cancels and ordinary tap still executes", () => {
    const click = vi.fn();
    render(<WarmTooltip content="生成"><button onClick={click}>开始</button></WarmTooltip>);
    const button = screen.getByRole("button", { name: "开始" });
    fireEvent.pointerDown(button, { pointerType: "touch", clientX: 10, clientY: 10 }); advance(500);
    expect(screen.getByRole("tooltip").textContent).toBe("生成");
    fireEvent.pointerUp(button, { pointerType: "touch" }); fireEvent.click(button); fireEvent.pointerLeave(button, { pointerType: "touch" }); advance(500);
    expect(click).not.toHaveBeenCalled(); expect(screen.getByRole("tooltip").textContent).toBe("生成");
    fireEvent.pointerDown(button, { pointerType: "touch", clientX: 10, clientY: 10 });
    fireEvent.pointerMove(button, { pointerType: "touch", clientX: 30, clientY: 10 }); advance(600);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerUp(button, { pointerType: "touch" });
    fireEvent.pointerDown(button, { pointerType: "touch" }); fireEvent.pointerUp(button, { pointerType: "touch" }); fireEvent.click(button);
    expect(click).toHaveBeenCalledTimes(1);
  });
  it("leaving before delay and unmounting cancel timers and leave no stale portal", () => {
    const view = render(<WarmTooltip content="删除"><button>删除</button></WarmTooltip>);
    const button = screen.getByRole("button", { name: "删除" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" }); fireEvent.pointerLeave(button); advance(600);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerEnter(button, { pointerType: "mouse" }); view.unmount(); advance(600);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
