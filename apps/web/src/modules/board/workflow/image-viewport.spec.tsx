// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImageViewer } from "./ImageViewer";
import { clampImagePan, pinchImagePan } from "./use-image-viewport";

let frames = new Map<number, FrameRequestCallback>();
let serial = 0;
beforeEach(() => {
  frames = new Map(); serial = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++serial, callback); return serial; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("PointerEvent", class extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 1; } });
  Element.prototype.setPointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const flush = () => act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(performance.now())); });
const props = { url: "/image.png", title: "原图", zoom: 100, onZoom: vi.fn(), onSize: vi.fn(), annotations: [], comments: [], mode: "view", pen: { kind: "pen" as const, color: "#ff0000", width: 2, text: "" }, onAnnotation: vi.fn(), onPoint: vi.fn() };

it("clamps panning and keeps the image point under the moving pinch midpoint", () => {
  expect(clampImagePan({ x: 900, y: -900 }, 2, { width: 400, height: 300 }, { width: 600, height: 400 })).toEqual({ x: 116, y: -116 });
  expect(clampImagePan({ x: 40, y: 40 }, .5, { width: 400, height: 300 }, { width: 600, height: 400 })).toEqual({ x: 0, y: 0 });
  expect(pinchImagePan({ x: 10, y: 20 }, { x: 90, y: 110 }, 3)).toEqual({ x: 60, y: 50 });
});

it("moves the common frame without a React commit on pointer frames, commits on release", () => {
  const commits = vi.fn(); const zoom = vi.fn();
  const { getByLabelText, container } = render(<Profiler id="viewer" onRender={commits}><ImageViewer {...props} onZoom={zoom} /></Profiler>);
  const view = getByLabelText("图片查看区域");
  const before = commits.mock.calls.length;
  fireEvent.pointerDown(view, { pointerId: 1, clientX: 400, clientY: 300 });
  for (let i = 1; i <= 10; i++) fireEvent.pointerMove(view, { pointerId: 1, clientX: 400 + i, clientY: 300 + i });
  expect(frames.size).toBe(1); flush();
  expect(commits.mock.calls.length).toBe(before);
  expect(container.querySelector("[style*='--image-scale']")?.getAttribute("style")).toContain("--image-y: 10px");
  fireEvent.pointerUp(view, { pointerId: 1 });
  expect(zoom).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
});

it("does not navigate from annotation mode and discards canceled drawing", () => {
  const navigate = vi.fn(); const annotation = vi.fn();
  const { getByLabelText } = render(<ImageViewer {...props} mode="annotate" onNavigate={navigate} onAnnotation={annotation} previousUrl="/a.png" nextUrl="/c.png" />);
  const view = getByLabelText("图片查看区域");
  fireEvent.pointerDown(view, { pointerId: 1, clientX: 50, clientY: 50 });
  fireEvent.pointerMove(view, { pointerId: 1, clientX: 450, clientY: 50 });
  fireEvent.pointerCancel(view, { pointerId: 1 });
  expect(navigate).not.toHaveBeenCalled(); expect(annotation).not.toHaveBeenCalled();
});

it("pinches around the midpoint and rebases one-finger pan without a jump", () => {
  const zoom = vi.fn();
  const { getByLabelText, container, unmount } = render(<ImageViewer {...props} onZoom={zoom} />);
  const view = getByLabelText("图片查看区域");
  fireEvent.pointerDown(view, { pointerId: 1, clientX: 300, clientY: 300 });
  fireEvent.pointerDown(view, { pointerId: 2, clientX: 500, clientY: 300 });
  fireEvent.pointerMove(view, { pointerId: 1, clientX: 200, clientY: 300 });
  fireEvent.pointerMove(view, { pointerId: 2, clientX: 600, clientY: 300 });
  flush();
  const frame = container.querySelector<HTMLElement>("[style*='--image-scale']");
  expect(frame?.style.getPropertyValue("--image-scale")).toBe("2");
  expect(frame?.style.getPropertyValue("--image-x")).toBe("0px");
  expect(zoom).not.toHaveBeenCalled();
  fireEvent.pointerUp(view, { pointerId: 1 });
  fireEvent.pointerMove(view, { pointerId: 2, clientX: 620, clientY: 300 });
  flush();
  expect(frame?.style.getPropertyValue("--image-x")).toBe("20px");
  fireEvent.pointerCancel(view, { pointerId: 2 });
  expect(zoom).toHaveBeenCalledWith(200);
  unmount();
  expect(frames.size).toBe(0);
});
