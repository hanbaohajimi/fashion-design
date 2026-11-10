import type { ImageOrientation } from "@fashion/shared";
export { imageOrientationSchema, type ImageOrientation } from "@fashion/shared";

export const originalOrientation: ImageOrientation = {
  rotate: 0,
  flipHorizontal: false,
  flipVertical: false,
};

export function hasOrientationChange(value: ImageOrientation) {
  return value.rotate !== 0 || value.flipHorizontal || value.flipVertical;
}

/** Rotate what the user currently sees, including any active screen-axis mirror. */
export function turnImage(
  value: ImageOrientation,
  degrees: number,
): ImageOrientation {
  const direction = value.flipHorizontal !== value.flipVertical ? -1 : 1;
  const next = value.rotate + degrees * direction;
  return {
    ...value,
    rotate: Math.round((((next + 540) % 360) - 180) * 1_000_000) / 1_000_000,
  };
}
