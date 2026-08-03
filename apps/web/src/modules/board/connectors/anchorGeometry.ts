import type { Editor, TLShape } from "tldraw";
import type { AnchorPoint, AnchorSide, Point } from "./connector-types";

/**
 * 基于 shape 的页面边界框计算四个边缘中点锚点。
 *
 * 使用 editor.getShapePageBounds() 获取变换后的坐标，
 * 兼容 scaleX、scaleY、angle、group 和不同 origin。
 */
export function computeAnchorPoints(
  editor: Editor,
  shape: TLShape,
): Record<AnchorSide, AnchorPoint> | null {
  const bounds = editor.getShapePageBounds(shape);
  if (!bounds) {
    return null;
  }

  // 边界框中心
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;

  // 四个边缘中点
  const top: Point = { x: cx, y: bounds.y };
  const right: Point = { x: bounds.x + bounds.w, y: cy };
  const bottom: Point = { x: cx, y: bounds.y + bounds.h };
  const left: Point = { x: bounds.x, y: cy };

  // 计算外法线（从中心指向边缘锚点的单位向量）
  const normalizeVector = (px: number, py: number): Point => {
    const length = Math.hypot(px, py);
    return length > 0 ? { x: px / length, y: py / length } : { x: 0, y: -1 };
  };

  return {
    top: {
      ...top,
      normal: normalizeVector(top.x - cx, top.y - cy),
    },
    right: {
      ...right,
      normal: normalizeVector(right.x - cx, right.y - cy),
    },
    bottom: {
      ...bottom,
      normal: normalizeVector(bottom.x - cx, bottom.y - cy),
    },
    left: {
      ...left,
      normal: normalizeVector(left.x - cx, left.y - cy),
    },
  };
}

/**
 * 根据两个对象中心位置自动选择相向的锚点。
 *
 * - abs(dx) >= abs(dy): 水平排列，选择 left/right 组合
 * - abs(dy) > abs(dx): 垂直排列，选择 top/bottom 组合
 */
export function autoSelectAnchors(
  sourceCenter: Point,
  targetCenter: Point,
): [AnchorSide, AnchorSide] {
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? ["right", "left"] : ["left", "right"];
  } else {
    return dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
  }
}

/**
 * 计算形状的中心点（页面坐标）
 */
export function getShapeCenter(editor: Editor, shape: TLShape): Point | null {
  const bounds = editor.getShapePageBounds(shape);
  if (!bounds) {
    return null;
  }
  return {
    x: bounds.x + bounds.w / 2,
    y: bounds.y + bounds.h / 2,
  };
}
