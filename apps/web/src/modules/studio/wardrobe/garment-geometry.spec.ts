import { describe, expect, it } from "vitest";
import type { WardrobeRevisionView } from "@fashion/shared";
import { garmentGeometry, getShelfDepthRatio, packRackItems, rackSlotWidth } from "./garment-geometry";

const top = { category: "top", display: "hanger" } as const;
const shelf = { category: "shoes", display: "shelf", imageBounds: { width: 1024, height: 1536, x: 42, y: 278, contentWidth: 940, contentHeight: 958 }, presentation: {
  supportWidthRatio: 1.04,
  sideDisplay: { reviewed: true, assetId: "side", url: "/original-side.png", imageBounds: { width: 1024, height: 1536, x: 0, y: 399, contentWidth: 1023, contentHeight: 799 }, anchor: { x: .5, y: 1198 / 1536 }, orientation: "left", source: "generated", preparationId: "prepare" },
} } satisfies Pick<WardrobeRevisionView, "category" | "display" | "imageBounds" | "presentation">;

describe("real garment support and slot geometry", () => {
  it("preserves the old shelf defaults and only changes depth for explicitly calibrated objects", () => {
    expect(getShelfDepthRatio(shelf) * 140).toBeCloseTo(34);
    expect(getShelfDepthRatio({ category: "hat", display: "shelf" }) * 140).toBeCloseTo(18);
    expect(getShelfDepthRatio({ category: "accessory", display: "shelf" }) * 140).toBeCloseTo(24);
    const calibrated = { ...shelf, presentation: { ...shelf.presentation, shelfDepthRatio: 48 / 140 } };
    expect(getShelfDepthRatio(calibrated) * 140).toBeCloseTo(48);
    expect(garmentGeometry(calibrated)).toEqual(garmentGeometry(shelf));
    expect(rackSlotWidth(calibrated)).toBe(rackSlotWidth(shelf));
  });
  it("supports the wider confirmed view on a fixed shelf without changing either image ratio", () => {
    const mounted = garmentGeometry(shelf);
    const front = garmentGeometry({ ...shelf, presentation: { supportWidthRatio: 1.04 } });
    expect(mounted.width).toBe(front.width);
    expect(mounted.ratio).toBe(1024 / 1536);
    expect(mounted.sideRatio).toBe(1024 / 1536);
    const sideVisible = mounted.width * mounted.sideWidthRatio * 1023 / 1024;
    expect(mounted.width * mounted.hardwareRatio * 130 / 140).toBeCloseTo(sideVisible * 1.04);
    expect(rackSlotWidth(shelf)).toBeGreaterThan(sideVisible + 24);
  });
  it("keeps the clothing density while reserving the full width of broad accessories", () => {
    const clothes = Array.from({ length: 12 }, (_, id) => ({ id, currentRevision: top }));
    expect(packRackItems(clothes, Infinity, 10).map(page => page.length)).toEqual([10, 2]);
    expect(packRackItems(clothes, Infinity, 4).map(page => page.length)).toEqual([4, 4, 4]);
    expect(packRackItems([...clothes, { id: 12, currentRevision: shelf }], 650, 10).map(page => page.length)).toEqual([10, 3]);
    const mixed = [{ id: 0, currentRevision: top }, { id: 1, currentRevision: shelf }, { id: 2, currentRevision: shelf }];
    const pages = packRackItems(mixed, 315, 4);
    expect(pages.map(page => page.map(item => item.id))).toEqual([[0], [1], [2]]);
    expect(pages.flat()).toEqual(mixed);
    expect(packRackItems(mixed, 1, 4).map(page => page.length)).toEqual([1, 1, 1]);
  });
});
