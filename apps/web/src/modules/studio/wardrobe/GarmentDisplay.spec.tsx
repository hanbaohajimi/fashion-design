// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { WardrobeRevisionView } from "@fashion/shared";
import { GarmentDisplay } from "./GarmentDisplay";

const bounds = { width: 1000, height: 1200, x: 100, y: 100, contentWidth: 800, contentHeight: 1000 };
const front: Pick<WardrobeRevisionView, "name" | "category" | "display" | "anchor" | "url" | "imageBounds" | "presentation"> = {
  name: "丝绸上衣", category: "top", display: "hanger", anchor: { x: .5, y: .12 }, url: "/front.png", imageBounds: bounds,
  presentation: { supportWidthRatio: .45, sideDisplay: { assetId: "side", url: "/side.png", imageBounds: bounds, anchor: { x: .42, y: .13 }, orientation: "left", source: "generated", preparationId: "side-preparation", reviewed: true } },
};
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("uses an explicit loading placeholder until the side loads and restores the front on focus", () => {
  const { container, rerender } = render(<GarmentDisplay item={front} view="side" />);
  const garment = container.querySelector<HTMLElement>("[data-garment]");
  const side = container.querySelector<HTMLImageElement>("[data-image-view=side] img");
  expect(garment?.dataset.view).toBe("placeholder");
  expect(garment?.dataset.sideState).toBe("loading");
  expect(container.querySelector("[data-side-placeholder]")?.textContent).toContain("加载中");
  expect(side).not.toBeNull();
  Object.defineProperty(side, "naturalWidth", { value: 1000 });
  fireEvent.load(side as HTMLImageElement);
  expect(garment?.dataset.view).toBe("side");
  expect(garment?.dataset.sideState).toBe("ready");
  expect(container.querySelector("[data-side-placeholder]")).toBeNull();
  expect(garment?.dataset.presentation).toBe("dual-view");
  expect(container.querySelector("[data-image-view=front] img")?.getAttribute("src")).toBe("/front.png");
  rerender(<GarmentDisplay item={front} view="front" />);
  expect(garment?.dataset.view).toBe("front");
  expect(container.querySelector("[data-side-placeholder]")).toBeNull();
});

it("reports failed side imagery without a projected substitute and keeps front inspection available", () => {
  const { container, rerender, getByRole } = render(<GarmentDisplay item={front} view="side" />);
  const garment = container.querySelector<HTMLElement>("[data-garment]");
  const side = container.querySelector<HTMLImageElement>("[data-image-view=side] img");
  Object.defineProperty(side, "naturalWidth", { value: 1000 });
  fireEvent.load(side as HTMLImageElement);
  fireEvent.error(side as HTMLImageElement);
  expect(garment?.dataset.view).toBe("placeholder");
  expect(garment?.dataset.sideState).toBe("error");
  expect(getByRole("status", { name: "侧挂图暂不可用，点击查看正面" })).toBeTruthy();
  expect(garment?.hasAttribute("data-view-fallback")).toBe(false);
  expect(container.querySelector("[data-image-view=front] img")?.getAttribute("src")).toBe("/front.png");
  rerender(<GarmentDisplay item={front} view="front" />);
  expect(garment?.dataset.view).toBe("front");
  expect(container.querySelector("[data-side-placeholder]")).toBeNull();
  rerender(<GarmentDisplay item={front} view="side" />);
  expect(garment?.dataset.view).toBe("placeholder");
  expect(getByRole("status", { name: "侧挂图暂不可用，点击查看正面" })).toBeTruthy();
});

it("keeps the side and its turning geometry while a hovered front is still decoding", async () => {
  const { container, rerender } = render(<GarmentDisplay item={front} view="side" rackMotion />);
  const garment = container.querySelector<HTMLElement>("[data-garment]");
  const sideImage = container.querySelector<HTMLImageElement>("[data-image-view=side] img");
  const frontImage = container.querySelector<HTMLImageElement>("[data-image-view=front] img");
  if (!sideImage || !frontImage) throw new Error("Missing garment images");
  let finishDecode!: () => void;
  const decoding = new Promise<void>(resolve => { finishDecode = resolve; });
  Object.defineProperty(frontImage, "decode", { value: () => decoding });
  fireEvent.load(sideImage);
  expect(garment?.dataset.view).toBe("side");
  expect(garment?.hasAttribute("data-rack-turn")).toBe(true);

  rerender(<GarmentDisplay item={front} view="front" rackMotion />);
  fireEvent.load(frontImage);
  expect(garment?.dataset.view).toBe("side");
  await act(async () => { finishDecode(); await decoding; });
  expect(garment?.dataset.view).toBe("front");
  expect(garment?.hasAttribute("data-rack-turn")).toBe(true);
});

it("starts a changed side URL in loading state instead of carrying over the previous failure", () => {
  const { container, rerender } = render(<GarmentDisplay item={front} view="side" />);
  const oldImage = container.querySelector<HTMLImageElement>("[data-image-view=side] img");
  fireEvent.error(oldImage as HTMLImageElement);
  const side = front.presentation?.sideDisplay;
  if (!side) throw new Error("Missing side fixture");
  rerender(<GarmentDisplay item={{ ...front, presentation: { sideDisplay: { ...side, url: "/new-side.png" } } }} view="side" />);
  const garment = container.querySelector<HTMLElement>("[data-garment]");
  expect(garment?.dataset.sideState).toBe("loading");
  expect(container.querySelector("[data-side-placeholder]")?.textContent).toContain("加载中");
  const newImage = container.querySelector<HTMLImageElement>("[data-image-view=side] img");
  Object.defineProperty(newImage, "naturalWidth", { value: 1000 });
  fireEvent.load(newImage as HTMLImageElement);
  expect(garment?.dataset.view).toBe("side");
});

it("honors the reviewed support width and keeps an absent side explicitly a projection", () => {
  const { container, rerender } = render(<GarmentDisplay item={front} />);
  const garment = container.querySelector<HTMLElement>("[data-garment]");
  expect(Number(garment?.style.getPropertyValue("--hardware-ratio"))).toBeCloseTo(.8 * .45);
  rerender(<GarmentDisplay item={{ ...front, presentation: { supportWidthRatio: .45 } }} view="side" />);
  expect(garment?.dataset.presentation).toBe("projection");
  expect(garment?.dataset.view).toBe("front");
  expect(container.querySelector("[data-image-view=side]")).toBeNull();
});

it("reserves the greater front/side lower extent so hovering cannot move the label into either hem", () => {
  const nativeStyle = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => {
    const value = nativeStyle(element);
    if (element.hasAttribute("data-garment")) return new Proxy(value, { get(target, key) { if (key === "width") return "200px"; const result = Reflect.get(target, key); return typeof result === "function" ? result.bind(target) : result; } });
    return value;
  });
  const side = front.presentation?.sideDisplay;
  if (!side) throw new Error("Missing side fixture");
  const item = { ...front, presentation: { supportWidthRatio: .45, sideDisplay: { ...side, anchor: { x: .5, y: 0 } } } };
  const onExtent = vi.fn();
  const { rerender } = render(<GarmentDisplay item={item} onExtent={onExtent} view="front" />);
  const extent = onExtent.mock.calls.at(-1)?.[0] as number;
  expect(extent).toBeGreaterThan(230);
  expect(onExtent.mock.calls.at(-1)?.[1]).toEqual({ left: -80, right: 80 });
  rerender(<GarmentDisplay item={item} onExtent={onExtent} view="side" />);
  expect(onExtent.mock.calls.at(-1)?.[0]).toBe(extent);
});

it("reserves a wide shelf's complete metal support below an item mounted on its surface", () => {
  const nativeStyle = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => {
    const value = nativeStyle(element);
    return new Proxy(value, { get(target, key) {
      if (key === "width" && element.hasAttribute("data-garment")) return "400px";
      if (key === "top" && element.hasAttribute("data-hardware-frame")) return "200px";
      const result = Reflect.get(target, key); return typeof result === "function" ? result.bind(target) : result;
    } });
  });
  const onExtent = vi.fn();
  render(<GarmentDisplay item={{ name: "宽托架鞋", category: "shoes", display: "shelf", anchor: { x: .5, y: .9 }, url: "/shoe.png",
    imageBounds: { width: 1000, height: 1000, x: 0, y: 100, contentWidth: 1000, contentHeight: 800 }, presentation: { supportWidthRatio: 1.2 } }} onExtent={onExtent} large />);
  // The garment ends at the shelf surface (SVG y48); the complete support is lower.
  const hardwareWidth = 400 * 1.2 * 140 / 130;
  expect(onExtent.mock.calls.at(-1)?.[0]).toBeCloseTo(200 + hardwareWidth * 84 / 140);
  expect(onExtent.mock.calls.at(-1)?.[0]).toBeGreaterThan(200 + hardwareWidth * (63 + 8) / 140);
});
