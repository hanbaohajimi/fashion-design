// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MaskCanvas, type MaskCanvasHandle, type MaskCanvasState } from "./MaskCanvas";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("keeps each stroke width when the brush changes and restores the same selection after reopening", () => {
  const context = { lineWidth: 0, clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(100 * 100 * 4) }) };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
  const onChange = vi.fn<(state: MaskCanvasState) => void>();
  const ref = createRef<MaskCanvasHandle>();
  const { getByRole, rerender, unmount } = render(<MaskCanvas ref={ref} width={100} height={100} brushRatio={.05} onChange={onChange} />);
  const canvas = getByRole("img") as HTMLCanvasElement;
  canvas.setPointerCapture = vi.fn(); canvas.hasPointerCapture = () => false;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, toJSON: () => ({}) });
  const stroke = (x: number) => { const event = new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: x, clientY: 10 }); Object.defineProperty(event, "pointerId", { value: 1 }); fireEvent(canvas, event); };
  stroke(10);
  rerender(<MaskCanvas ref={ref} width={100} height={100} brushRatio={.2} onChange={onChange} />);
  expect(context.lineWidth).toBe(8);
  stroke(30);
  const draft = onChange.mock.calls.at(-1)?.[0].draft;
  expect(draft?.strokes.map(value => value.lineWidth)).toEqual([8, 20]);
  unmount(); render(<MaskCanvas width={100} height={100} brushRatio={.2} initialDraft={draft} onChange={onChange} />);
  expect(onChange.mock.calls.at(-1)?.[0].draft?.strokes).toEqual(draft?.strokes);
});

it("records feathering per stroke and never expands the painted radius when later settings change", () => {
  const paints: { radius: number; alpha: number }[] = [];
  const context = { globalAlpha: 1, lineWidth: 0, clearRect: () => { paints.length = 0; }, beginPath: vi.fn(),
    arc: (_x: number, _y: number, radius: number) => paints.push({ radius, alpha: context.globalAlpha }),
    fill: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(100 * 100 * 4) }) };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
  const onChange = vi.fn<(state: MaskCanvasState) => void>();
  const { getByRole, rerender, unmount } = render(<MaskCanvas width={100} height={100} brushRatio={.4} softness={.5} onChange={onChange} />);
  const canvas = getByRole("img") as HTMLCanvasElement;
  canvas.setPointerCapture = vi.fn(); canvas.hasPointerCapture = () => false;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, toJSON: () => ({}) });
  const stroke = (x: number) => { const event = new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: x, clientY: 50 }); Object.defineProperty(event, "pointerId", { value: 1 }); fireEvent(canvas, event); };
  stroke(30);
  const firstPaints = [...paints];
  expect(firstPaints.length).toBeGreaterThan(1);
  expect(firstPaints.every(value => value.radius <= 20 && value.alpha > 0 && value.alpha <= 1)).toBe(true);
  expect(firstPaints[0]?.alpha).toBeLessThan(.02);
  expect(firstPaints.at(-1)?.alpha).toBe(1);
  rerender(<MaskCanvas width={100} height={100} brushRatio={.2} softness={.8} onChange={onChange} />);
  expect(paints).toEqual(firstPaints);
  stroke(70);
  const draft = onChange.mock.calls.at(-1)?.[0].draft;
  expect(draft?.strokes.map(value => ({ width: value.lineWidth, softness: value.softness }))).toEqual([{ width: 40, softness: .5 }, { width: 20, softness: .8 }]);
  const bothPaints = [...paints];
  unmount(); render(<MaskCanvas width={100} height={100} brushRatio={.1} softness={0} initialDraft={draft} onChange={onChange} />);
  expect(paints).toEqual(bothPaints);
  expect(context.globalAlpha).toBe(1);
});
