import { BaseBoxShapeUtil, Rectangle2d, type RecordProps, T, useEditor, useSvgExportContext } from "tldraw";
import { useState } from "react";
import { FABRIC_SHAPE_TYPE, type FabricShape } from "./shape-types";
import { CanvasImageSurface } from "./CanvasImageSurface";
import { imageContentBounds } from "./image-presentation";
import { preparedCanvasImage } from "../workflow/canvas-export-images";
import { readCanvasImageDimensions } from "../workflow/canvas-image-sizing";
import styles from "./canvas-image-surface.module.css";

function fabricBounds(shape: FabricShape) {
  return imageContentBounds(shape.props.w, shape.props.h, shape.props.pixelWidth || shape.props.imageWidth, shape.props.pixelHeight || shape.props.imageHeight);
}
export class FabricShapeUtil extends BaseBoxShapeUtil<FabricShape> {
  static override type = FABRIC_SHAPE_TYPE;
  static override props: RecordProps<FabricShape> = {
    appearance: T.any.optional(), mounts: T.any.optional(), role: T.string,
    fabricId: T.string, fabricTags: T.arrayOf(T.string), title: T.string.optional(), thumbnailUrl: T.string,
    w: T.number, h: T.number, pixelWidth: T.number.optional(), pixelHeight: T.number.optional(),
    imageWidth: T.number.optional(), imageHeight: T.number.optional(), imageSource: T.string.optional(),
  };
  override getDefaultProps(): FabricShape["props"] { return { fabricId: "", fabricTags: [], title: "面料图片", h: 174, w: 260, role: "reference", thumbnailUrl: "" }; }
  override canResize() { return true; }
  override hideSelectionBoundsBg() { return true; }
  override hideSelectionBoundsFg() { return true; }
  override hideRotateHandle() { return true; }
  override isAspectRatioLocked() { return true; }
  override getGeometry(shape: FabricShape) { const bounds = fabricBounds(shape); return new Rectangle2d({ x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h, isFilled: true }); }
  override component(shape: FabricShape) { return <FabricShapeContent key={shape.props.thumbnailUrl} shape={shape} />; }
  override getIndicatorPath(shape: FabricShape): Path2D { const bounds = fabricBounds(shape), path = new Path2D(); path.roundRect(bounds.x, bounds.y, bounds.w, bounds.h, Math.min(16, bounds.w / 4, bounds.h / 4)); return path; }
}
function FabricShapeContent({ shape }: { readonly shape: FabricShape }) {
  const editor = useEditor();
  const exporting = Boolean(useSvgExportContext());
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  return <CanvasImageSurface shapeId={shape.id} title={shape.props.title || "面料图片"} bounds={fabricBounds(shape)}
    pixelWidth={shape.props.pixelWidth} pixelHeight={shape.props.pixelHeight}
    nodeId={typeof shape.meta.canvasNodeId === "string" ? shape.meta.canvasNodeId : undefined}>
    {shape.props.thumbnailUrl && !failed ? (
      // Fabric images use the original authenticated file, with no material filter.
      // eslint-disable-next-line @next/next/no-img-element
      <img key={retry} alt="" draggable={false} loading={exporting ? "eager" : "lazy"}
        src={exporting ? preparedCanvasImage(editor, shape.props.thumbnailUrl) : shape.props.thumbnailUrl}
        onError={() => setFailed(true)}
        onLoad={(event) => {
          const size = readCanvasImageDimensions(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
          if (exporting || editor.getIsReadonly() || !size || shape.props.imageSource === shape.props.thumbnailUrl && shape.props.imageWidth === size.width && shape.props.imageHeight === size.height) return;
          editor.store.mergeRemoteChanges(() => editor.run(() => editor.updateShape<FabricShape>({ id: shape.id, type: FABRIC_SHAPE_TYPE, props: {
            imageWidth: size.width, imageHeight: size.height, pixelWidth: size.width, pixelHeight: size.height, imageSource: shape.props.thumbnailUrl,
          } }), { ignoreShapeLock: true, history: "ignore" }));
        }} />
    ) : <div className={styles.placeholder}><span>{failed ? "面料图片暂不可用" : "面料图片尚未就绪"}</span>{failed ? <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setRetry((value) => value + 1); setFailed(false); }}>重新载入</button> : null}</div>}
  </CanvasImageSurface>;
}
