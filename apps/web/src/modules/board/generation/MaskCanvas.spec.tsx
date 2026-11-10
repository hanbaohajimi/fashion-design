// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  MaskCanvas,
  type MaskCanvasHandle,
  type MaskCanvasState,
} from "./MaskCanvas";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("keeps each stroke width when the brush changes and restores the same selection after reopening", () => {
  const context = {
    lineWidth: 0,
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(100 * 100 * 4) }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as never,
  );
  const onChange = vi.fn<(state: MaskCanvasState) => void>();
  const ref = createRef<MaskCanvasHandle>();
  const { getByRole, rerender, unmount } = render(
    <MaskCanvas
      ref={ref}
      width={100}
      height={100}
      brushRatio={0.05}
      onChange={onChange}
    />,
  );
  const canvas = getByRole("img") as HTMLCanvasElement;
  canvas.setPointerCapture = vi.fn();
  canvas.hasPointerCapture = () => false;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    right: 100,
    bottom: 100,
    toJSON: () => ({}),
  });
  const stroke = (x: number) => {
    const event = new MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
      clientX: x,
      clientY: 10,
    });
    Object.defineProperty(event, "pointerId", { value: 1 });
    fireEvent(canvas, event);
  };
  stroke(10);
  rerender(
    <MaskCanvas
      ref={ref}
      width={100}
      height={100}
      brushRatio={0.2}
      onChange={onChange}
    />,
  );
  expect(context.lineWidth).toBe(8);
  stroke(30);
  const draft = onChange.mock.calls.at(-1)?.[0].draft;
  expect(draft?.strokes.map((value) => value.lineWidth)).toEqual([8, 20]);
  unmount();
  render(
    <MaskCanvas
      width={100}
      height={100}
      brushRatio={0.2}
      initialDraft={draft}
      onChange={onChange}
    />,
  );
  expect(onChange.mock.calls.at(-1)?.[0].draft?.strokes).toEqual(
    draft?.strokes,
  );
});

function drawingCanvas() {
  const context = {
    lineWidth: 0,
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(100 * 100 * 4) }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as never,
  );
  const onChange = vi.fn<(state: MaskCanvasState) => void>();
  const ref = createRef<MaskCanvasHandle>();
  const view = render(
    <MaskCanvas
      ref={ref}
      width={100}
      height={100}
      brushRatio={0.1}
      onChange={onChange}
    />,
  );
  const canvas = view.getByRole("img") as HTMLCanvasElement;
  const captures = new Set<number>();
  canvas.setPointerCapture = (id) => {
    captures.add(id);
  };
  canvas.hasPointerCapture = (id) => captures.has(id);
  canvas.releasePointerCapture = (id) => {
    captures.delete(id);
  };
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    right: 100,
    bottom: 100,
    toJSON: () => ({}),
  });
  const pointer = (type: string, id: number, x: number) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      button: 0,
      clientX: x,
      clientY: 50,
    });
    Object.defineProperty(event, "pointerId", { value: id });
    fireEvent(canvas, event);
  };
  const strokes = () => onChange.mock.calls.at(-1)?.[0].draft?.strokes;
  return { ...view, onChange, ref, canvas, captures, pointer, strokes };
}

it("keeps one pointer per stroke and recovers from capture loss, cancellation and window blur", () => {
  const drawing = drawingCanvas();
  drawing.pointer("pointerdown", 1, 10);
  drawing.pointer("pointerdown", 2, 80);
  drawing.pointer("pointermove", 2, 90);
  drawing.pointer("pointerup", 2, 90);
  drawing.pointer("pointermove", 1, 20);
  expect(drawing.strokes()).toHaveLength(1);
  expect(drawing.strokes()?.[0]?.points).toEqual([
    { x: 10, y: 50 },
    { x: 20, y: 50 },
  ]);
  drawing.pointer("lostpointercapture", 1, 20);
  drawing.pointer("pointermove", 1, 30);
  drawing.pointer("pointerdown", 3, 40);
  drawing.pointer("pointercancel", 3, 40);
  drawing.pointer("pointerdown", 4, 50);
  fireEvent(window, new Event("blur"));
  drawing.pointer("pointermove", 4, 60);
  drawing.pointer("pointerdown", 5, 70);
  drawing.pointer("pointerup", 5, 70);
  expect(drawing.strokes()?.map((stroke) => stroke.points.length)).toEqual([
    2, 1, 1, 1,
  ]);
  expect(drawing.captures.size).toBe(0);
});

it("freezes pointer and toolbar changes while submitted, then permits a new stroke after unlocking", () => {
  const drawing = drawingCanvas();
  drawing.pointer("pointerdown", 1, 10);
  drawing.rerender(
    <MaskCanvas
      ref={drawing.ref}
      width={100}
      height={100}
      brushRatio={0.1}
      disabled
      onChange={drawing.onChange}
    />,
  );
  drawing.pointer("pointermove", 1, 30);
  drawing.pointer("pointerdown", 2, 40);
  act(() => {
    drawing.ref.current?.clear();
    drawing.ref.current?.undo();
    drawing.ref.current?.addCenterRegion();
  });
  expect(drawing.strokes()).toHaveLength(1);
  expect(drawing.strokes()?.[0]?.points).toEqual([{ x: 10, y: 50 }]);
  expect(drawing.captures.size).toBe(0);
  drawing.rerender(
    <MaskCanvas
      ref={drawing.ref}
      width={100}
      height={100}
      brushRatio={0.1}
      onChange={drawing.onChange}
    />,
  );
  drawing.pointer("pointerdown", 3, 50);
  drawing.pointer("pointerup", 3, 50);
  expect(drawing.strokes()).toHaveLength(2);
});

it("does not apply a saved mask to a different image size", () => {
  const drawing = drawingCanvas();
  drawing.pointer("pointerdown", 1, 10);
  const draft = drawing.onChange.mock.calls.at(-1)?.[0].draft;
  drawing.unmount();
  render(
    <MaskCanvas
      width={200}
      height={100}
      brushRatio={0.1}
      initialDraft={draft}
      onChange={drawing.onChange}
    />,
  );
  expect(drawing.strokes()).toHaveLength(0);
});

it("records feathering per stroke and never expands the painted radius when later settings change", () => {
  const paints: { radius: number; alpha: number }[] = [];
  const context = {
    globalAlpha: 1,
    lineWidth: 0,
    clearRect: () => {
      paints.length = 0;
    },
    beginPath: vi.fn(),
    arc: (_x: number, _y: number, radius: number) =>
      paints.push({ radius, alpha: context.globalAlpha }),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(100 * 100 * 4) }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as never,
  );
  const onChange = vi.fn<(state: MaskCanvasState) => void>();
  const { getByRole, rerender, unmount } = render(
    <MaskCanvas
      width={100}
      height={100}
      brushRatio={0.4}
      softness={0.5}
      onChange={onChange}
    />,
  );
  const canvas = getByRole("img") as HTMLCanvasElement;
  canvas.setPointerCapture = vi.fn();
  canvas.hasPointerCapture = () => false;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    right: 100,
    bottom: 100,
    toJSON: () => ({}),
  });
  const stroke = (x: number) => {
    const event = new MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
      clientX: x,
      clientY: 50,
    });
    Object.defineProperty(event, "pointerId", { value: 1 });
    fireEvent(canvas, event);
  };
  stroke(30);
  const firstPaints = [...paints];
  expect(firstPaints.length).toBeGreaterThan(1);
  expect(
    firstPaints.every(
      (value) => value.radius <= 20 && value.alpha > 0 && value.alpha <= 1,
    ),
  ).toBe(true);
  expect(firstPaints[0]?.alpha).toBeLessThan(0.02);
  expect(firstPaints.at(-1)?.alpha).toBe(1);
  rerender(
    <MaskCanvas
      width={100}
      height={100}
      brushRatio={0.2}
      softness={0.8}
      onChange={onChange}
    />,
  );
  expect(paints).toEqual(firstPaints);
  stroke(70);
  const draft = onChange.mock.calls.at(-1)?.[0].draft;
  expect(
    draft?.strokes.map((value) => ({
      width: value.lineWidth,
      softness: value.softness,
    })),
  ).toEqual([
    { width: 40, softness: 0.5 },
    { width: 20, softness: 0.8 },
  ]);
  const bothPaints = [...paints];
  unmount();
  render(
    <MaskCanvas
      width={100}
      height={100}
      brushRatio={0.1}
      softness={0}
      initialDraft={draft}
      onChange={onChange}
    />,
  );
  expect(paints).toEqual(bothPaints);
  expect(context.globalAlpha).toBe(1);
});
