import { Box, type Editor } from "tldraw";
import { visibleCanvasShapes } from "./canvas-visibility";

export interface OverviewBox { x: number; y: number; w: number; h: number }
export interface OverviewPoint { x: number; y: number }

const finiteBox = (box: OverviewBox) => [box.x, box.y, box.w, box.h].every(Number.isFinite) && box.w >= 0 && box.h >= 0;

/** Recomputed for document/selection changes, independently from camera motion. */
export function readOverviewShapes(editor: Editor) {
  return visibleCanvasShapes(editor).flatMap(shape => {
    const bounds = editor.getShapeMaskedPageBounds(shape.id);
    if (!bounds || !finiteBox(bounds)) return [];
    return [{ id: shape.id, x: bounds.x, y: bounds.y, w: Math.max(bounds.w, 1), h: Math.max(bounds.h, 1) }];
  });
}

/** Include the visible artwork and viewport with a fixed pixel margin. */
export function overviewBounds(content: OverviewBox | null, viewport: OverviewBox, width: number, height: number): OverviewBox {
  const validViewport = finiteBox(viewport) ? viewport : { x: 0, y: 0, w: 1, h: 1 };
  const box = content && finiteBox(content) ? Box.Common([new Box(content.x, content.y, content.w, content.h), new Box(validViewport.x, validViewport.y, validViewport.w, validViewport.h)]) : new Box(validViewport.x, validViewport.y, validViewport.w, validViewport.h);
  const scale = Math.min(Math.max(1, width - 24) / Math.max(1, box.w), Math.max(1, height - 24) / Math.max(1, box.h));
  const w = Math.max(1, width) / scale, h = Math.max(1, height) / scale;
  return { x: box.center.x - w / 2, y: box.center.y - h / 2, w, h };
}

export function overviewPoint(point: OverviewPoint, screen: { left: number; top: number; width: number; height: number }, bounds: OverviewBox): OverviewPoint {
  const x = Math.min(1, Math.max(0, (point.x - screen.left) / Math.max(1, screen.width)));
  const y = Math.min(1, Math.max(0, (point.y - screen.top) / Math.max(1, screen.height)));
  return { x: bounds.x + x * bounds.w, y: bounds.y + y * bounds.h };
}

export function overviewContains(box: OverviewBox, point: OverviewPoint) {
  return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
}
