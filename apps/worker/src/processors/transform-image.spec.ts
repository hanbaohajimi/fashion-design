import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { imageTransformSchema, rotatedImageSize } from "@fashion/shared";
import { transformImage } from "./transform-image";

const colors = {
  red: [255, 0, 0, 255],
  green: [0, 255, 0, 255],
  blue: [0, 0, 255, 255],
  translucent: [0, 255, 255, 64],
};
type Color = keyof typeof colors;
async function sourceImage(orientation?: number) {
  const width = 64;
  const height = 96;
  const bytes = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color =
        y < height / 2
          ? x < width / 2
            ? colors.red
            : colors.green
          : x < width / 2
            ? colors.blue
            : colors.translucent;
      bytes.set(color, (y * width + x) * 4);
    }
  }
  const pipeline = sharp(bytes, { raw: { width, height, channels: 4 } });
  return (orientation ? pipeline.withMetadata({ orientation }) : pipeline)
    .png()
    .toBuffer();
}
async function corners(png: Buffer) {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [
    [2, 2],
    [info.width - 3, 2],
    [2, info.height - 3],
    [info.width - 3, info.height - 3],
  ].map(([x = 0, y = 0]) =>
    Array.from(
      data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4),
    ),
  );
}

describe("图片变换的实际像素", () => {
  it.each<{
    rotate: number;
    flipHorizontal?: boolean;
    flipVertical?: boolean;
    expected: Color[];
  }>([
    { rotate: 0, expected: ["red", "green", "blue", "translucent"] },
    { rotate: 90, expected: ["blue", "red", "translucent", "green"] },
    { rotate: -90, expected: ["green", "translucent", "red", "blue"] },
    { rotate: 180, expected: ["translucent", "blue", "green", "red"] },
    {
      rotate: 90,
      flipHorizontal: true,
      expected: ["red", "blue", "green", "translucent"],
    },
    {
      rotate: 90,
      flipVertical: true,
      expected: ["translucent", "green", "blue", "red"],
    },
    {
      rotate: 90,
      flipHorizontal: true,
      flipVertical: true,
      expected: ["green", "translucent", "red", "blue"],
    },
  ])(
    "旋转 $rotate 度并镜像 $flipHorizontal / $flipVertical",
    async ({ expected, ...operation }) => {
      const size = rotatedImageSize(64, 96, operation.rotate);
      const png = await transformImage(await sourceImage(), {
        ...size,
        ...operation,
        prompt: "调整方向",
      });
      expect(await sharp(png).metadata()).toMatchObject({
        ...size,
        format: "png",
        hasAlpha: true,
      });
      expect(await corners(png)).toEqual(
        expected.map((color) => colors[color]),
      );
    },
  );

  it("旧尺寸参数继续缩放，不改变像素方向和半透明区域", async () => {
    const params = imageTransformSchema.parse({ width: 32, height: 48 });
    expect(params).toEqual({ width: 32, height: 48, prompt: "调整图片尺寸" });
    expect(
      await corners(await transformImage(await sourceImage(), params)),
    ).toEqual([colors.red, colors.green, colors.blue, colors.translucent]);
  });

  it("按原图坐标裁剪，再旋转，最后缩放", async () => {
    const png = await transformImage(await sourceImage(), {
      prompt: "裁剪后旋转",
      width: 48,
      height: 16,
      rotate: 90,
      crop: { left: 32, top: 0, width: 32, height: 96 },
    });
    expect(await corners(png)).toEqual([
      colors.translucent,
      colors.green,
      colors.translucent,
      colors.green,
    ]);
  });

  it.each([17, -35.5, 45, 179.9])(
    "自定义 %s 度保留完整边界并以透明像素补边",
    async (rotate) => {
      const size = rotatedImageSize(64, 96, rotate);
      const png = await transformImage(await sourceImage(), {
        ...size,
        prompt: "旋转",
        rotate,
      });
      const native = await sharp(await sourceImage())
        .rotate(rotate)
        .toBuffer({ resolveWithObject: true });
      expect(native.info).toMatchObject(size);
      expect(await sharp(png).metadata()).toMatchObject({
        ...size,
        hasAlpha: true,
      });
      if (Math.abs(rotate) < 170)
        expect((await corners(png)).map((pixel) => pixel[3])).toEqual([
          0, 0, 0, 0,
        ]);
    },
  );

  it("照片先按 EXIF 方向摆正，再应用用户旋转并移除方向标签", async () => {
    const png = await transformImage(await sourceImage(6), {
      width: 64,
      height: 96,
      rotate: 90,
      prompt: "旋转",
    });
    expect(await corners(png)).toEqual([
      colors.translucent,
      colors.blue,
      colors.green,
      colors.red,
    ]);
    expect((await sharp(png).metadata()).orientation).toBeUndefined();
  });

  it("带 EXIF 的图片使用正向原图的裁剪坐标", async () => {
    const png = await transformImage(await sourceImage(6), {
      width: 32,
      height: 32,
      rotate: 90,
      prompt: "裁剪",
      crop: { left: 0, top: 0, width: 32, height: 32 },
    });
    expect(await corners(png)).toEqual([
      colors.blue,
      colors.blue,
      colors.blue,
      colors.blue,
    ]);
  });

  it("非法参数、损坏图片和越界裁剪不产生结果", async () => {
    for (const value of [
      { rotate: 181 },
      { rotate: NaN },
      { flipHorizontal: "true" },
      { width: 8193 },
      { width: 8000, height: 8000 },
      { unknown: 1 },
    ]) {
      expect(
        imageTransformSchema.safeParse({ width: 64, height: 96, ...value })
          .success,
      ).toBe(false);
    }
    await expect(
      transformImage(Buffer.from("broken"), {
        width: 64,
        height: 96,
        prompt: "旋转",
      }),
    ).rejects.toThrow();
    await expect(
      transformImage(await sourceImage(), {
        width: 64,
        height: 96,
        prompt: "裁剪",
        crop: { left: 60, top: 0, width: 64, height: 96 },
      }),
    ).rejects.toThrow();
  });
});
