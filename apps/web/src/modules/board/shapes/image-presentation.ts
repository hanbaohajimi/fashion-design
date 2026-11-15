/** Fit the original picture inside its saved placement without changing that placement. */
export const isThumbnailUrl = (url: string | undefined | null) => /\/thumbnail(?:\/|$|\?)/u.test(url ?? "");
export function imageContentBounds(w: number, h: number, pixelWidth?: number, pixelHeight?: number) {
  w = Math.max(1, Number.isFinite(w) ? w : 1); h = Math.max(1, Number.isFinite(h) ? h : 1);
  if (!pixelWidth || !pixelHeight || !Number.isFinite(pixelWidth) || !Number.isFinite(pixelHeight) || pixelWidth <= 0 || pixelHeight <= 0) return { x: 0, y: 0, w, h };
  const scale = Math.min(w / pixelWidth, h / pixelHeight);
  const width = pixelWidth * scale, height = pixelHeight * scale;
  return { x: (w - width) / 2, y: (h - height) / 2, w: width, h: height };
}
