import type { CSSProperties, ReactNode } from "react";
import { HTMLContainer, useEditor, useSvgExportContext, useValue, type TLShapeId } from "tldraw";
import styles from "./canvas-image-surface.module.css";
import nameStyles from "./canvas-node-name.module.css";
import { imageDisplayTitle } from "../image-display-title";

/** One presentation for every picture; historical purpose and material skins are ignored. */
export function CanvasImageSurface({ shapeId, title, bounds, pixelWidth, pixelHeight, nodeId, creationId, detail, children }: {
  shapeId: TLShapeId; title: string; bounds: { x: number; y: number; w: number; h: number };
  pixelWidth?: number | undefined; pixelHeight?: number | undefined; nodeId?: string | undefined; creationId?: string | undefined; children: ReactNode;
  detail?: string | undefined;
}) {
  const editor = useEditor();
  title = imageDisplayTitle(title);
  const exporting = Boolean(useSvgExportContext());
  const state = useValue(`image-surface-${shapeId}`, () => ({ zoom: editor.getZoomLevel(), selected: editor.getSelectedShapeIds().includes(shapeId), hovered: editor.getHoveredShapeId() === shapeId }), [editor, shapeId]);
  const zoom = Math.max(.01, state.zoom);
  const captionWidth = Math.max(state.selected ? 160 : 0, bounds.w * zoom);
  return <HTMLContainer className={styles.surface} style={{ left: bounds.x, top: bounds.y, width: bounds.w, height: bounds.h }} role="group" aria-label={title} data-canvas-image="plain" data-canvas-node-id={nodeId} data-creation-id={creationId}>
    {!exporting && (captionWidth >= 80 || state.selected) ? <div className={styles.caption} data-image-caption style={{ width: captionWidth, transform: `scale(${1 / zoom})`, bottom: `calc(100% + ${7 / zoom}px)` }}>
      <span className={styles.name}><svg aria-hidden="true" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="3.5" width="15" height="13" rx="2" /><circle cx="7" cy="8" r="1.3" /><path d="m3 14 4-4 3 3 3-4 4 5" /></svg><span className={nameStyles.name} title={title || "图片"}>{title || "图片"}</span></span>
      {captionWidth >= 190 ? <span className={styles.dimensions}>{pixelWidth && pixelHeight ? `${pixelWidth} × ${pixelHeight}` : detail ?? "尺寸未记录"}</span> : null}
    </div> : null}
    <div className={styles.picture} data-selected={!exporting && state.selected} data-hovered={!exporting && state.hovered} style={{ borderRadius: Math.min(16, bounds.w / 4, bounds.h / 4), "--image-outline-width": `${1 / zoom}px` } as CSSProperties}>{children}</div>
  </HTMLContainer>;
}
