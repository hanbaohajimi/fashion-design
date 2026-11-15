import { describe, expect, it } from "vitest";
import { imageContentBounds, isThumbnailUrl } from "./image-presentation";

describe("统一图片展示", () => {
  it("在旧摆放中等比显示完整图片，并保留原来的中心", () => {
    const bounds = imageContentBounds(340, 260, 600, 800);
    expect(bounds).toEqual({ x: 72.5, y: 0, w: 195, h: 260 });
    expect(bounds.x + bounds.w / 2).toBe(170); expect(bounds.y + bounds.h / 2).toBe(130);
  });
  it("不把缩略图的尺寸冒充原始文件尺寸", () => {
    expect(isThumbnailUrl("/api/design-assets/id/thumbnail")).toBe(true);
    expect(isThumbnailUrl("/api/files/id/thumbnail/1024")).toBe(true);
    expect(isThumbnailUrl("/api/design-assets/id/content")).toBe(false);
  });
});
