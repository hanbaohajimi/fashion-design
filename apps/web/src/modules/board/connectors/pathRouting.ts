import type { AnchorPoint, Point } from "./connector-types";

/**
 * 生成贝塞尔曲线路径。
 *
 * 控制点沿源边和目标边的外法线方向延伸，
 * 确保曲线从对象边缘近似垂直离开和进入。
 */
export function computeBezierPath(
  source: AnchorPoint,
  target: AnchorPoint,
): string {
  const distance = Math.hypot(target.x - source.x, target.y - source.y);
  const handleLength = Math.max(48, Math.min(180, distance * 0.35));

  // 控制点沿外法线方向延伸
  const c1x = source.x + source.normal.x * handleLength;
  const c1y = source.y + source.normal.y * handleLength;
  const c2x = target.x + target.normal.x * handleLength;
  const c2y = target.y + target.normal.y * handleLength;

  return `M ${source.x} ${source.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${target.x} ${target.y}`;
}

/**
 * 生成正交折线路径（水平和垂直线段组成）。
 *
 * Manhattan routing: 沿源法线延伸 -> 水平/垂直转折 -> 沿目标法线进入。
 */
export function computeOrthogonalPath(
  source: AnchorPoint,
  target: AnchorPoint,
): string {
  const distance = Math.hypot(target.x - source.x, target.y - source.y);
  const offset = Math.max(32, distance * 0.25);

  // 沿源法线延伸
  const p1x = source.x + source.normal.x * offset;
  const p1y = source.y + source.normal.y * offset;

  // 沿目标法线延伸
  const p2x = target.x + target.normal.x * offset;
  const p2y = target.y + target.normal.y * offset;

  // 判断是水平优先还是垂直优先
  const dx = Math.abs(target.x - source.x);
  const dy = Math.abs(target.y - source.y);

  if (dx > dy) {
    // 水平优先：source -> (p1x, p1y) -> (p2x, p1y) -> (p2x, p2y) -> target
    return `M ${source.x} ${source.y} L ${p1x} ${p1y} L ${p2x} ${p1y} L ${p2x} ${p2y} L ${target.x} ${target.y}`;
  } else {
    // 垂直优先：source -> (p1x, p1y) -> (p1x, p2y) -> (p2x, p2y) -> target
    return `M ${source.x} ${source.y} L ${p1x} ${p1y} L ${p1x} ${p2y} L ${p2x} ${p2y} L ${target.x} ${target.y}`;
  }
}

/**
 * 生成带圆角的正交折线路径。
 */
export function computeRoundedPath(
  source: AnchorPoint,
  target: AnchorPoint,
  cornerRadius: number = 8,
): string {
  const distance = Math.hypot(target.x - source.x, target.y - source.y);
  const offset = Math.max(32, distance * 0.25);
  const radius = Math.min(cornerRadius, offset * 0.5);

  const p1x = source.x + source.normal.x * offset;
  const p1y = source.y + source.normal.y * offset;
  const p2x = target.x + target.normal.x * offset;
  const p2y = target.y + target.normal.y * offset;

  const dx = Math.abs(target.x - source.x);
  const dy = Math.abs(target.y - source.y);

  if (dx > dy) {
    // 水平优先带圆角
    const corner1x = p2x;
    const corner1y = p1y;
    return `M ${source.x} ${source.y} L ${p1x} ${p1y} L ${corner1x - Math.sign(p2x - p1x) * radius} ${p1y} Q ${corner1x} ${corner1y}, ${corner1x} ${corner1y + Math.sign(p2y - p1y) * radius} L ${p2x} ${p2y} L ${target.x} ${target.y}`;
  } else {
    // 垂直优先带圆角
    const corner1x = p1x;
    const corner1y = p2y;
    return `M ${source.x} ${source.y} L ${p1x} ${p1y} L ${p1x} ${corner1y - Math.sign(p2y - p1y) * radius} Q ${corner1x} ${corner1y}, ${corner1x + Math.sign(p2x - p1x) * radius} ${corner1y} L ${p2x} ${p2y} L ${target.x} ${target.y}`;
  }
}

/**
 * 计算箭头路径（等边三角形）。
 *
 * @param point 箭头尖端位置
 * @param tangent 箭头方向（单位向量）
 * @param size 箭头尺寸
 */
export function computeArrowPath(
  point: Point,
  tangent: Point,
  size: number = 7,
): string {
  const angle = Math.atan2(tangent.y, tangent.x);
  const halfAngle = Math.PI / 6; // 30度

  // 箭头两侧的点
  const x1 = point.x - size * Math.cos(angle - halfAngle);
  const y1 = point.y - size * Math.sin(angle - halfAngle);
  const x2 = point.x - size * Math.cos(angle + halfAngle);
  const y2 = point.y - size * Math.sin(angle + halfAngle);

  return `M ${point.x} ${point.y} L ${x1} ${y1} L ${x2} ${y2} Z`;
}

/**
 * 计算贝塞尔曲线终点的切线方向（用于箭头）。
 */
export function computeBezierEndTangent(
  target: AnchorPoint,
  distance: number,
): Point {
  const handleLength = Math.max(48, Math.min(180, distance * 0.35));
  const c2x = target.x + target.normal.x * handleLength;
  const c2y = target.y + target.normal.y * handleLength;

  const dx = target.x - c2x;
  const dy = target.y - c2y;
  const length = Math.hypot(dx, dy);

  return length > 0 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
}

/**
 * 计算正交路径终点的切线方向（用于箭头）。
 */
export function computeOrthogonalEndTangent(
  _source: AnchorPoint,
  target: AnchorPoint,
): Point {
  // 正交路径的最后一段是沿目标法线的反方向
  return {
    x: -target.normal.x,
    y: -target.normal.y,
  };
}
