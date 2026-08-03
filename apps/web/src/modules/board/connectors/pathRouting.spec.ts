import { describe, expect, it } from "vitest";

import {
  computeArrowPath,
  computeBezierEndTangent,
  computeBezierPath,
  computeOrthogonalEndTangent,
  computeOrthogonalPath,
  computeRoundedPath,
} from "./pathRouting";
import type { AnchorPoint } from "./connector-types";

describe("pathRouting", () => {
  describe("computeBezierPath", () => {
    it("生成有效的 SVG 贝塞尔路径", () => {
      const source: AnchorPoint = {
        x: 0,
        y: 0,
        normal: { x: 1, y: 0 }, // 向右
      };

      const target: AnchorPoint = {
        x: 100,
        y: 0,
        normal: { x: -1, y: 0 }, // 向左
      };

      const path = computeBezierPath(source, target);

      // 检查路径格式
      expect(path).toMatch(/^M\s[\d.]+\s[\d.]+\sC\s[\d.]+\s[\d.]+,\s[\d.]+\s[\d.]+,\s[\d.]+\s[\d.]+$/);

      // 检查起点
      expect(path).toContain("M 0 0");

      // 检查终点
      expect(path).toContain("100 0");
    });

    it("控制点距离应该在 48 到 180 之间", () => {
      const source: AnchorPoint = {
        x: 0,
        y: 0,
        normal: { x: 1, y: 0 },
      };

      const target: AnchorPoint = {
        x: 1000,
        y: 0,
        normal: { x: -1, y: 0 },
      };

      const path = computeBezierPath(source, target);

      // 提取控制点
      const match = path.match(/C\s([\d.]+)\s([\d.]+),\s([\d.]+)\s([\d.]+)/);
      expect(match).not.toBeNull();

      if (!match) return;

      const c1x = Number(match[1]);
      const c1y = Number(match[2]);

      // 控制点 C1 应该在源点的法线方向上
      const distance = Math.hypot(c1x - source.x, c1y - source.y);

      // 距离 = clamp(1000 * 0.35, 48, 180) = 180
      expect(distance).toBe(180);
    });

    it("短距离时控制点不小于最小值", () => {
      const source: AnchorPoint = {
        x: 0,
        y: 0,
        normal: { x: 1, y: 0 },
      };

      const target: AnchorPoint = {
        x: 50,
        y: 0,
        normal: { x: -1, y: 0 },
      };

      const path = computeBezierPath(source, target);
      const match = path.match(/C\s([\d.]+)\s([\d.]+),\s([\d.]+)\s([\d.]+)/);
      expect(match).not.toBeNull();

      if (!match) return;

      const c1x = Number(match[1]);
      const distance = c1x - source.x;

      // 距离 = clamp(50 * 0.35, 48, 180) = 48
      expect(distance).toBe(48);
    });
  });

  describe("computeOrthogonalPath", () => {
    it("生成有效的正交路径", () => {
      const source: AnchorPoint = {
        x: 0,
        y: 0,
        normal: { x: 1, y: 0 }, // 向右
      };

      const target: AnchorPoint = {
        x: 100,
        y: 100,
        normal: { x: -1, y: 0 }, // 向左
      };

      const path = computeOrthogonalPath(source, target);

      // 应该包含 M 和多个 L 命令
      expect(path).toMatch(/^M\s[\d.\s]+L[\d.\sL]+$/);
      expect(path).toContain("M 0 0");
      expect(path).toContain("100 100");
    });

    it("水平距离大于垂直距离时应该水平优先", () => {
      const source: AnchorPoint = {
        x: 0,
        y: 50,
        normal: { x: 1, y: 0 },
      };

      const target: AnchorPoint = {
        x: 200,
        y: 60,
        normal: { x: -1, y: 0 },
      };

      const path = computeOrthogonalPath(source, target);

      // 路径应该包含水平和垂直线段
      expect(path).toContain("L");
      expect(path.split("L").length).toBeGreaterThan(3); // 至少 4 个线段
    });
  });

  describe("computeRoundedPath", () => {
    it("生成带圆角的正交路径", () => {
      const source: AnchorPoint = {
        x: 0,
        y: 0,
        normal: { x: 1, y: 0 },
      };

      const target: AnchorPoint = {
        x: 100,
        y: 100,
        normal: { x: -1, y: 0 },
      };

      const path = computeRoundedPath(source, target, 8);

      // 应该包含 Q 命令（二次贝塞尔用于圆角）
      expect(path).toContain("Q");
      expect(path).toContain("M 0 0");
      expect(path).toContain("100 100");
    });
  });

  describe("computeArrowPath", () => {
    it("生成闭合的三角形路径", () => {
      const point = { x: 100, y: 100 };
      const tangent = { x: 1, y: 0 }; // 向右

      const path = computeArrowPath(point, tangent, 7);

      // 应该是闭合路径
      expect(path).toMatch(/^M\s[\d.]+\s[\d.]+\sL\s[\d.]+\s[\d.]+\sL\s[\d.]+\s[\d.]+\sZ$/);
      expect(path).toContain("M 100 100");
      expect(path).toContain("Z"); // 闭合
    });

    it("箭头应该指向切线方向", () => {
      const point = { x: 0, y: 0 };
      const tangent = { x: 1, y: 0 }; // 向右

      const path = computeArrowPath(point, tangent, 10);

      // 提取箭头的两个侧点
      const matches = path.matchAll(/L\s([\d.-]+)\s([\d.-]+)/g);
      const points = Array.from(matches).map((m) => ({
        x: Number(m[1]),
        y: Number(m[2]),
      }));

      expect(points.length).toBe(2);
      const [firstPoint, secondPoint] = points;
      if (!firstPoint || !secondPoint) return;

      // 两个侧点应该在箭头尖端的左侧（x < 0）
      expect(firstPoint.x).toBeLessThan(0);
      expect(secondPoint.x).toBeLessThan(0);

      // 一个在上方，一个在下方
      expect(firstPoint.y * secondPoint.y).toBeLessThan(0);
    });
  });

  describe("computeBezierEndTangent", () => {
    it("返回单位切线向量", () => {
      const target: AnchorPoint = {
        x: 100,
        y: 100,
        normal: { x: -1, y: 0 },
      };

      const distance = 100;

      const tangent = computeBezierEndTangent(target, distance);

      // 应该是单位向量
      const length = Math.hypot(tangent.x, tangent.y);
      expect(length).toBeCloseTo(1, 5);
    });

    it("切线方向应该从控制点指向终点", () => {
      const target: AnchorPoint = {
        x: 100,
        y: 100,
        normal: { x: -1, y: 0 }, // 向左
      };

      const distance = 100;

      const tangent = computeBezierEndTangent(target, distance);

      // 由于法线向左，控制点在左侧，切线应该向右（正 x 方向）
      expect(tangent.x).toBeGreaterThan(0);
    });
  });

  describe("computeOrthogonalEndTangent", () => {
    it("返回目标法线的反方向", () => {
      const source: AnchorPoint = {
        x: 0,
        y: 0,
        normal: { x: 1, y: 0 },
      };

      const target: AnchorPoint = {
        x: 100,
        y: 100,
        normal: { x: -1, y: 0 }, // 向左
      };

      const tangent = computeOrthogonalEndTangent(source, target);

      // 应该是向右（法线反方向）
      expect(tangent.x).toBe(1);
      expect(tangent.y).toBeCloseTo(0, 5);
    });

    it("垂直法线的反方向", () => {
      const source: AnchorPoint = {
        x: 0,
        y: 0,
        normal: { x: 0, y: 1 },
      };

      const target: AnchorPoint = {
        x: 100,
        y: 100,
        normal: { x: 0, y: -1 }, // 向上
      };

      const tangent = computeOrthogonalEndTangent(source, target);

      // 应该是向下
      expect(tangent.x).toBeCloseTo(0, 5);
      expect(tangent.y).toBe(1);
    });
  });
});
