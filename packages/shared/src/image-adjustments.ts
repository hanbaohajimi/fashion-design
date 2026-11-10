import { z } from "zod";

const amount = z.number().min(-100).max(100).default(0);
export const imageAdjustmentsSchema = z.object({
  brightness: amount,
  contrast: amount,
  saturation: amount,
  warmth: amount,
}).strict();
export type ImageAdjustments = z.infer<typeof imageAdjustmentsSchema>;
export const originalImageAdjustments: Readonly<ImageAdjustments> = Object.freeze({
  brightness: 0, contrast: 0, saturation: 0, warmth: 0,
});
export function hasImageAdjustments(value: ImageAdjustments) {
  return value.brightness !== 0 || value.contrast !== 0 || value.saturation !== 0 || value.warmth !== 0;
}

/** A single sRGB matrix shared by the SVG preview and saved RGBA output. */
export function imageAdjustmentMatrix(value: ImageAdjustments): number[] {
  const brightness = 1 + value.brightness / 100;
  const contrast = 1 + value.contrast / 100;
  const saturation = 1 + value.saturation / 100;
  const gain = brightness * contrast;
  const grey = (1 - contrast) / 2;
  const warm = value.warmth * .0015;
  const weights = [.2126, .7152, .0722];
  // Channel gains warm/cool the image without adding colored light to black.
  const balance = [1 + warm, 1, 1 - warm];
  const matrix = weights.flatMap((_, row) => {
    const tint = balance[row] ?? 1;
    return [
      ...weights.map((weight, column) => tint * gain * (weight * (1 - saturation) + (row === column ? saturation : 0))),
      0, tint * grey,
    ];
  });
  return [...matrix, 0, 0, 0, 1, 0];
}

/** Mutate tightly packed straight RGBA. Alpha and fully transparent RGB survive. */
export function adjustImageRgba(pixels: Uint8Array | Uint8ClampedArray, value: ImageAdjustments) {
  if (pixels.length % 4) throw new Error("图片颜色调整需要完整 RGBA 像素");
  if (!hasImageAdjustments(value)) return pixels;
  const m = imageAdjustmentMatrix(imageAdjustmentsSchema.parse(value));
  const byte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  for (let at = 0; at < pixels.length; at += 4) {
    if (pixels[at + 3] === 0) continue;
    const r = pixels[at] ?? 0, g = pixels[at + 1] ?? 0, b = pixels[at + 2] ?? 0;
    pixels[at] = byte(r * (m[0] ?? 0) + g * (m[1] ?? 0) + b * (m[2] ?? 0) + 255 * (m[4] ?? 0));
    pixels[at + 1] = byte(r * (m[5] ?? 0) + g * (m[6] ?? 0) + b * (m[7] ?? 0) + 255 * (m[9] ?? 0));
    pixels[at + 2] = byte(r * (m[10] ?? 0) + g * (m[11] ?? 0) + b * (m[12] ?? 0) + 255 * (m[14] ?? 0));
  }
  return pixels;
}
