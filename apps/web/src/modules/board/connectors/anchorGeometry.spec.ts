import { describe, expect, it } from "vitest";

import {
  autoSelectAnchors,
  computeAnchorPoints,
  getShapeCenter,
} from "./anchorGeometry";
import type { Editor, TLShape } from "tldraw";

describe("anchorGeometry", () => {
  describe("autoSelectAnchors", () => {
    it("选择水平锚点当 dx >= dy", () => {
      const source = { x: 0, y: 0 };
      const target = { x: 100, y: 30 };
      const [sourceAnchor, targetAnchor] = autoSelectAnchors(source, target);
      expect(sourceAnchor).toBe("right");
      expect(targetAnchor).toBe("left");
    });

    it("选择水平锚点当 dx 为负且绝对值大于 dy", () => {
      const source = { x: 100, y: 0 };
      const target = { x: 0, y: 30 };
      const [sourceAnchor, targetAnchor] = autoSelectAnchors(source, target);
      expect(sourceAnchor).toBe("left");
      expect(targetAnchor).toBe("right");
    });

    it("选择垂直锚点当 dy > dx", () => {
      const source = { x: 0, y: 0 };
      const target = { x: 30, y: 100 };
      const [sourceAnchor, targetAnchor] = autoSelectAnchors(source, target);
      expect(sourceAnchor).toBe("bottom");
      expect(targetAnchor).toBe("top");
    });

    it("选择垂直锚点当 dy 为负且绝对值大于 dx", () => {
      const source = { x: 0, y: 100 };
      const target = { x: 30, y: 0 };
      const [sourceAnchor, targetAnchor] = autoSelectAnchors(source, target);
      expect(sourceAnchor).toBe("top");
      expect(targetAnchor).toBe("bottom");
    });

    it("在 45 度角时选择水平锚点（dx === dy 情况）", () => {
      const source = { x: 0, y: 0 };
      const target = { x: 100, y: 100 };
      const [sourceAnchor, targetAnchor] = autoSelectAnchors(source, target);
      // abs(dx) >= abs(dy) 时选择水平
      expect(sourceAnchor).toBe("right");
      expect(targetAnchor).toBe("left");
    });
  });

  describe("computeAnchorPoints", () => {
    it("返回 null 当 shape bounds 不存在", () => {
      const mockEditor = {
        getShapePageBounds: () => null,
      } as unknown as Editor;

      const mockShape = { id: "shape:1" } as TLShape;

      const result = computeAnchorPoints(mockEditor, mockShape);
      expect(result).toBeNull();
    });

    it("计算正确的锚点位置和法线方向", () => {
      const mockEditor = {
        getShapePageBounds: () => ({
          x: 100,
          y: 200,
          w: 100,
          h: 80,
        }),
      } as unknown as Editor;

      const mockShape = { id: "shape:1" } as TLShape;

      const anchors = computeAnchorPoints(mockEditor, mockShape);
      expect(anchors).not.toBeNull();

      if (!anchors) return;

      // 中心点应该在 (150, 240)
      const cx = 150;
      const cy = 240;

      // 顶部锚点：(cx, 200)
      expect(anchors.top.x).toBe(cx);
      expect(anchors.top.y).toBe(200);
      expect(anchors.top.normal.x).toBeCloseTo(0, 5);
      expect(anchors.top.normal.y).toBeLessThan(0); // 向上

      // 右侧锚点：(200, cy)
      expect(anchors.right.x).toBe(200);
      expect(anchors.right.y).toBe(cy);
      expect(anchors.right.normal.x).toBeGreaterThan(0); // 向右
      expect(anchors.right.normal.y).toBeCloseTo(0, 5);

      // 底部锚点：(cx, 280)
      expect(anchors.bottom.x).toBe(cx);
      expect(anchors.bottom.y).toBe(280);
      expect(anchors.bottom.normal.x).toBeCloseTo(0, 5);
      expect(anchors.bottom.normal.y).toBeGreaterThan(0); // 向下

      // 左侧锚点：(100, cy)
      expect(anchors.left.x).toBe(100);
      expect(anchors.left.y).toBe(cy);
      expect(anchors.left.normal.x).toBeLessThan(0); // 向左
      expect(anchors.left.normal.y).toBeCloseTo(0, 5);
    });

    it("法线向量应该是单位向量", () => {
      const mockEditor = {
        getShapePageBounds: () => ({
          x: 0,
          y: 0,
          w: 100,
          h: 100,
        }),
      } as unknown as Editor;

      const mockShape = { id: "shape:1" } as TLShape;

      const anchors = computeAnchorPoints(mockEditor, mockShape);
      expect(anchors).not.toBeNull();

      if (!anchors) return;

      // 检查所有法线向量的长度接近 1
      const checkUnitVector = (normal: { x: number; y: number }) => {
        const length = Math.hypot(normal.x, normal.y);
        expect(length).toBeCloseTo(1, 5);
      };

      checkUnitVector(anchors.top.normal);
      checkUnitVector(anchors.right.normal);
      checkUnitVector(anchors.bottom.normal);
      checkUnitVector(anchors.left.normal);
    });
  });

  describe("getShapeCenter", () => {
    it("返回 null 当 bounds 不存在", () => {
      const mockEditor = {
        getShapePageBounds: () => null,
      } as unknown as Editor;

      const mockShape = { id: "shape:1" } as TLShape;

      const result = getShapeCenter(mockEditor, mockShape);
      expect(result).toBeNull();
    });

    it("计算正确的中心点", () => {
      const mockEditor = {
        getShapePageBounds: () => ({
          x: 100,
          y: 200,
          w: 80,
          h: 60,
        }),
      } as unknown as Editor;

      const mockShape = { id: "shape:1" } as TLShape;

      const center = getShapeCenter(mockEditor, mockShape);
      expect(center).not.toBeNull();

      if (!center) return;

      expect(center.x).toBe(140); // 100 + 80/2
      expect(center.y).toBe(230); // 200 + 60/2
    });
  });
});
