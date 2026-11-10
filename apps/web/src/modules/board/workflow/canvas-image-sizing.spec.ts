import { describe, expect, it } from "vitest";
import type { ImageShape } from "../shapes/shape-types";
import { canvasImageFitBounds, initialCanvasImageSize, readCanvasImageDimensions } from "./canvas-image-sizing";

describe("画布图片比例", () => {
  it("新图片按原比例限制尺寸，小图片不自动放大", () => {
    for (const [width, height, w, h] of [[1200, 300, 320, 80], [300, 1200, 95, 380], [240, 2400, 38, 380], [40, 60, 40, 60]]) {
      expect(initialCanvasImageSize({ width, height })).toEqual({ w, h, imageWidth: width, imageHeight: height });
    }
  });

  it("标准宽高优先，兼容旧字段，不拼接来自不同字段对的宽高", () => {
    expect(initialCanvasImageSize({ width: 1200, height: 300, imageWidth: 300, imageHeight: 1200 }).h).toBe(80);
    expect(initialCanvasImageSize({ imageWidth: 300, imageHeight: 1200 }).h).toBe(380);
    expect(initialCanvasImageSize({ width: 1200, imageHeight: 300 })).toEqual({ w: 320, h: 380, imageWidth: 0, imageHeight: 0 });
  });

  it("缺失、非数值、非像素尺寸与无穷值不用于布局", () => {
    for (const width of [undefined, null, "600", 0, -1, .5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(readCanvasImageDimensions(width, 600)).toBeNull();
      expect(initialCanvasImageSize({ width, height: 600 })).toEqual({ w: 320, h: 380, imageWidth: 0, imageHeight: 0 });
    }
  });

  it("匹配比例只去掉留白，保持旋转后的可见图像中心和尺度", () => {
    const shape = { x: 100, y: 200, rotation: Math.PI / 2,
      props: { w: 400, h: 400, url: "/wide.png", imageSource: "/wide.png", imageWidth: 1200, imageHeight: 300 } } as ImageShape;
    const fit = canvasImageFitBounds(shape);
    expect(fit?.x).toBeCloseTo(-50); expect(fit?.y).toBeCloseTo(200);
    expect(fit?.w).toBe(400); expect(fit?.h).toBe(100);
    const center = (x: number, y: number, w: number, h: number) => ({
      x: x + Math.cos(shape.rotation) * w / 2 - Math.sin(shape.rotation) * h / 2,
      y: y + Math.sin(shape.rotation) * w / 2 + Math.cos(shape.rotation) * h / 2,
    });
    if (!fit) throw new Error("应能匹配图片比例");
    expect(center(fit.x, fit.y, fit.w, fit.h)).toEqual(center(shape.x, shape.y, shape.props.w, shape.props.h));
  });

  it("不使用旧地址的尺寸，也不为已匹配的图片创建无效调整", () => {
    const shape = { x: 0, y: 0, rotation: 0,
      props: { w: 320, h: 80, url: "/new.png", imageSource: "/new.png", imageWidth: 1200, imageHeight: 300 } } as ImageShape;
    expect(canvasImageFitBounds(shape)).toBeNull();
    expect(canvasImageFitBounds({ ...shape, props: { ...shape.props, h: 380, imageSource: "/old.png" } })).toBeNull();
    expect(canvasImageFitBounds({ ...shape, props: { ...shape.props, h: 0 } })).toBeNull();
  });
});
