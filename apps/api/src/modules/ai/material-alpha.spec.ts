import { describe, expect, it } from "vitest";
import {
  deriveMaterialAlpha,
  deriveMaskedProviderRgb,
  deriveMaskedProviderRgbInterior,
  inspectMaskedRgbInterior,
  maskedRgbInteriorEligibility,
  MASKED_PROVIDER_RGB_INTERIOR_ALGORITHM,
  MASKED_PROVIDER_RGB_ALGORITHM,
  MATERIAL_ALPHA_ALGORITHM,
  type MaterialAlphaRgbaImage,
} from "@fashion/ai";

const rgba = (...pixels: number[][]): MaterialAlphaRgbaImage => ({
  width: pixels.length,
  height: 1,
  data: Uint8Array.from(pixels.flat()),
});

describe("masked RGB interior v2", () => {
  const square = (
    size: number,
    color = [40, 50, 60, 255],
  ): MaterialAlphaRgbaImage => ({
    width: size,
    height: size,
    data: Uint8Array.from(
      Array.from({ length: size * size }, () => color).flat(),
    ),
  });
  it("protects semitransparent pixels, the 2px opaque contour band and canvas edges against black raw backgrounds", () => {
    const source = square(13);
    for (let y = 0; y < 13; y++)
      for (let x = 0; x < 13; x++)
        if (x < 2 || y < 2 || x >= 11 || y >= 11)
          source.data[(y * 13 + x) * 4 + 3] = 239;
    const result = deriveMaskedProviderRgbInterior({
      source,
      probe: square(13, [0, 0, 0, 255]),
      mask: square(13, [0, 0, 0, 0]),
    });
    expect(result.algorithm).toBe(MASKED_PROVIDER_RGB_INTERIOR_ALGORITHM);
    expect(result.stats).toMatchObject({
      editablePixels: 25,
      changedRgbPixels: 25,
      alphaThreshold: 240,
      interiorRadius: 2,
    });
    for (let y = 0; y < 13; y++)
      for (let x = 0; x < 13; x++) {
        const offset = (y * 13 + x) * 4;
        expect(result.data[offset + 3]).toBe(source.data[offset + 3]);
        if (x < 4 || y < 4 || x > 8 || y > 8)
          expect(result.data.subarray(offset, offset + 4)).toEqual(
            source.data.subarray(offset, offset + 4),
          );
        else
          expect([...result.data.subarray(offset, offset + 3)]).toEqual([
            0, 0, 0,
          ]);
      }
  });
  it("treats alpha240 as opaque enough but protects a square 2px neighborhood of each alpha239 hole", () => {
    const source = square(9, [40, 50, 60, 240]);
    expect(
      inspectMaskedRgbInterior({ source, mask: square(9, [0, 0, 0, 0]) }).stats
        .editablePixels,
    ).toBe(25);
    source.data[(4 * 9 + 4) * 4 + 3] = 239;
    expect(
      maskedRgbInteriorEligibility(source).reduce((a, b) => a + b, 0),
    ).toBe(0);
  });
  it.each([1, 2, 3, 4])(
    "rejects effective editing of thin %ipx details without deleting them",
    (width) => {
      const source = square(11, [30, 40, 50, 0]);
      for (let y = 1; y < 10; y++)
        for (let x = 3; x < 3 + width; x++)
          source.data[(y * 11 + x) * 4 + 3] = 255;
      const result = deriveMaskedProviderRgbInterior({
        source,
        probe: square(11, [250, 220, 210, 0]),
        mask: square(11, [0, 0, 0, 0]),
      });
      expect(result.stats.editablePixels).toBe(0);
      expect(result.data).toEqual(source.data);
    },
  );
  it("keeps mask feather weights in eligible interiors, ignores provider alpha and never mutates inputs", () => {
    const source = square(9, [100, 80, 60, 253]);
    const probe = square(9, [200, 180, 160, 0]);
    const mask = square(9, [1, 2, 3, 255]);
    const points = [0, 64, 128, 255];
    for (const [i, alpha] of points.entries())
      mask.data[(4 * 9 + 2 + i) * 4 + 3] = alpha;
    const before = [source, probe, mask].map((im) => new Uint8Array(im.data));
    const result = deriveMaskedProviderRgbInterior({ source, probe, mask });
    expect(points.map((_, i) => result.data[(4 * 9 + 2 + i) * 4])).toEqual([
      200, 175, 150, 100,
    ]);
    for (let i = 3; i < result.data.length; i += 4)
      expect(result.data[i]).toBe(253);
    for (const [i, im] of [source, probe, mask].entries())
      expect(im.data).toEqual(before[i]);
    result.data.fill(0);
    expect(source.data).toEqual(before[0]);
  });
  it("validates dimensions before estimating editability or blending", () => {
    const source = square(7);
    expect(() => inspectMaskedRgbInterior({ source, mask: square(6) })).toThrow(
      /identical/,
    );
    expect(() =>
      deriveMaskedProviderRgbInterior({
        source,
        probe: square(6),
        mask: source,
      }),
    ).toThrow(/identical/);
    expect(() =>
      maskedRgbInteriorEligibility({ ...source, data: new Uint8Array(3) }),
    ).toThrow(/byte length/);
  });
});

describe("masked provider RGB derivation", () => {
  it("only blends selected RGB, keeps every source alpha and protected RGBA despite provider edits", () => {
    const source = rgba(
      [20, 200, 30, 255],
      [80, 90, 100, 127],
      [11, 12, 13, 253],
      [7, 8, 9, 0],
    );
    const raw = rgba(
      [220, 50, 130, 0],
      [180, 190, 200, 255],
      [255, 0, 255, 0],
      [255, 255, 255, 255],
    );
    const mask = rgba(
      [0, 0, 0, 0],
      [0, 0, 0, 128],
      [255, 255, 255, 255],
      [0, 0, 0, 0],
    );
    const result = deriveMaskedProviderRgb({ source, probe: raw, mask });
    expect([...result.data]).toEqual([
      220, 50, 130, 255, 130, 140, 150, 127, 11, 12, 13, 253, 7, 8, 9, 0,
    ]);
    expect(result.algorithm).toBe(MASKED_PROVIDER_RGB_ALGORITHM);
    expect(result.stats.changedRgbPixels).toBe(2);
  });

  it("preserves all 256 alpha values independently of provider alpha and does not mutate aliased inputs", () => {
    const source = rgba(
      ...Array.from({ length: 256 }, (_, alpha) => [12, 215, 78, alpha]),
    );
    const raw = rgba(
      ...Array.from({ length: 256 }, (_, alpha) => [230, 33, 95, 255 - alpha]),
    );
    const mask = rgba(
      ...Array.from({ length: 256 }, (_, alpha) => [0, 0, 0, alpha]),
    );
    const copies = [source, raw, mask].map((image) => Buffer.from(image.data));
    const result = deriveMaskedProviderRgb({ source, probe: raw, mask });
    for (let pixel = 0; pixel < 256; pixel++)
      expect(result.data[pixel * 4 + 3]).toBe(pixel);
    for (const [index, input] of [source, raw, mask].entries())
      expect(Buffer.from(input.data)).toEqual(copies[index]);
    result.data[0] = 99;
    expect(source.data[0]).toBe(12);
  });

  it("does not report a correction when pixels are unchanged or only invisible exterior is selected", () => {
    const source = rgba([90, 110, 130, 255], [0, 0, 0, 0]);
    expect(
      deriveMaskedProviderRgb({
        source,
        probe: rgba([90, 110, 130, 0], [255, 255, 255, 255]),
        mask: rgba([0, 0, 0, 0], [0, 0, 0, 0]),
      }).stats.changedRgbPixels,
    ).toBe(0);
  });

  it.each(["dimensions", "buffer", "shape"])(
    "rejects invalid correction input: %s",
    (invalid) => {
      const source = rgba([1, 2, 3, 255]);
      const raw =
        invalid === "dimensions"
          ? { ...source, width: 0 }
          : invalid === "buffer"
            ? { ...source, data: new Uint8Array(3) }
            : rgba([1, 2, 3, 255], [4, 5, 6, 255]);
      expect(() =>
        deriveMaskedProviderRgb({ source, probe: raw, mask: source }),
      ).toThrow();
    },
  );
});

describe("material alpha derivation", () => {
  it("preserves every source RGB byte and protected RGBA exactly while reducing selected alpha", () => {
    const source = rgba(
      [230, 217, 198, 253],
      [47, 53, 60, 127],
      [22, 33, 44, 0],
    );
    const result = deriveMaterialAlpha({
      source,
      probe: rgba([0, 255, 0, 255], [0, 255, 0, 255], [255, 255, 255, 255]),
      mask: rgba([255, 255, 255, 0], [0, 0, 0, 255], [255, 0, 0, 0]),
    });
    expect([...result.data]).toEqual([
      230, 217, 198, 0, 47, 53, 60, 127, 22, 33, 44, 0,
    ]);
    expect(result.algorithm).toBe(MATERIAL_ALPHA_ALGORITHM);
    expect(result.stats).toEqual({
      pixelCount: 3,
      editablePixels: 2,
      protectedPixels: 1,
      changedAlphaPixels: 1,
      fullyTransparentPixels: 2,
      partiallyTransparentPixels: 1,
      opaquePixels: 0,
    });
  });

  it.each([
    { probe: [0, 0, 0, 255], expected: 240 },
    { probe: [255, 255, 255, 255], expected: 240 },
    { probe: [0, 255, 0, 255], expected: 0 },
    { probe: [120, 240, 60, 255], expected: 120 },
    { probe: [200, 100, 0, 255], expected: 240 },
    { probe: [0, 100, 200, 255], expected: 240 },
    { probe: [120, 240, 60, 0], expected: 120 },
  ])(
    "handles black/white/key and colored boundary $probe without division by zero",
    ({ probe, expected }) => {
      expect(
        deriveMaterialAlpha({
          source: rgba([230, 228, 217, 240]),
          probe: rgba(probe),
          mask: rgba([0, 0, 0, 0]),
        }).data[3],
      ).toBe(expected);
    },
  );

  it("feathers the alpha change continuously using mask alpha, without changing RGB", () => {
    const source = rgba(...[0, 64, 128, 255].map(() => [210, 211, 212, 200]));
    const result = deriveMaterialAlpha({
      source,
      probe: rgba(...[0, 64, 128, 255].map(() => [100, 200, 50, 255])),
      mask: rgba(...[0, 64, 128, 255].map((alpha) => [255, 0, 255, alpha])),
    });
    expect([
      result.data[3],
      result.data[7],
      result.data[11],
      result.data[15],
    ]).toEqual([100, 125, 150, 200]);
    expect(result.stats.protectedPixels).toBe(1);
  });

  it("never increases source alpha across all byte values and varied key/feather samples", () => {
    const source = rgba(
      ...Array.from({ length: 256 }, (_, alpha) => [
        alpha,
        255 - alpha,
        71,
        alpha,
      ]),
    );
    const result = deriveMaterialAlpha({
      source,
      probe: rgba(
        ...Array.from({ length: 256 }, (_, n) => [
          (n * 19) % 256,
          (n * 37) % 256,
          (n * 53) % 256,
          n,
        ]),
      ),
      mask: rgba(
        ...Array.from({ length: 256 }, (_, n) => [0, 0, 0, (n * 73) % 256]),
      ),
    });
    for (let offset = 0; offset < source.data.length; offset += 4) {
      expect(result.data.subarray(offset, offset + 3)).toEqual(
        source.data.subarray(offset, offset + 3),
      );
      expect(result.data[offset + 3]).toBeLessThanOrEqual(
        source.data[offset + 3] ?? -1,
      );
    }
  });

  it("does not mutate inputs or alias Buffer/subarray backing storage", () => {
    const shared = Buffer.from([20, 30, 40, 200, 0, 255, 0, 255, 0, 0, 0, 0]);
    const before = Buffer.from(shared);
    const result = deriveMaterialAlpha({
      source: { width: 1, height: 1, data: shared.subarray(0, 4) },
      probe: { width: 1, height: 1, data: shared.subarray(4, 8) },
      mask: { width: 1, height: 1, data: shared.subarray(8, 12) },
    });
    expect(shared).toEqual(before);
    result.data.fill(99);
    expect(shared).toEqual(before);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 16_777_217])(
    "rejects invalid image width %s before processing",
    (width) => {
      const source = rgba([1, 2, 3, 4]);
      expect(() =>
        deriveMaterialAlpha({
          source: { ...source, width },
          probe: source,
          mask: source,
        }),
      ).toThrow(/dimensions/u);
    },
  );

  it("rejects mismatched dimensions and malformed RGBA byte lengths", () => {
    const source = rgba([1, 2, 3, 4], [5, 6, 7, 8]);
    expect(() =>
      deriveMaterialAlpha({
        source,
        probe: { ...source, width: 1, height: 2 },
        mask: source,
      }),
    ).toThrow(/identical/u);
    expect(() =>
      deriveMaterialAlpha({
        source,
        probe: source,
        mask: { ...source, data: Uint8Array.of(1, 2, 3) },
      }),
    ).toThrow(/byte length/u);
  });
});
