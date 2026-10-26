// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Button, Dialog, Menu, SegmentedControl, SkeletonGroup } from "../ui";
import { useSubmitFeedback } from "./use-submit-feedback";
import { ConnectionNotice } from "./ConnectionNotice";
import { useUploadFeedback } from "./use-upload-feedback";
import { placeFloatingPanel } from "./floating-position";

let animations: Array<{ onfinish: (() => void) | null; cancel: ReturnType<typeof vi.fn> }>;
let preferences: Set<() => void>;
beforeEach(() => {
  vi.useFakeTimers();
  animations = [];
  preferences = new Set();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: (_: string, listener: () => void) => preferences.add(listener), removeEventListener: (_: string, listener: () => void) => preferences.delete(listener) }));
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() { this.callback([{ isIntersecting: true }]); }
    disconnect() {}
  });
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: vi.fn(() => {
    const animation = { onfinish: null, cancel: vi.fn(), playState: "running" };
    animations.push(animation);
    return animation as unknown as Animation;
  }) });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("holds only closing presentation, restores focus once, and clears after close", () => {
  const after = vi.fn();
  const close = vi.fn();
  const trigger = document.createElement("button");
  document.body.append(trigger); trigger.focus();
  const { rerender } = render(<Dialog open label="编辑资料" onClose={close} onAfterClose={after}><input aria-label="名称" /></Dialog>);
  const dialog = screen.getByRole("dialog") as HTMLDialogElement;
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(close).toHaveBeenCalledOnce();
  expect(dialog.open).toBe(true);
  rerender(<Dialog open={false} label="编辑资料" onClose={close} onAfterClose={after}><input aria-label="名称" /></Dialog>);
  expect(dialog.open).toBe(true);
  expect(document.activeElement).toBe(dialog);
  expect((dialog.firstElementChild as HTMLElement).inert).toBe(true);
  act(() => animations.at(-1)?.onfinish?.());
  expect(dialog.open).toBe(false);
  expect(document.activeElement).toBe(trigger);
  expect(after).toHaveBeenCalledOnce();
  trigger.remove();
});

it("interrupts a closing dialog without stale completion stealing focus", () => {
  const after = vi.fn();
  const { rerender } = render(<Dialog label="快速编辑" onClose={() => {}} onAfterClose={after}><input aria-label="资料" /></Dialog>);
  rerender(<Dialog open={false} label="快速编辑" onClose={() => {}} onAfterClose={after}><input aria-label="资料" /></Dialog>);
  const oldFinish = animations.at(-1)?.onfinish;
  rerender(<Dialog open label="快速编辑" onClose={() => {}} onAfterClose={after}><input aria-label="资料" /></Dialog>);
  act(() => oldFinish?.());
  expect((screen.getByRole("dialog") as HTMLDialogElement).open).toBe(true);
  expect(after).not.toHaveBeenCalled();
  expect((screen.getByRole("textbox") as HTMLElement).inert).toBe(false);
});

it("finishes the current presentation on preference changes", () => {
  const after = vi.fn();
  const { rerender } = render(<Dialog label="偏好" onClose={() => {}} onAfterClose={after}>内容</Dialog>);
  rerender(<Dialog open={false} label="偏好" onClose={() => {}} onAfterClose={after}>内容</Dialog>);
  act(() => preferences.forEach(listener => listener()));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(after).toHaveBeenCalledOnce();
});

it("accepts only the latest real outcome and expires success without changing business state", () => {
  const hook = renderHook(() => useSubmitFeedback());
  let first!: ReturnType<typeof hook.result.current.begin>;
  let second!: ReturnType<typeof hook.result.current.begin>;
  act(() => { first = hook.result.current.begin("save"); second = hook.result.current.begin("publish"); });
  act(() => first.succeed());
  expect(hook.result.current.snapshot.phase).toBe("pending");
  act(() => second.fail());
  expect(hook.result.current.snapshot.phase).toBe("error");
  act(() => { hook.result.current.reset(); second.succeed(); });
  expect(hook.result.current.snapshot.phase).toBe("idle");
  act(() => { hook.result.current.begin("save").succeed(); });
  expect(hook.result.current.snapshot.phase).toBe("success");
  act(() => vi.advanceTimersByTime(1000));
  expect(hook.result.current.snapshot.phase).toBe("idle");
});

it("keeps button name and node while replacing delayed waiting decoration", () => {
  const feedback = { phase: "pending" as const, actionKey: "save", revision: 1 };
  const { rerender } = render(<Button loading feedback={feedback}>保存修订</Button>);
  const button = screen.getByRole("button", { name: "保存修订" });
  expect(button.querySelector("i")).toBeNull();
  act(() => vi.advanceTimersByTime(300));
  expect(button.querySelector("i")).toBeTruthy();
  expect(button.textContent).not.toContain("···");
  rerender(<Button feedback={{ ...feedback, phase: "success" }}>保存修订</Button>);
  expect(screen.getByRole("button", { name: "保存修订" })).toBe(button);
  expect(button.querySelector("svg")).toBeTruthy();
});

it("starts one skeleton highlight only after the waiting threshold", () => {
  const { container } = render(<SkeletonGroup><span>占位</span></SkeletonGroup>);
  expect(container.firstElementChild?.hasAttribute("data-sweeping")).toBe(false);
  act(() => vi.advanceTimersByTime(300));
  expect(container.firstElementChild?.hasAttribute("data-sweeping")).toBe(true);
  expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
});

it("retains segmented keyboard selection with an opt-in decorative indicator", () => {
  const change = vi.fn();
  render(<SegmentedControl animated label="分组" value="a" options={[{ value: "a", label: "整理" }, { value: "b", label: "核对" }]} onChange={change} />);
  fireEvent.keyDown(screen.getByRole("button", { name: "整理" }), { key: "ArrowRight" });
  expect(change).toHaveBeenCalledWith("b");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "核对" }));
});

it("reports connectivity without dispatching requests or claiming synchronization", () => {
  render(<ConnectionNotice />);
  expect(screen.queryByRole("status")).toBeNull();
  act(() => window.dispatchEvent(new Event("offline")));
  expect(screen.getByRole("status").getAttribute("aria-label")).toContain("网络已断开");
  act(() => window.dispatchEvent(new Event("online")));
  expect(screen.getByRole("status").getAttribute("aria-label")).toBe("连接已恢复");
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.queryByRole("status")).toBeNull();
});

it("releases local previews and prevents stale upload progress from replacing a new file", () => {
  class PreviewUrl extends URL {
    static override createObjectURL = vi.fn(() => `blob:preview-${PreviewUrl.createObjectURL.mock.calls.length}`);
    static override revokeObjectURL = vi.fn();
  }
  vi.stubGlobal("URL", PreviewUrl);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  const hook = renderHook(() => useUploadFeedback());
  let first!: ReturnType<typeof hook.result.current.start>;
  act(() => { first = hook.result.current.start(new File(["first"], "first.png", { type: "image/png" })); first.stage("uploading"); first.onProgress({ loaded: 1, total: 5, lengthComputable: true }); });
  act(() => { hook.result.current.start(new File(["second"], "second.png", { type: "image/png" })); });
  expect(first.signal.aborted).toBe(true);
  act(() => { first.done("/old-preview"); vi.advanceTimersByTime(16); });
  expect(hook.result.current.preview?.name).toBe("second.png");
  act(() => hook.result.current.cancel());
  expect(hook.result.current.preview?.stage).toBe("canceled");
  expect(hook.result.current.preview?.src).toBeUndefined();
  expect(PreviewUrl.revokeObjectURL).toHaveBeenCalledTimes(2);
  act(() => window.dispatchEvent(new Event("fashion:session-changed")));
  expect(hook.result.current.preview).toBeNull();
});

it("locks a sheet drag to its initiating primary pointer", () => {
  class MotionPointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly isPrimary: boolean;
    constructor(type: string, init: MouseEventInit & { pointerId?: number; isPrimary?: boolean } = {}) {
      super(type, init); this.pointerId = init.pointerId ?? 1; this.isPrimary = init.isPrimary ?? true;
    }
  }
  vi.stubGlobal("PointerEvent", MotionPointerEvent);
  const close = vi.fn();
  render(<Dialog variant="sheet" label="指针隔离" onClose={close}><div data-sheet-handle>把手</div><p>正文</p></Dialog>);
  act(() => animations.at(-1)?.onfinish?.());
  vi.spyOn(screen.getByRole("dialog"), "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 300));
  const handle = screen.getByText("把手");
  fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, button: 0, clientY: 0 });
  fireEvent.pointerMove(handle, { pointerId: 1, isPrimary: true, clientY: 160 });
  fireEvent.pointerDown(handle, { pointerId: 2, isPrimary: false, button: 0, clientY: 0 });
  fireEvent.pointerUp(screen.getByText("正文"), { pointerId: 2, isPrimary: false, clientY: 160 });
  expect(close).not.toHaveBeenCalled();
  fireEvent.pointerUp(handle, { pointerId: 1, isPrimary: true, clientY: 160 });
  expect(close).toHaveBeenCalledOnce();
});

it("exits a repositioned portal menu at its current bounds inside the native modal", () => {
  render(<Dialog label="菜单宿主" onClose={() => {}}><Menu label="操作" portal><button>归档</button></Menu></Dialog>);
  const trigger = screen.getByText("操作");
  let top = 750;
  vi.spyOn(trigger, "getBoundingClientRect").mockImplementation(() => new DOMRect(30, top, 80, 24));
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.getAttribute("aria-label") === "操作选项" ? new DOMRect(0, 0, 200, 100) : original.call(this);
  });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const menu = screen.getByRole("group", { name: "操作选项" });
  top = 720;
  fireEvent.scroll(window);
  const expectedTop = menu.style.top;
  fireEvent.keyDown(menu, { key: "Escape" });
  const ghost = screen.getByRole("dialog").querySelector<HTMLElement>('[aria-label="操作选项"][aria-hidden="true"]');
  expect(ghost).toBeTruthy();
  expect(ghost?.style.top).toBe(expectedTop);
  const frames = vi.mocked(HTMLElement.prototype.animate).mock.calls.at(-1)?.[0] as Keyframe[];
  expect(frames.at(-1)?.transform).toContain("translateY(6px)");
});

it("places a top-layer portal in its animated dialog coordinate system", () => {
  const dialog = document.createElement("dialog");
  dialog.open = true; dialog.style.transform = "scale(.5)";
  const panel = document.createElement("span"); dialog.append(panel); document.body.append(dialog);
  Object.defineProperty(dialog, "offsetWidth", { value: 400 });
  Object.defineProperty(dialog, "offsetHeight", { value: 400 });
  vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 200, 200));
  placeFloatingPanel(panel, 200, 250);
  expect(panel.style.left).toBe("200px"); expect(panel.style.top).toBe("300px");
  dialog.style.transform = "none";
  placeFloatingPanel(panel, 200, 250);
  expect(panel.style.left).toBe("200px"); expect(panel.style.top).toBe("250px");
  dialog.remove();
});
