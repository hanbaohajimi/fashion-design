import { describe, expect, it } from "vitest";
import { creationOverlayLayout, emptyCreationPosition } from "./creation-layout";

describe("创作界面定位", () => {
  it("边缘素材的工具和输入框保持在手机可视范围", () => {
    for (const x of [-500, 0, 350, 1500]) {
      const layout = creationOverlayLayout({ x, y: 600, w: 400, h: 500 }, { w: 390, h: 844 });
      expect(layout.x).toBeGreaterThanOrEqual(20); expect(layout.x + layout.width).toBeLessThanOrEqual(370);
      expect(layout.composerY).toBeLessThan(650); expect(layout.compact).toBe(true);
    }
  });
  it("新增目标避开已有素材，不调整原来的布局", () => {
    const shapes = [{ x: 0, y: 0, w: 340, h: 440 }, { x: 420, y: 0, w: 340, h: 440 }];
    const before = structuredClone(shapes), result = emptyCreationPosition(shapes, { x: 0, y: 0 });
    expect(result.x).toBeGreaterThanOrEqual(800); expect(shapes).toEqual(before);
  });
});
