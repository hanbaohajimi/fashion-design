export interface SketchStrokePoint {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
}
function distanceToSegmentSquared(
  point: SketchStrokePoint,
  start: SketchStrokePoint,
  end: SketchStrokePoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  }
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  const closestX = start.x + dx * t;
  const closestY = start.y + dy * t;
  return (point.x - closestX) ** 2 + (point.y - closestY) ** 2;
}

function densifyStroke(
  points: readonly SketchStrokePoint[],
  maxStep: number,
): SketchStrokePoint[] {
  if (points.length < 2) return [...points];
  const firstPoint = points[0];
  if (!firstPoint) return [];
  const dense: SketchStrokePoint[] = [firstPoint];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (!start || !end) continue;
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(1, Math.ceil(distance / maxStep));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      dense.push({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        z: (start.z ?? 0.5) + ((end.z ?? 0.5) - (start.z ?? 0.5)) * t,
      });
    }
  }
  return dense;
}

function strokeLength(points: readonly SketchStrokePoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (!start || !end) continue;
    length += Math.hypot(end.x - start.x, end.y - start.y);
  }
  return length;
}

/**
 * Cuts a polyline with a circular eraser moving from `eraserStart` to
 * `eraserEnd`. The result contains only the surviving contiguous runs.
 */
export function splitStrokeByEraser(
  points: readonly SketchStrokePoint[],
  eraserStart: SketchStrokePoint,
  eraserEnd: SketchStrokePoint,
  radius: number,
): SketchStrokePoint[][] {
  if (points.length === 0 || radius <= 0) return [points.slice()];
  const dense = densifyStroke(points, Math.max(0.75, radius * 0.3));
  const radiusSquared = radius * radius;
  const erased = dense.map(
    (point) =>
      distanceToSegmentSquared(point, eraserStart, eraserEnd) <= radiusSquared,
  );
  if (!erased.some(Boolean)) return [points.slice()];

  const runs: SketchStrokePoint[][] = [];
  let current: SketchStrokePoint[] = [];
  for (let index = 0; index < dense.length; index += 1) {
    if (erased[index]) {
      if (current.length > 1) runs.push(current);
      current = [];
    } else {
      const point = dense[index];
      if (point) current.push(point);
    }
  }
  if (current.length > 1) runs.push(current);

  const minimumFragmentLength = Math.max(1, radius * 0.35);
  return runs.filter((run) => strokeLength(run) >= minimumFragmentLength);
}
