import {
  createShapeId,
  getPointsFromDrawSegments,
  StateNode,
  type Editor,
  type TLDrawShape,
  type TLLineShape,
  type TLPointerEventInfo,
  type TLShape,
  type TLShapeId,
} from "tldraw";

import { createUserMount, type Mount } from "../shapes/material-appearance";
import {
  FABRIC_SHAPE_TYPE,
  IMAGE_SHAPE_TYPE,
  NOTE_SHAPE_TYPE,
  SWATCH_SHAPE_TYPE,
} from "../shapes/shape-types";

// ---------------------------------------------------------------------------
// Mountable shapes — the four board shapes that carry a `mounts` prop
// ---------------------------------------------------------------------------
type MountableShapeType =
  | typeof IMAGE_SHAPE_TYPE
  | typeof NOTE_SHAPE_TYPE
  | typeof SWATCH_SHAPE_TYPE
  | typeof FABRIC_SHAPE_TYPE;

const MOUNTABLE_TYPES: readonly MountableShapeType[] = [
  IMAGE_SHAPE_TYPE,
  NOTE_SHAPE_TYPE,
  SWATCH_SHAPE_TYPE,
  FABRIC_SHAPE_TYPE,
];

/** Replaces tldraw's whole-shape eraser with a sketch-scoped partial eraser. */
export const SKETCH_ERASER_TOOL_ID = "eraser";

export type SketchPencilColor = "black" | "grey";
export type SketchPencilSize = "s" | "m" | "l";

export interface SketchPencilPreset {
  readonly opacity: number;
  readonly strokeColor: string;
  readonly strokeWidth: number;
}

const SKETCH_PENCIL_WIDTHS: Readonly<Record<SketchPencilSize, number>> = {
  l: 2.1,
  m: 1.05,
  s: 0.42,
};

const SKETCH_PENCIL_OPACITY: Readonly<Record<SketchPencilSize, number>> = {
  l: 0.82,
  m: 0.76,
  s: 0.68,
};

const SKETCH_PENCIL_COLORS: Readonly<Record<SketchPencilColor, string>> = {
  black: "#45423D",
  grey: "#706B63",
};

/** Calibrated graphite values; tldraw adds 1px to the display width. */
export function getSketchPencilPreset(
  size: SketchPencilSize,
  color: SketchPencilColor,
): SketchPencilPreset {
  return {
    opacity: SKETCH_PENCIL_OPACITY[size],
    strokeColor: SKETCH_PENCIL_COLORS[color],
    strokeWidth: SKETCH_PENCIL_WIDTHS[size],
  };
}

interface SketchEraserConfig {
  readonly frameId: TLShapeId;
  /** Eraser radius in screen pixels. */
  readonly radius: number;
}

export interface SketchStrokePoint {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
}

const sketchEraserConfigs = new WeakMap<Editor, SketchEraserConfig>();

export function configureSketchEraser(
  editor: Editor,
  config: SketchEraserConfig | null,
): void {
  if (config) {
    sketchEraserConfigs.set(editor, config);
  } else {
    sketchEraserConfigs.delete(editor);
  }
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
    length += Math.hypot(
      end.x - start.x,
      end.y - start.y,
    );
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

function numberToFloat16Bits(input: number): number {
  if (input === 0) return Object.is(input, -0) ? 0x8000 : 0;
  if (!Number.isFinite(input)) {
    if (Number.isNaN(input)) return 0x7e00;
    return input > 0 ? 0x7c00 : 0xfc00;
  }
  const sign = input < 0 ? 1 : 0;
  const value = Math.abs(input);
  const exponent = Math.floor(Math.log2(value));
  let biasedExponent = exponent + 15;
  if (biasedExponent >= 31) return (sign << 15) | 0x7c00;
  if (biasedExponent <= 0) {
    const fraction = Math.round(value * 2 ** 14 * 1024);
    return (sign << 15) | (fraction & 0x03ff);
  }
  const mantissa = value / 2 ** exponent - 1;
  let fraction = Math.round(mantissa * 1024);
  if (fraction >= 1024) {
    fraction = 0;
    biasedExponent += 1;
    if (biasedExponent >= 31) return (sign << 15) | 0x7c00;
  }
  return (sign << 15) | (biasedExponent << 10) | fraction;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function encodeDrawPoints(points: readonly SketchStrokePoint[]): string {
  if (points.length === 0) return "";
  const firstPointBytes = 12;
  const buffer = new Uint8Array(firstPointBytes + (points.length - 1) * 6);
  const view = new DataView(buffer.buffer);
  const first = points[0];
  if (!first) return "";
  view.setFloat32(0, first.x, true);
  view.setFloat32(4, first.y, true);
  view.setFloat32(8, first.z ?? 0.5, true);
  let previousX = first.x;
  let previousY = first.y;
  let previousZ = first.z ?? 0.5;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (!point) continue;
    const pressure = point.z ?? 0.5;
    const offset = firstPointBytes + (index - 1) * 6;
    view.setUint16(offset, numberToFloat16Bits(point.x - previousX), true);
    view.setUint16(offset + 2, numberToFloat16Bits(point.y - previousY), true);
    view.setUint16(offset + 4, numberToFloat16Bits(pressure - previousZ), true);
    previousX = point.x;
    previousY = point.y;
    previousZ = pressure;
  }
  return bytesToBase64(buffer);
}

function pointsFromSketchShape(
  shape: TLDrawShape | TLLineShape,
): SketchStrokePoint[] {
  if (shape.type === "draw") {
    return getPointsFromDrawSegments(
      shape.props.segments,
      shape.props.scaleX,
      shape.props.scaleY,
    );
  }
  return Object.values(shape.props.points)
    .sort((left, right) => left.index.localeCompare(right.index))
    .map((point) => ({ x: point.x, y: point.y, z: 0.5 }));
}

function drawPropsFromSketchShape(
  shape: TLDrawShape | TLLineShape,
  points: readonly SketchStrokePoint[],
): TLDrawShape["props"] {
  return {
    color: shape.props.color,
    dash: shape.props.dash,
    fill: shape.type === "draw" ? shape.props.fill : "none",
    isClosed: false,
    isComplete: true,
    isPen: shape.type === "draw" ? shape.props.isPen : false,
    scale: shape.props.scale,
    scaleX: 1,
    scaleY: 1,
    segments: [{ dim: 3, path: encodeDrawPoints(points), type: "free" }],
    size: shape.props.size,
  };
}

function eraseSketchSegment(
  editor: Editor,
  start: SketchStrokePoint,
  end: SketchStrokePoint,
): void {
  const config = sketchEraserConfigs.get(editor);
  if (!config || !editor.getShape(config.frameId)) return;
  const radius = config.radius / editor.getZoomLevel();
  const childIds = editor.getSortedChildIdsForParent(config.frameId);

  for (const childId of childIds) {
    const shape = editor.getShape<TLDrawShape | TLLineShape>(childId);
    if (!shape || (shape.type !== "draw" && shape.type !== "line")) continue;
    const localStart = editor.getPointInShapeSpace(shape, start);
    const localEnd = editor.getPointInShapeSpace(shape, end);
    const points = pointsFromSketchShape(shape);
    const remaining = splitStrokeByEraser(
      points,
      localStart,
      localEnd,
      radius,
    );
    const onlyRun = remaining.length === 1 ? remaining[0] : undefined;
    if (onlyRun?.length === points.length) continue;

    editor.deleteShape(shape.id);
    if (remaining.length === 0) continue;
    editor.createShapes<TLDrawShape>(
      remaining.map((run) => ({
        id: createShapeId(),
        isLocked: shape.isLocked,
        meta: shape.meta,
        opacity: shape.opacity,
        parentId: config.frameId,
        props: drawPropsFromSketchShape(shape, run),
        rotation: shape.rotation,
        type: "draw",
        x: shape.x,
        y: shape.y,
      })),
    );
  }
}

/** A pressure-friendly partial eraser scoped to the active fashion sketch. */
export class SketchEraserTool extends StateNode {
  static override id = SKETCH_ERASER_TOOL_ID;
  static override isLockable = false;
  static override useCoalescedEvents = true;

  private historyMark = "";
  private lastPoint: SketchStrokePoint | null = null;
  private scribbleId: string | null = null;

  override onEnter = (): void => {
    this.editor.setCursor({ type: "cross", rotation: 0 });
  };

  override onExit = (): void => {
    if (this.scribbleId) this.editor.scribbles.stop(this.scribbleId);
    this.scribbleId = null;
    this.lastPoint = null;
    this.editor.setCursor({ type: "default", rotation: 0 });
  };

  override onPointerDown = (info: TLPointerEventInfo): void => {
    if (info.button !== 0) return;
    const config = sketchEraserConfigs.get(this.editor);
    if (!config) return;
    this.historyMark = this.editor.markHistoryStoppingPoint(
      "partial sketch erase",
    );
    const point = this.editor.inputs.getCurrentPagePoint();
    this.lastPoint = point;
    const scribble = this.editor.scribbles.addScribble({
      color: "muted-1",
      size: config.radius * 2,
    });
    this.scribbleId = scribble.id;
    this.editor.scribbles.addPoint(scribble.id, point.x, point.y);
    eraseSketchSegment(this.editor, point, point);
  };

  override onPointerMove = (): void => {
    if (!this.lastPoint) return;
    const point = this.editor.inputs.getCurrentPagePoint();
    if (this.scribbleId) {
      this.editor.scribbles.addPoint(this.scribbleId, point.x, point.y);
    }
    eraseSketchSegment(this.editor, this.lastPoint, point);
    this.lastPoint = point;
  };

  override onPointerUp = (): void => {
    if (this.lastPoint) {
      const point = this.editor.inputs.getCurrentPagePoint();
      eraseSketchSegment(this.editor, this.lastPoint, point);
    }
    if (this.historyMark) this.editor.squashToMark(this.historyMark);
    if (this.scribbleId) this.editor.scribbles.stop(this.scribbleId);
    this.historyMark = "";
    this.scribbleId = null;
    this.lastPoint = null;
  };

  override onCancel = (): void => {
    if (this.historyMark) this.editor.bailToMark(this.historyMark);
    if (this.scribbleId) this.editor.scribbles.stop(this.scribbleId);
    this.historyMark = "";
    this.scribbleId = null;
    this.lastPoint = null;
  };

  override onInterrupt = (): void => {
    this.onCancel();
  };
}

function isMountable(
  shape: TLShape,
): shape is TLShape & { readonly type: MountableShapeType } {
  return (MOUNTABLE_TYPES as readonly string[]).includes(shape.type);
}

/**
 * Places a single mount on the shape under the pointer.
 *
 * `updateShape` is discriminated on `type`, so a shape whose type is only known
 * as a union can't be passed straight through. Switching on the literal narrows
 * it per branch, which lets the compiler verify that each target really does
 * carry a `mounts` prop — no cast required.
 */
export class MountTool extends StateNode {
  static override id = "mount";

  override onEnter = (): void => {
    this.editor.setCursor({ type: "cross", rotation: 0 });
  };

  override onExit = (): void => {
    this.editor.setCursor({ type: "default", rotation: 0 });
  };

  override onPointerDown = (info: TLPointerEventInfo): void => {
    if (info.button !== 0) {
      return;
    }

    const point = this.editor.inputs.currentPagePoint;
    const hitShape = this.editor.getShapeAtPoint(point, {
      hitInside: true,
      margin: 0,
    });

    // Empty canvas or a shape that can't hold mounts — leave the tool.
    if (!hitShape || !isMountable(hitShape)) {
      this.editor.setCurrentTool("select");
      return;
    }

    const bounds = this.editor.getShapePageBounds(hitShape);
    if (!bounds) {
      return;
    }

    // Mount coordinates are stored normalised (0..1) against the content box so
    // they survive resizing.
    const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
    const mount = createUserMount(
      "red-pin",
      clamp01((point.x - bounds.x) / bounds.w),
      clamp01((point.y - bounds.y) / bounds.h),
    );

    switch (hitShape.type) {
      case IMAGE_SHAPE_TYPE: {
        const shape = hitShape as TLShape & {
          readonly type: typeof IMAGE_SHAPE_TYPE;
          readonly props: { readonly mounts?: readonly Mount[] };
        };
        this.editor.updateShape({
          id: shape.id,
          type: IMAGE_SHAPE_TYPE,
          props: { mounts: [...(shape.props.mounts ?? []), mount] },
        });
        break;
      }
      case NOTE_SHAPE_TYPE: {
        const shape = hitShape as TLShape & {
          readonly type: typeof NOTE_SHAPE_TYPE;
          readonly props: { readonly mounts?: readonly Mount[] };
        };
        this.editor.updateShape({
          id: shape.id,
          type: NOTE_SHAPE_TYPE,
          props: { mounts: [...(shape.props.mounts ?? []), mount] },
        });
        break;
      }
      case SWATCH_SHAPE_TYPE: {
        const shape = hitShape as TLShape & {
          readonly type: typeof SWATCH_SHAPE_TYPE;
          readonly props: { readonly mounts?: readonly Mount[] };
        };
        this.editor.updateShape({
          id: shape.id,
          type: SWATCH_SHAPE_TYPE,
          props: { mounts: [...(shape.props.mounts ?? []), mount] },
        });
        break;
      }
      case FABRIC_SHAPE_TYPE: {
        const shape = hitShape as TLShape & {
          readonly type: typeof FABRIC_SHAPE_TYPE;
          readonly props: { readonly mounts?: readonly Mount[] };
        };
        this.editor.updateShape({
          id: shape.id,
          type: FABRIC_SHAPE_TYPE,
          props: { mounts: [...(shape.props.mounts ?? []), mount] },
        });
        break;
      }
    }

    // One click places one mount, then hands control back to select.

    // One click places one mount, then hands control back to select.
    this.editor.setCurrentTool("select");
  };

  override onKeyDown = (info: { readonly key: string }): void => {
    if (info.key === "Escape") {
      this.editor.setCurrentTool("select");
    }
  };
}
