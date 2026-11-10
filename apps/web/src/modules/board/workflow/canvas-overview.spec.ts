import { describe, expect, it } from "vitest";
import type { Editor } from "tldraw";
import { overviewBounds, overviewContains, overviewPoint, readOverviewShapes } from "./canvas-overview";

describe("画布总览坐标", () => {
  it("同时容纳作品与当前视野，保持小地图比例与边距", () => {
    const bounds = overviewBounds({ x: -100, y: -200, w: 400, h: 100 }, { x: 200, y: 100, w: 600, h: 400 }, 280, 160);
    expect(bounds.w / bounds.h).toBeCloseTo(280 / 160);
    expect(bounds.x).toBeLessThan(-100); expect(bounds.y).toBeLessThan(-200);
    expect(bounds.x + bounds.w).toBeGreaterThan(800); expect(bounds.y + bounds.h).toBeGreaterThan(500);
  });

  it("点击按绘制范围转换，拖出边界仍限制在总览范围", () => {
    const bounds = { x: -600, y: -300, w: 1200, h: 600 };
    const screen = { left: 20, top: 40, width: 240, height: 120 };
    expect(overviewPoint({ x: 140, y: 100 }, screen, bounds)).toEqual({ x: 0, y: 0 });
    expect(overviewPoint({ x: -1000, y: 900 }, screen, bounds)).toEqual({ x: -600, y: 300 });
    expect(overviewContains(bounds, { x: 600, y: 300 })).toBe(true);
    expect(overviewContains(bounds, { x: 601, y: 300 })).toBe(false);
  });

  it("空白或异常尺寸有稳定的有限范围", () => {
    for (const viewport of [{ x: 0, y: 0, w: 0, h: 0 }, { x: NaN, y: 0, w: 100, h: 100 }]) {
      const bounds = overviewBounds(null, viewport, 0, 0);
      expect(Object.values(bounds).every(Number.isFinite)).toBe(true);
      expect(bounds.w).toBeGreaterThan(0); expect(bounds.h).toBeGreaterThan(0);
    }
  });

  it("使用可见且经过画框裁切的内容，排除分组和隐藏后代", () => {
    const shapes = [{ id: "visible", type: "fashion-image" }, { id: "hidden", type: "fashion-image" }, { id: "group", type: "group" }, { id: "bad", type: "geo" }];
    const editor = {
      getCurrentPageShapes: () => shapes,
      isShapeHidden: (shape: { id: string }) => shape.id === "hidden",
      getShapeMaskedPageBounds: (id: string) => id === "bad" ? { x: NaN, y: 0, w: 10, h: 10 } : { x: -30, y: 40, w: 160, h: 90 },
    } as unknown as Editor;
    expect(readOverviewShapes(editor)).toEqual([{ id: "visible", x: -30, y: 40, w: 160, h: 90 }]);
  });
});
