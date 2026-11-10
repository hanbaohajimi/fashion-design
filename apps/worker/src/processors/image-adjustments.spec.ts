import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { adjustImageRgba, imageAdjustmentsSchema, imageAdjustmentMatrix, imageTransformSchema, originalImageAdjustments } from "@fashion/shared";
import { transformImage } from "./transform-image";

describe("图片明暗与色彩的确定性像素", () => {
  it.each([
    { setting: { brightness: 20 }, expected: [120, 180, 240, 64] },
    { setting: { contrast: -100 }, expected: [128, 128, 128, 64] },
    { setting: { saturation: -100 }, expected: [143, 143, 143, 64] },
    { setting: { warmth: 100 }, expected: [115, 150, 170, 64] },
    { setting: { brightness: -100 }, expected: [0, 0, 0, 64] },
    { setting: { brightness: 100, contrast: 100 }, expected: [255, 255, 255, 64] },
  ])("$setting 保留透明度并产生预期色值", ({ setting, expected }) => {
    const pixels = new Uint8Array([100, 150, 200, 64, 9, 21, 80, 0]);
    adjustImageRgba(pixels, { ...originalImageAdjustments, ...setting });
    expect([...pixels]).toEqual([...expected, 9, 21, 80, 0]);
  });
  it("零值不改变原始像素，旧变换请求不增加颜色参数", () => {
    const pixels = new Uint8Array([12, 127, 254, 19]);
    expect(adjustImageRgba(pixels, { ...originalImageAdjustments })).toEqual(new Uint8Array([12, 127, 254, 19]));
    expect(imageAdjustmentMatrix({ ...originalImageAdjustments })).toEqual([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
    expect(imageTransformSchema.parse({ width: 64, height: 96 })).not.toHaveProperty("adjustments");
  });
  it("极端冷暖不会给黑色加上彩色亮度，亮度最低仍为黑色", () => {
    for (const warmth of [-100, 100]) {
      expect([...adjustImageRgba(new Uint8Array([0, 0, 0, 255]), { ...originalImageAdjustments, warmth })]).toEqual([0, 0, 0, 255]);
      expect([...adjustImageRgba(new Uint8Array([100, 150, 200, 128]), { ...originalImageAdjustments, brightness: -100, warmth })]).toEqual([0, 0, 0, 128]);
    }
  });
  it.each([{ brightness: 101 }, { contrast: -101 }, { saturation: NaN }, { warmth: "20" }, { unknown: 1 }])("拒绝无效参数 %j", value => {
    expect(imageAdjustmentsSchema.safeParse(value).success).toBe(false);
    expect(imageTransformSchema.safeParse({ width: 64, height: 96, adjustments: value }).success).toBe(false);
  });
  it("实际保存依次应用方向与色彩，半透明 PNG 不改变来源字节", async () => {
    const pixels = Buffer.alloc(32 * 16 * 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) pixels.set(x < 16 ? [255, 0, 0, 255] : [0, 255, 0, 64], (y * 32 + x) * 4);
    const source = await sharp(pixels, { raw: { width: 32, height: 16, channels: 4 } }).png().toBuffer();
    const original = Buffer.from(source);
    const result = await transformImage(source, { width: 16, height: 32, rotate: 90, prompt: "明暗", adjustments: { ...originalImageAdjustments, saturation: -100 } });
    expect(await sharp(result).metadata()).toMatchObject({ width: 16, height: 32, format: "png", hasAlpha: true });
    const raw = await sharp(result).raw().toBuffer();
    expect([...raw.subarray(0, 4)]).toEqual([54, 54, 54, 255]);
    expect([...raw.subarray(-4)]).toEqual([182, 182, 182, 64]);
    expect(source).toEqual(original);
  });
});
