import type { Editor, TLShapeId } from "tldraw";
import type { ImageShape } from "../shapes/shape-types";

export interface CanvasImageDimensions { width: number; height: number }

export function readCanvasImageDimensions(width: unknown, height: unknown): CanvasImageDimensions | null {
  return typeof width === "number" && Number.isSafeInteger(width) && width > 0 &&
    typeof height === "number" && Number.isSafeInteger(height) && height > 0 ? { width, height } : null;
}

/** Bound a new image without enlarging small originals or changing its aspect ratio. */
export function initialCanvasImageSize(payload: Record<string, unknown>) {
  const source = readCanvasImageDimensions(payload.width, payload.height) ??
    readCanvasImageDimensions(payload.imageWidth, payload.imageHeight);
  if (!source) return { w: 320, h: 380, imageWidth: 0, imageHeight: 0 };
  const scale = Math.min(1, 320 / source.width, 380 / source.height);
  return { w: source.width * scale, h: source.height * scale, imageWidth: source.width, imageHeight: source.height };
}

/** Remove the contain margins while keeping the visible image's center, scale and rotation. */
export function canvasImageFitBounds(shape: ImageShape) {
  const { w, h, url, imageSource, imageWidth, imageHeight } = shape.props;
  if (!url || imageSource !== url || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const source = readCanvasImageDimensions(imageWidth, imageHeight);
  if (!source) return null;
  const scale = Math.min(w / source.width, h / source.height);
  const width = source.width * scale, height = source.height * scale;
  if (Math.abs(w - width) < .01 && Math.abs(h - height) < .01) return null;
  const dx = (w - width) / 2, dy = (h - height) / 2;
  const cosine = Math.cos(shape.rotation), sine = Math.sin(shape.rotation);
  return { x: shape.x + cosine * dx - sine * dy, y: shape.y + sine * dx + cosine * dy, w: width, h: height };
}

export function fitCanvasImageToSource(editor: Editor, id: TLShapeId): boolean {
  const current = editor.getShape(id);
  if (!current || current.type !== "fashion-image" || editor.getIsReadonly() ||
    editor.isShapeOrAncestorLocked(current) || editor.isShapeHidden(current)) return false;
  editor.complete();
  const shape = editor.getShape<ImageShape>(id);
  if (!shape) return false;
  const fit = canvasImageFitBounds(shape);
  if (!fit) return false;
  editor.markHistoryStoppingPoint("匹配图片比例");
  editor.updateShape({ id, type: "fashion-image", x: fit.x, y: fit.y, props: { w: fit.w, h: fit.h } });
  editor.focus();
  return true;
}
