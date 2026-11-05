import type { Editor, TLShape, TLShapeId } from "tldraw";
import type { WorkflowGraph } from "./workflow-api";

/** Fit the working set with room for controls, without enlarging small assets. */
export function fitCanvasContents(editor: Editor, options?: Parameters<Editor["zoomToBounds"]>[1]) {
  const bounds = editor.getCurrentPageBounds();
  if (bounds) editor.zoomToBounds(bounds, { ...options, targetZoom: 1, inset: Math.min(240, editor.getViewportScreenBounds().w * 0.3) });
}

/** Containers expand only for an explicit selection, never into design relations. */
export function selectedMaterialShapes(editor: Editor): TLShape[] {
  const result = new Map<TLShapeId, TLShape>();
  const visited = new Set<TLShapeId>();
  const visit = (id: TLShapeId) => {
    if (visited.has(id)) return;
    visited.add(id);
    const shape = editor.getShape(id);
    if (!shape) return;
    if (["group", "frame", "fashion-frame"].includes(shape.type)) {
      editor.getSortedChildIdsForParent(id).forEach(visit);
    } else result.set(id, shape);
  };
  editor.getSelectedShapeIds().forEach(visit);
  return [...result.values()];
}

/** A copied placement can reuse a real node before the next graph refresh. */
export function placementNodeId(
  shape: TLShape,
  bindings: ReadonlyMap<string, string>,
  graph: WorkflowGraph,
): string | null {
  const id = bindings.get(shape.id) ?? shape.meta.canvasNodeId;
  return typeof id === "string" &&
    graph.nodes.some((node) => node.id === id && node.kind === "asset")
    ? id
    : null;
}

type CanvasCamera = { x: number; y: number; z: number };
type CanvasViewport = { w: number; h: number };
const usableViewport = (value: CanvasViewport) =>
  Number.isFinite(value.w) &&
  Number.isFinite(value.h) &&
  value.w > 1 &&
  value.h > 1;

/** Keep the same page point centered when the assistant or window changes size. */
export function centerCameraForViewport(
  camera: CanvasCamera,
  before: CanvasViewport,
  after: CanvasViewport,
): CanvasCamera {
  if (!usableViewport(before) || !usableViewport(after)) return camera;
  return {
    x: camera.x + (after.w - before.w) / (2 * camera.z),
    y: camera.y + (after.h - before.h) / (2 * camera.z),
    z: camera.z,
  };
}

export function readCanvasCamera(
  value: unknown,
  viewport?: CanvasViewport,
): CanvasCamera | null {
  if (!value || typeof value !== "object") return null;
  const { x, y, z, w, h } = value as Record<string, unknown>;
  if (!(
    typeof x === "number" &&
    Number.isFinite(x) &&
    typeof y === "number" &&
    Number.isFinite(y) &&
    typeof z === "number" &&
    Number.isFinite(z) &&
    z > 0 &&
    z <= 64
  ))
    return null;
  const camera = { x, y, z };
  return viewport && typeof w === "number" && typeof h === "number"
    ? centerCameraForViewport(camera, { w, h }, viewport)
    : camera;
}
