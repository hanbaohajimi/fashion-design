import { createShapeId, type Editor, type VecLike } from "tldraw";

import { fabricToShapeProps, type FabricDragPayload } from "./fabric-drag";
import { FABRIC_SHAPE_TYPE, type FabricShape } from "./shapes";

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
  });
  editor.select(shapeId);
  return shapeId;
}
