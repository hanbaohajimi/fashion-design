"use client";
import { BaseBoxShapeUtil, Box, Rectangle2d, T, useEditor, useSvgExportContext, useValue, type TLShape } from "tldraw";
import { useState } from "react";
import { CanvasImageSurface } from "../shapes/CanvasImageSurface";
import { imageContentBounds } from "../shapes/image-presentation";
import { preparedCanvasImage } from "./canvas-export-images";
import { readCanvasImageDimensions } from "./canvas-image-sizing";
import { creationStatusLabel } from "./creation-status";
import type { CreationRunView } from "@fashion/shared";
import styles from "../shapes/canvas-image-surface.module.css";
import { RefineFrame, refineStatus } from "../../../components/RefineFrame";
import { WorkspaceIcon } from "./WorkspaceIcon";
import emptyStyles from "./empty-creation.module.css";
import nodeStyles from "./node-entry.module.css";
import { CanvasVideoPlayer } from "./CanvasVideoPlayer";

export const CREATION_SHAPE_TYPE = "fashion-creation";
declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    "fashion-creation": { w: number; h: number; creationId: string; title: string; module: string; imageUrl: string; text: string; status: string; pixelWidth?: number; pixelHeight?: number; mediaUrl?: string; textMode?: string; draftText?: string };
  }
}
export type CreationShape = TLShape<typeof CREATION_SHAPE_TYPE>;
function boundsFor(shape: CreationShape) { return imageContentBounds(shape.props.w, shape.props.h, shape.props.imageUrl ? shape.props.pixelWidth : undefined, shape.props.imageUrl ? shape.props.pixelHeight : undefined); }
export class CreationShapeUtil extends BaseBoxShapeUtil<CreationShape> {
  static override type = CREATION_SHAPE_TYPE;
  static override props = { w: T.number, h: T.number, creationId: T.string, title: T.string, module: T.string, imageUrl: T.string, text: T.string, status: T.string, pixelWidth: T.number.optional(), pixelHeight: T.number.optional(), mediaUrl: T.string.optional(), textMode: T.string.optional(), draftText: T.string.optional() };
  override getDefaultProps(): CreationShape["props"] { return { w: 340, h: 440, creationId: "", title: "新图片", module: "image", imageUrl: "", text: "", status: "draft" }; }
  override canEdit() { return false; }
  override hideSelectionBoundsBg() { return true; }
  override hideSelectionBoundsFg() { return true; }
  override hideRotateHandle() { return true; }
  override isAspectRatioLocked(shape: CreationShape) { return shape.props.module !== "text"; }
  override getGeometry(shape: CreationShape) { const bounds = boundsFor(shape); return new Rectangle2d({ x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h, isFilled: true }); }
  override component(shape: CreationShape) { return <CreationShapeContent shape={shape} />; }
  override getIndicatorPath(shape: CreationShape): Path2D { const bounds = boundsFor(shape), path = new Path2D(); path.roundRect(bounds.x, bounds.y, bounds.w, bounds.h, Math.min(16, bounds.w / 4, bounds.h / 4)); return path; }
}
function CreationShapeContent({ shape }: { shape: CreationShape }) {
  const exporting = Boolean(useSvgExportContext());
  const frameStatus = refineStatus(shape.props.status);
  const imageModule = ["image", "experiment", "print", "presentation", "wardrobe", "tryon"].includes(shape.props.module) || Boolean(shape.props.imageUrl);
  const showFrame = !exporting && imageModule && frameStatus;
  const status = shape.props.module === "video" ? shape.props.mediaUrl ? "已导入" : "待导入" : shape.props.status === "draft" ? shape.props.module === "text" ? "待编写" : "待创作" : creationStatusLabel(shape.props.status as CreationRunView["status"]) ?? shape.props.status;
  const content = shape.props.module === "text" && (shape.props.textMode === "manual" || shape.props.text) ? <CreationText shape={shape} exporting={exporting} /> : shape.props.module === "video" && shape.props.mediaUrl ? <CreationVideo shape={shape} /> : shape.props.imageUrl ? <CreationImage key={shape.props.imageUrl} shape={shape} /> : ["image", "text", "video"].includes(shape.props.module) && shape.props.status === "draft" && !exporting ? <EmptyImageCreation shape={shape} /> : <div className={styles.placeholder}><strong>{shape.props.title}</strong><p>{shape.props.text || "连接参考材料，输入本次要求"}</p></div>;
  return <CanvasImageSurface shapeId={shape.id} title={shape.props.title} bounds={boundsFor(shape)} pixelWidth={shape.props.pixelWidth} pixelHeight={shape.props.pixelHeight}
    creationId={shape.props.creationId} nodeId={typeof shape.meta.canvasNodeId === "string" ? shape.meta.canvasNodeId : undefined} detail={shape.props.imageUrl ? undefined : status}>
    {showFrame ? <RefineFrame status={frameStatus} imageKey={shape.props.imageUrl} previousResult={Boolean(shape.props.imageUrl)} fill>{shape.props.imageUrl ? content : null}</RefineFrame> : content}
    {!exporting && !showFrame && ["preparing", "queued", "running", "failed"].includes(shape.props.status) ? <div role="status" className={styles.status}>{status}</div> : null}
  </CanvasImageSurface>;
}
function EmptyImageCreation({ shape }: { shape: CreationShape }) {
  const editor = useEditor();
  const state = useValue(`empty-creation-${shape.id}`, () => ({ zoom: editor.getZoomLevel(), readonly: editor.getIsReadonly() || editor.isShapeOrAncestorLocked(shape) }), [editor, shape]);
  const compact = shape.props.h * state.zoom < 180;
  const act = (action: string) => editor.getContainer().dispatchEvent(new CustomEvent("fashion-creation:prepare", { detail: { creationId: shape.props.creationId, action } }));
  return <div className={emptyStyles.empty}>
    {!compact ? <WorkspaceIcon name={shape.props.module === "video" ? "video" : shape.props.module === "text" ? "text_edit" : "image"} /> : null}
    <div className={emptyStyles.actions} style={{ transform: `scale(${1 / Math.max(.05, state.zoom)})`, maxWidth: Math.max(100, shape.props.w * state.zoom - 32) }}>
      {!compact ? <span>{shape.props.module === "video" ? "添加视频" : "开始创作"}</span> : null}
      {shape.props.module === "text" ? <><button disabled={state.readonly} onPointerDown={event => event.stopPropagation()} onClick={() => act("manual")}><WorkspaceIcon name="text_edit" />自己编写内容</button><button disabled={state.readonly} onPointerDown={event => event.stopPropagation()} onClick={() => act("ai")}><WorkspaceIcon name="annotate" />AI 起草</button></> : shape.props.module === "video" ? <><button disabled={state.readonly} onPointerDown={event => event.stopPropagation()} onClick={() => act("video-upload")}><WorkspaceIcon name="add" />上传视频</button><button disabled={state.readonly} onPointerDown={event => event.stopPropagation()} onClick={() => act("video-existing")}><WorkspaceIcon name="video" />选择已有视频</button></> : <>
      <button type="button" disabled={state.readonly} onPointerDown={event => event.stopPropagation()} onClick={() => act("prompt")}><WorkspaceIcon name="annotate" />描述画面</button>
      {!compact ? <><button type="button" disabled={state.readonly} onPointerDown={event => event.stopPropagation()} onClick={() => act("upload")}><WorkspaceIcon name="add" />上传参考图</button><button type="button" disabled={state.readonly} onPointerDown={event => event.stopPropagation()} onClick={() => act("reference")}><WorkspaceIcon name="reference" />选择画布参考</button></> : null}
      </>}
    </div>
  </div>;
}
function CreationText({ shape, exporting }: { shape: CreationShape; exporting: boolean }) {
  const editor = useEditor();
  const state = useValue(`text-scale-${shape.id}`, () => ({ zoom: editor.getZoomLevel(), selected: editor.getSelectedShapeIds().includes(shape.id), compact: editor.getViewportScreenBounds().w < 700 }), [editor, shape.id]);
  const scale = exporting || !state.selected ? 1 : 1 / Math.max(.05, state.zoom);
  return <div className={nodeStyles.textBody} style={{ fontSize: (state.compact && !exporting ? 16 : 15) * scale, padding: 14 * scale }}>{shape.props.text || (!exporting ? "选择节点后编写文本" : "")}</div>;
}
function CreationVideo({ shape }: { shape: CreationShape }) {
  const editor = useEditor();
  const zoom = useValue(`video-zoom-${shape.id}`, () => editor.getZoomLevel(), [editor]);
  const visible = useValue(`video-target-${shape.id}`, () => { const bounds = editor.getShapePageBounds(shape.id); return !editor.isShapeHidden(shape.id) && Boolean(bounds && Box.Collides(editor.getViewportPageBounds(), bounds)); }, [editor, shape.id]);
  return <CanvasVideoPlayer key={shape.props.mediaUrl} id={shape.id} url={shape.props.mediaUrl ?? ""} title={shape.props.title} visible={visible} zoom={zoom} />;
}
function CreationImage({ shape }: { shape: CreationShape }) {
  const editor = useEditor();
  const exporting = Boolean(useSvgExportContext());
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return failed ? <div className={styles.placeholder}><strong>图片暂时无法显示</strong><button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setAttempt((value) => value + 1); setFailed(false); }}>重新载入</button></div>
    // Private output images use verified original bytes for canvas export.
    // eslint-disable-next-line @next/next/no-img-element
    : <img key={attempt} src={exporting ? preparedCanvasImage(editor, shape.props.imageUrl) : shape.props.imageUrl} alt={shape.props.title} draggable={false} loading={exporting ? "eager" : "lazy"} onError={() => setFailed(true)} onLoad={(event) => {
      if (exporting || editor.getIsReadonly() || shape.props.pixelWidth && shape.props.pixelHeight) return;
      const size = readCanvasImageDimensions(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight); if (!size) return;
      editor.store.mergeRemoteChanges(() => editor.run(() => editor.updateShape<CreationShape>({ id: shape.id, type: CREATION_SHAPE_TYPE, props: { pixelWidth: size.width, pixelHeight: size.height } }), { ignoreShapeLock: true, history: "ignore" }));
    }} />;
}
