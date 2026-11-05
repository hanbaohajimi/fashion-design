import { describe, expect, it } from "vitest";
import sharp from "sharp";
import type { WardrobeCategory } from "@fashion/shared";
import {
  assertTransparentGarment,
  composeOutfitReference,
  cropWardrobeImage,
  readWardrobeImage,
  createCorrectionSelectionGuide,
} from "./wardrobe-media";

describe("单品真实像素处理", () => {
  it("位置guide同画布仅将有效内区按45%编辑权重叠品红，保留边缘/alpha/输入", async () => {
    const source = Buffer.alloc(11 * 11 * 4);
    const mask = Buffer.alloc(source.length, 255);
    for (let y = 1; y < 10; y++)
      for (let x = 1; x < 10; x++)
        source.set([40, 80, 120, 250], (y * 11 + x) * 4);
    mask[(5 * 11 + 5) * 4 + 3] = 0;
    mask[(5 * 11 + 6) * 4 + 3] = 128;
    mask[(5 * 11 + 1) * 4 + 3] = 0;
    const png = (data: Buffer) =>
      sharp(data, { raw: { width: 11, height: 11, channels: 4 } })
        .png()
        .toBuffer();
    const [sourcePng, maskPng] = await Promise.all([png(source), png(mask)]);
    const before = Buffer.from(sourcePng);
    const guide = await createCorrectionSelectionGuide(sourcePng, maskPng);
    const result = await sharp(guide.bytes).raw().toBuffer();
    expect([
      ...result.subarray((5 * 11 + 5) * 4, (5 * 11 + 5) * 4 + 4),
    ]).toEqual([137, 44, 181, 250]);
    const weight = 0.45 * (1 - 128 / 255);
    expect(result[(5 * 11 + 6) * 4]).toBe(
      Math.round(40 * (1 - weight) + 255 * weight),
    );
    for (let pixel = 0; pixel < 121; pixel++) {
      expect(result[pixel * 4 + 3]).toBe(source[pixel * 4 + 3]);
      if (![60, 61].includes(pixel))
        expect(result.subarray(pixel * 4, pixel * 4 + 4)).toEqual(
          source.subarray(pixel * 4, pixel * 4 + 4),
        );
    }
    expect(sourcePng).toEqual(before);
    expect(
      (await createCorrectionSelectionGuide(sourcePng, maskPng)).bytes,
    ).toEqual(guide.bytes);
    expect(guide).toMatchObject({
      algorithm: "masked-interior-magenta-guide-v1",
      opacity: 0.45,
      color: "#ff00ff",
    });
  });
  it("拒绝不透明和全透明假结果，接受保留主体的透明素材", async () => {
    const opaque = await sharp({
      create: { width: 40, height: 40, channels: 4, background: "red" },
    })
      .png()
      .toBuffer();
    const empty = await sharp({
      create: {
        width: 40,
        height: 40,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    await expect(assertTransparentGarment(opaque)).rejects.toThrow("透明");
    await expect(assertTransparentGarment(empty)).rejects.toThrow("透明");
    const garment = await sharp(empty)
      .composite([
        {
          input: await sharp(opaque).resize(20, 20).png().toBuffer(),
          left: 10,
          top: 10,
        },
      ])
      .png()
      .toBuffer();
    await expect(assertTransparentGarment(garment)).resolves.toEqual({
      width: 40,
      height: 40,
      x: 10,
      y: 10,
      contentWidth: 20,
      contentHeight: 20,
    });
  });
  it("按原图像素返回非对称透明留白中的主体边界，忽略 alpha 不超过16的残影", async () => {
    const width = 100;
    const height = 80;
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 14; y < 54; y++) {
      for (let x = 27; x < 58; x++) {
        pixels[(y * width + x) * 4] = 180;
        pixels[(y * width + x) * 4 + 3] = 255;
      }
    }
    pixels[3] = 16;
    pixels[(9 * width + 18) * 4 + 3] = 17;
    pixels[pixels.length - 1] = 1;
    const image = await sharp(pixels, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    const original = Buffer.from(image);
    expect(await assertTransparentGarment(image)).toEqual({
      width: 100,
      height: 80,
      x: 18,
      y: 9,
      contentWidth: 40,
      contentHeight: 45,
    });
    expect(image.equals(original)).toBe(true);
  });
  it("拒绝只有近乎透明像素而没有可见主体的候选", async () => {
    const pixels = Buffer.alloc(8 * 6 * 4);
    pixels[(3 * 8 + 2) * 4 + 3] = 16;
    const image = await sharp(pixels, {
      raw: { width: 8, height: 6, channels: 4 },
    })
      .png()
      .toBuffer();
    await expect(assertTransparentGarment(image)).rejects.toThrow("主体");
  });
  it("框选实际裁剪像素，参考拼图不改变输入图", async () => {
    const source = await sharp({
      create: { width: 100, height: 80, channels: 4, background: "green" },
    })
      .png()
      .toBuffer();
    const before = Buffer.from(source);
    const crop = await cropWardrobeImage(source, {
      x: 0.2,
      y: 0.25,
      width: 0.5,
      height: 0.5,
    });
    expect(await sharp(crop).metadata()).toMatchObject({
      width: 50,
      height: 40,
    });
    const inputs = Array.from({ length: 5 }, (_, layer) => ({
      bytes: crop,
      category: "top" as const,
      layer,
    }));
    const sheet = await composeOutfitReference(inputs);
    expect(await sharp(sheet).metadata()).toMatchObject({
      width: 1280,
      height: 640,
    });
    expect(source.equals(before)).toBe(true);
    expect(sheet.equals(await composeOutfitReference(inputs))).toBe(true);
  });
  it("混合部位不依赖选入顺序，上下装和鞋按部位排列，内搭外套保持独立", async () => {
    const categories: WardrobeCategory[] = [
      "shoes",
      "outerwear",
      "bag",
      "bottom",
      "hat",
      "onepiece",
      "scarf",
      "belt",
      "accessory",
      "top",
    ];
    const inputs = await Promise.all(
      categories.map(async (category, index) => ({
        category,
        layer: category === "top" ? 0 : index + 1,
        bytes: await sharp({
          create: {
            width: 40,
            height: 80,
            channels: 4,
            background: { r: 30 + index * 20, g: 70, b: 110 },
          },
        })
          .png()
          .toBuffer(),
      })),
    );
    const before = inputs.map((item) => Buffer.from(item.bytes));
    const sheet = await composeOutfitReference(inputs);
    const { data, info } = await sharp(sheet)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const boxes = new Map<
      WardrobeCategory,
      { left: number; top: number; right: number; bottom: number }
    >();
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++) {
        const offset = (y * info.width + x) * info.channels;
        if (data[offset + 1] !== 70 || data[offset + 2] !== 110) continue;
        const index = ((data[offset] ?? 0) - 30) / 20;
        const category = Number.isInteger(index)
          ? categories[index]
          : undefined;
        if (!category) continue;
        const box = boxes.get(category) ?? {
          left: x,
          top: y,
          right: x,
          bottom: y,
        };
        box.right = Math.max(box.right, x);
        box.bottom = Math.max(box.bottom, y);
        box.left = Math.min(box.left, x);
        box.top = Math.min(box.top, y);
        boxes.set(category, box);
      }
    expect(boxes.size).toBe(10);
    const box = (category: WardrobeCategory) => {
      const result = boxes.get(category);
      if (!result) throw new Error(`Missing rendered category: ${category}`);
      return result;
    };
    expect(box("hat").bottom).toBeLessThan(box("top").top);
    expect(box("scarf").bottom).toBeLessThan(box("top").top);
    expect(box("top").top).toBe(box("outerwear").top);
    expect(box("top").right).toBeLessThan(box("outerwear").left);
    expect(box("outerwear").bottom).toBeLessThan(box("onepiece").top);
    expect(box("onepiece").bottom).toBeLessThan(box("bottom").top);
    expect(box("bottom").top).toBe(box("belt").top);
    expect(box("bottom").bottom).toBeLessThan(box("shoes").top);
    expect(box("shoes").bottom).toBeLessThan(box("bag").top);
    expect(box("bag").top).toBe(box("accessory").top);
    for (const value of boxes.values())
      expect(
        (value.right - value.left + 1) / (value.bottom - value.top + 1),
      ).toBeCloseTo(0.5, 2);
    expect(inputs.map((item) => item.bytes)).toEqual(before);
    expect(sheet.length).toBeLessThan(5 * 1024 * 1024);
  });
  it("参考图拒绝空搭配和超过12件的输入", async () => {
    await expect(composeOutfitReference([])).rejects.toThrow("1 至 12");
    await expect(
      composeOutfitReference(
        Array.from({ length: 13 }, () => ({
          bytes: Buffer.alloc(0),
          category: "top" as const,
          layer: 0,
        })),
      ),
    ).rejects.toThrow("1 至 12");
  });
  it("不从任意远程URL抓取素材", async () => {
    await expect(
      readWardrobeImage({} as never, "https://example.com/image.png"),
    ).rejects.toThrow("私有存储");
  });
});
