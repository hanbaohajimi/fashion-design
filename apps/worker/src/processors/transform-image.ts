import { adjustImageRgba, hasImageAdjustments, imageTransformSchema, type ImageTransform } from "@fashion/shared";
import sharp from "sharp";

/** The preview and contract use: EXIF → crop → rotate → screen-axis mirror → resize. */
export async function transformImage(bytes: Buffer, input: ImageTransform) {
  const params = imageTransformSchema.parse(input);
  let source = sharp(bytes, { limitInputPixels: 32_000_000 }).autoOrient();
  if (params.crop) source = source.extract(params.crop);

  // Materialize rotation before mirroring: Sharp otherwise mirrors before rotation,
  // regardless of their call order. Raw pixels avoid an intermediate lossy encode.
  const rotated = await source
    .rotate(params.rotate ?? 0, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = sharp(rotated.data, {
    raw: {
      width: rotated.info.width,
      height: rotated.info.height,
      channels: rotated.info.channels,
    },
  })
    .flop(params.flipHorizontal ?? false)
    .flip(params.flipVertical ?? false)
    .resize(params.width, params.height, { fit: "fill" });
  if (!params.adjustments || !hasImageAdjustments(params.adjustments)) return output.png().toBuffer();
  const rgba = await output.toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  adjustImageRgba(rgba.data, params.adjustments);
  return sharp(rgba.data, { raw: { width: rgba.info.width, height: rgba.info.height, channels: 4 } }).png().toBuffer();
}
