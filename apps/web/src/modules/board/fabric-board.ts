import { createShapeId, type Editor, type VecLike } from "tldraw";

import { fabricToShapeProps, type FabricDragPayload } from "./fabric-drag";
import { deriveShapeSeed } from "./shapes/fabric-silhouette";
import { FABRIC_SHAPE_TYPE, type FabricShape } from "./shapes";

/** Stable 1°–4° tilt derived from the shape id, matching how a designer
 *  would casually pin a swatch rather than aligning it exactly. */
function swatchRotation(id: string): number {
  const seed = deriveShapeSeed(id);
  const r = (seed % 1000) / 1000;
  // ±1° to ±4°, sign from the next digit bucket.
  const sign = ((seed >> 10) & 1) === 0 ? 1 : -1;
  return sign * (1 + r * 3);
}

export function addFabricToBoard(
  editor: Editor,
  payload: FabricDragPayload,
  point: VecLike = editor.getViewportPageBounds().center,
) {
  const props = fabricToShapeProps(payload);
  const shapeId = createShapeId();
  editor.createShape<FabricShape>({
    id: shapeId,
    props,
    type: FABRIC_SHAPE_TYPE,
    x: point.x - props.w / 2,
    y: point.y - props.h / 2,
    rotation: (swatchRotation(shapeId) * Math.PI) / 180,
  });
  editor.select(shapeId);
  return shapeId;
}
