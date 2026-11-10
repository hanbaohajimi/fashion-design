import { Box, type Editor, type TLShape, type TLShapeId } from "tldraw";

/** Keep visibility in the saved layout; inherit so hiding a container hides its descendants. */
export function canvasShapeVisibility(shape: TLShape): "hidden" | "inherit" {
  return shape.meta.canvasHidden === true ? "hidden" : "inherit";
}

/** Groups have no pixels of their own; their geometry can still include hidden children. */
export function visibleCanvasShapes(editor: Editor, ids?: readonly TLShapeId[]): TLShape[] {
  const included = ids ? editor.getShapeAndDescendantIds([...ids]) : null;
  return editor.getCurrentPageShapes().filter(shape => (!included || included.has(shape.id)) && shape.type !== "group" && !editor.isShapeHidden(shape));
}

export function visibleCanvasBounds(editor: Editor, ids?: readonly TLShapeId[]): Box | undefined {
  const bounds = visibleCanvasShapes(editor, ids).flatMap(shape => {
    const box = editor.getShapeMaskedPageBounds(shape.id);
    return box ? [box] : [];
  });
  return bounds.length ? Box.Common(bounds) : undefined;
}

/** Keyboard select-all and restored sessions must obey the same visibility as pointer picking. */
export function protectHiddenCanvasSelection(editor: Editor): () => void {
  return editor.sideEffects.registerBeforeChangeHandler("instance_page_state", (_previous, next) => {
    const selectedShapeIds = next.selectedShapeIds.filter(id => !editor.isShapeHidden(id));
    return selectedShapeIds.length === next.selectedShapeIds.length ? next : { ...next, selectedShapeIds };
  });
}

/** Visibility is independent of movement locks, but still requires write access. */
export function toggleCanvasObjectVisibility(editor: Editor, id: TLShapeId): boolean {
  if (editor.getIsReadonly() || !editor.getShape(id)) return false;
  editor.complete();
  const shape = editor.getShape(id);
  if (!shape) return false;
  const parent = editor.getShapeParent(shape);
  if (parent && editor.isShapeHidden(parent)) return false;
  const hide = shape.meta.canvasHidden !== true;
  editor.markHistoryStoppingPoint(hide ? "隐藏画布对象" : "显示画布对象");
  editor.run(() => {
    editor.updateShape({ id, type: shape.type, meta: { ...shape.meta, canvasHidden: hide } });
    editor.setSelectedShapes(editor.getSelectedShapeIds().filter(selectedId =>
      !editor.isShapeHidden(selectedId) && !(hide && editor.hasAncestor(id, selectedId))));
    const focused = editor.getFocusedGroup();
    if (focused && editor.isShapeHidden(focused)) editor.setFocusedGroup(null);
  }, { ignoreShapeLock: true });
  return true;
}

/** Prefer a visible copy. Hidden material can still open in its own workspace without revealing it. */
export function locateCanvasMaterial(editor: Editor, shapes: readonly TLShape[]): boolean {
  const visible = shapes.find(shape => !editor.isShapeHidden(shape));
  if (!visible) return false;
  editor.complete();
  editor.select(visible.id);
  editor.zoomToSelection();
  return true;
}
