import { BaseBoxShapeUtil, Box, Rectangle2d, type RecordProps, T, useEditor, useSvgExportContext, useValue } from "tldraw";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { readCanvasImageDimensions } from "../workflow/canvas-image-sizing";
import { preparedCanvasImage } from "../workflow/canvas-export-images";
import { useUploadPreview } from "../upload-preview-store";
import { IMAGE_SHAPE_TYPE, type ImageShape } from "./shape-types";
import { CanvasImageSurface } from "./CanvasImageSurface";
import { imageContentBounds, isThumbnailUrl } from "./image-presentation";
import styles from "./shapes.module.css";
import surface from "./canvas-image-surface.module.css";

export function imageShapeBounds(shape: ImageShape) {
  const current = shape.props.imageSource === shape.props.url;
  return imageContentBounds(shape.props.w, shape.props.h, current ? shape.props.imageWidth || shape.props.pixelWidth : shape.props.pixelWidth, current ? shape.props.imageHeight || shape.props.pixelHeight : shape.props.pixelHeight);
}

function ImageShapeContent({ shape }: { readonly shape: ImageShape }) {
  const editor = useEditor();
  const exporting = Boolean(useSvgExportContext());
  const uploadPreview = useUploadPreview(shape.id);
  const source = shape.props.url || uploadPreview;
  const [retry, setRetry] = useState(0);
  const imageKey = `${retry}:${source ?? ""}`;
  const currentImageKey = useRef(imageKey);
  useLayoutEffect(() => { currentImageKey.current = imageKey; }, [imageKey]);
  const [imageState, setImageState] = useState<{ key: string; status: "ready"; width: number; height: number } | { key: string; status: "failed" } | null>(null);
  const ready = imageState?.key === imageKey && imageState.status === "ready";
  const failed = imageState?.key === imageKey && imageState.status === "failed";
  const readOnly = useValue(`image-readonly-${shape.id}`, () => editor.getIsReadonly(), [editor, shape.id]);
  useEffect(() => {
    if (exporting || readOnly || imageState?.status !== "ready" || imageState.key !== imageKey || !source) return;
    const current = editor.getShape<ImageShape>(shape.id);
    if (!current || current.props.url !== source ||
      current.props.imageSource === source && current.props.imageWidth === imageState.width && current.props.imageHeight === imageState.height) return;
    editor.store.mergeRemoteChanges(() => editor.run(() => editor.updateShape({
      id: shape.id, type: IMAGE_SHAPE_TYPE, props: {
        imageWidth: imageState.width, imageHeight: imageState.height, imageSource: source,
        ...(!current.props.pixelWidth && !isThumbnailUrl(source) ? { pixelWidth: imageState.width, pixelHeight: imageState.height } : {}),
      },
    }), { ignoreShapeLock: true, history: "ignore" }));
  }, [editor, exporting, imageKey, imageState, readOnly, shape.id, source]);
  const nearViewport = useValue(`image-visible-${shape.id}`, () => {
    const bounds = editor.getShapePageBounds(shape);
    return Boolean(bounds && Box.Collides(editor.getViewportPageBounds(), bounds));
  }, [editor, shape.id]);
  const generation = shape.props.generationTaskId && !shape.props.url;
  const status = shape.props.generationStatus ?? "running";
  const statusLabel = GENERATION_STATUS_LABELS[status] ?? status;
  const imageBounds = imageShapeBounds(shape);
  return <CanvasImageSurface shapeId={shape.id} title={shape.props.title || "图片"} bounds={imageBounds}
    pixelWidth={shape.props.pixelWidth || (!isThumbnailUrl(source) ? shape.props.imageWidth : undefined)}
    pixelHeight={shape.props.pixelHeight || (!isThumbnailUrl(source) ? shape.props.imageHeight : undefined)}
    nodeId={typeof shape.meta.canvasNodeId === "string" ? shape.meta.canvasNodeId : undefined}>
    {generation ? <div aria-label={statusLabel} className={surface.placeholder} role="status">
      <strong>{statusLabel}</strong>{shape.props.generationError ? <p>{shape.props.generationError}</p> : null}
    </div> : !source || !exporting && !ready ? <div className={surface.placeholder}>
      <span>{failed ? "图片暂不可用" : source ? "正在载入图片" : "图片尚未就绪"}</span>
      {failed ? <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setRetry((value) => value + 1); }}>重新加载图片</button> : null}
    </div> : null}
    {(exporting || nearViewport) && source ? (
      // Private original images remain unfiltered and uncropped.
      // eslint-disable-next-line @next/next/no-img-element
      <img key={imageKey} alt="" draggable={false} hidden={!exporting && failed} loading={exporting ? "eager" : "lazy"}
        src={exporting ? preparedCanvasImage(editor, source) : source}
        onError={() => { if (!exporting && currentImageKey.current === imageKey) setImageState({ key: imageKey, status: "failed" }); }}
        onLoad={(event) => {
          if (exporting || currentImageKey.current !== imageKey) return;
          const size = readCanvasImageDimensions(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
          if (size) setImageState({ key: imageKey, status: "ready", ...size });
        }} />
    ) : null}
    {(shape.props.uploadStatus ?? "ready") !== "ready" ? <span className={styles.uploadStatus} data-status={shape.props.uploadStatus}>{shape.props.uploadStatus === "failed" ? "上传失败" : "正在处理"}</span> : null}
  </CanvasImageSurface>;
}

export class ImageShapeUtil extends BaseBoxShapeUtil<ImageShape> {
  static override type = IMAGE_SHAPE_TYPE;
  static override props: RecordProps<ImageShape> = {
    // Legacy fields are decoded for old snapshots; none select a visual skin.
    appearance: T.any.optional(), mounts: T.any.optional(), role: T.string,
    roleConfidence: T.number.optional(), roleInferenceState: T.string.optional(), roleLabel: T.string.optional(), roleSource: T.string.optional(),
    assetId: T.string.optional(), fileId: T.string.optional(), generationCandidateId: T.string.optional(),
    generationError: T.string.optional(), generationPrompt: T.string.optional(), generationStatus: T.string.optional(), generationTaskId: T.string.optional(),
    w: T.number, h: T.number, imageWidth: T.number.optional(), imageHeight: T.number.optional(), imageSource: T.string.optional(),
    pixelWidth: T.number.optional(), pixelHeight: T.number.optional(), title: T.string, uploadStatus: T.string.optional(), url: T.string,
  };
  override getDefaultProps(): ImageShape["props"] { return { fileId: "", h: 260, w: 340, role: "reference", title: "图片", uploadStatus: "ready", url: "" }; }
  override isAspectRatioLocked() { return true; }
  override canCull() { return false; }
  override canResize() { return true; }
  override hideSelectionBoundsBg() { return true; }
  override hideSelectionBoundsFg() { return true; }
  override hideRotateHandle() { return true; }
  override getGeometry(shape: ImageShape) {
    const bounds = imageShapeBounds(shape);
    return new Rectangle2d({ x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h, isFilled: true });
  }
  override component(shape: ImageShape) { return <ImageShapeContent shape={shape} />; }
  override getIndicatorPath(shape: ImageShape): Path2D {
    const bounds = imageShapeBounds(shape), path = new Path2D();
    path.roundRect(bounds.x, bounds.y, bounds.w, bounds.h, Math.min(16, bounds.w / 4, bounds.h / 4));
    return path;
  }
}
const GENERATION_STATUS_LABELS: Readonly<Record<string, string>> = { canceled: "生成已停止", failed: "生成失败", moderation_failed: "未通过内容审核", queued: "正在排队", running: "正在生成", succeeded: "生成完成" };
