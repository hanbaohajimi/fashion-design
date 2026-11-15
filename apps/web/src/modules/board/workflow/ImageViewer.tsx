"use client";
import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  imageAnnotationsSvg,
  rotatedImageSize,
  type ImageAnnotation,
  type ImageComment,
  type ImageCommentMarker,
  hasImageAdjustments,
  imageAdjustmentMatrix,
  type ImageAdjustments,
} from "@fashion/shared";
import styles from "./image-workspace.module.css";
import { useImageViewport } from "./use-image-viewport";
import type { ImageOrientation } from "./image-orientation";
import { moveOutpaintFrame, resizeOutpaintFrame } from "./image-outpaint";
import { startImageGeometryDrag } from "./image-geometry-drag";
import { ImageOverlayInteractionContext } from "./image-overlay-interaction";

export interface ImageSize {
  width: number;
  height: number;
}
export interface ImageRect extends ImageSize {
  left: number;
  top: number;
}
const distance = (points: { x: number; y: number }[]) =>
  points[0] && points[1]
    ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
    : 0;
export function ImageViewer({
  url,
  title,
  zoom,
  onZoom,
  onSize,
  annotations,
  comments,
  mode,
  pen,
  onAnnotation,
  onPoint,
  frame,
  onFrame,
  crop,
  onCrop,
  previousUrl,
  nextUrl,
  onNavigate,
  orientation,
  onLoadError,
  previewLabel,
  commentDraft,
  editingCommentId,
  selectedCommentIds = [],
  commentsLocked = false,
  onSelectComment,
  adjustments,
  geometryLocked = false,
  imageOverlay,
}: {
  url: string;
  title: string;
  zoom: number | null;
  onZoom: (zoom: number | null) => void;
  onSize: (size: ImageSize) => void;
  annotations: ImageAnnotation[];
  comments: ImageComment[];
  mode: string;
  pen: {
    kind: ImageAnnotation["kind"];
    color: string;
    width: number;
    text: string;
  };
  onAnnotation: (annotation: ImageAnnotation) => void;
  onPoint: (point: { x: number; y: number }) => void;
  frame?:
    { width: number; height: number; left: number; top: number } | undefined;
  onFrame?:
    | ((frame: {
        width: number;
        height: number;
        left: number;
        top: number;
      }) => void)
    | undefined;
  crop?: ImageRect | undefined;
  onCrop?: ((crop: ImageRect) => void) | undefined;
  previousUrl?: string | undefined;
  nextUrl?: string | undefined;
  onNavigate?: ((direction: -1 | 1) => void) | undefined;
  orientation?: ImageOrientation | undefined;
  onLoadError?: (() => void) | undefined;
  previewLabel?: string | undefined;
  commentDraft?: ImageCommentMarker | undefined;
  editingCommentId?: string | null | undefined;
  selectedCommentIds?: readonly string[];
  commentsLocked?: boolean;
  onSelectComment?: ((id: string) => void) | undefined;
  adjustments?: ImageAdjustments | undefined;
  geometryLocked?: boolean;
  imageOverlay?: ((size: ImageSize, scale: number) => ReactNode) | undefined;
}) {
  const adjustmentId = `image-adjust-${useId()}`;
  const geometryHintId = useId();
  const viewHintId = useId();
  const adjusted = adjustments && hasImageAdjustments(adjustments);
  const host = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLDivElement>(null);
  const frameElement = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ImageSize>({ width: 768, height: 1024 });
  const [bounds, setBounds] = useState({ width: 800, height: 600 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<ImageAnnotation | null>(null);
  const drawing = useRef<ImageAnnotation | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pendingPoint = useRef<{ id: number; x: number; y: number; point: { x: number; y: number } } | null>(null);
  const gesture = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
    distance: number;
    scale: number;
  } | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const overlayInteracting = useRef(false);
  const hasFrame = Boolean(frame);
  useEffect(() => () => dragCleanup.current?.(), [mode, url, hasFrame, geometryLocked]);
  const drag = (event: PointerEvent<HTMLElement>, move: (event: globalThis.PointerEvent) => void, rollback: () => void) => {
    event.stopPropagation();
    if (event.button !== 0 || !event.isPrimary || geometryLocked || dragCleanup.current) return;
    dragCleanup.current = startImageGeometryDrag(event, move, rollback, () => { dragCleanup.current = null; });
  };
  const display = orientation ? rotatedImageSize(size.width, size.height, orientation.rotate) : frame ?? size;
  const fit = Math.min(
    (bounds.width - (frame || crop ? 56 : 32)) / display.width,
    (bounds.height - (frame || crop ? 56 : 32)) / display.height,
    1,
  );
  const scale = zoom === null ? Math.max(0.01, fit) : zoom / 100;
  const viewport = useImageViewport({ enabled: mode === "view" || mode === "orient" || mode === "adjust" || mode === "text_edit", url, scale, fit: Math.max(.01, fit), size: display, bounds, host, frame: frameElement, onCommit: (next, nextPan, fitted) => { setPan({ x: nextPan.x, y: nextPan.y }); onZoom(fitted ? null : next * 100); }, previous: Boolean(previousUrl), next: Boolean(nextUrl), onNavigate });
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setBounds({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const point = (event: PointerEvent) => {
    const box = media.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
    };
  };
  const pinStyle = (value: { x: number; y: number }) => ({
    left: `clamp(calc(22px / var(--image-scale, ${scale})), ${value.x * 100}%, calc(100% - 22px / var(--image-scale, ${scale})))`,
    top: `clamp(calc(22px / var(--image-scale, ${scale})), ${value.y * 100}%, calc(100% - 22px / var(--image-scale, ${scale})))`,
    transform: `translate(-50%, -50%) scale(calc(1 / var(--image-scale, ${scale})))`,
  });
  const svg = imageAnnotationsSvg(
    [...annotations, ...(draft ? [draft] : [])],
    size.width,
    size.height,
  );
  return (
    <div
      className={styles.viewport}
      ref={host}
      aria-label="图片查看区域"
      tabIndex={0}
      aria-keyshortcuts="F"
      aria-describedby={viewHintId}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || event.nativeEvent.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.key.toLowerCase() !== "f" || dragCleanup.current || overlayInteracting.current) return;
        event.preventDefault(); event.stopPropagation();
        if (["view", "orient", "adjust", "text_edit"].includes(mode)) viewport.fit();
        else { onZoom(null); setPan({ x: 0, y: 0 }); }
      }}
      onPointerDownCapture={event => {
        const input = document.activeElement;
        if ((frame || crop) && event.button === 0 && !dragCleanup.current && input instanceof HTMLInputElement && input.type === "number" && input.closest('[role="dialog"]') === event.currentTarget.closest('[role="dialog"]')) {
          // Commit the numeric field before the bubbling drag reads its starting frame.
          flushSync(() => input.blur());
        }
        if (event.button === 0 && !(event.target instanceof Element && event.target.closest("button,input,textarea,select,a,[contenteditable]"))) event.currentTarget.focus({ preventScroll: true });
      }}
      onDoubleClick={(event) => { if (!overlayInteracting.current && !(event.target instanceof Element && event.target.closest("button"))) viewport.onDoubleClick(event); }}
      onWheel={(event) => {
        if (dragCleanup.current || overlayInteracting.current) return;
        if (viewport.onWheel(event)) return;
        if (mode === "annotate" || mode === "comment") return;
        onZoom(
          Math.max(
            10,
            Math.min(400, scale * 100 * (event.deltaY > 0 ? 0.9 : 1.1)),
          ),
        );
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || error) return;
        if (dragCleanup.current || overlayInteracting.current) return;
        if (viewport.onPointerDown(event)) return;
        if (event.target instanceof Element && event.target.closest("button"))
          return;
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
        });
        if (mode === "annotate" && pointers.current.size === 1) {
          const a = { ...pen, id: crypto.randomUUID(), points: [point(event)] };
          if (a.kind === "text") {
            if (a.text.trim()) onAnnotation(a);
            return;
          }
          drawing.current = a;
          setDraft(a);
          return;
        }
        if (mode === "comment") {
          const box = media.current?.getBoundingClientRect();
          pendingPoint.current = !commentsLocked && pointers.current.size === 1 && box && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom
            ? { id: event.pointerId, x: event.clientX, y: event.clientY, point: point(event) } : null;
          return;
        }
        const positions = [...pointers.current.values()];
        gesture.current = {
          x: event.clientX,
          y: event.clientY,
          panX: pan.x,
          panY: pan.y,
          distance: distance(positions),
          scale,
        };
      }}
      onPointerMove={(event) => {
        if (viewport.onPointerMove(event)) return;
        if (!pointers.current.has(event.pointerId)) return;
        pointers.current.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
        });
        const placement = pendingPoint.current;
        if (placement && Math.hypot(event.clientX - placement.x, event.clientY - placement.y) > 6) pendingPoint.current = null;
        if (drawing.current) {
          const a = drawing.current;
          const p = point(event);
          drawing.current = {
            ...a,
            points:
              a.kind === "pen"
                ? [...a.points, p].slice(-4000)
                : [a.points[0] ?? p, p],
          };
          setDraft(drawing.current);
          return;
        }
        const g = gesture.current;
        if (!g) return;
        const positions = [...pointers.current.values()];
        if (positions.length === 2 && g.distance) {
          onZoom(
            Math.max(
              10,
              Math.min(400, (g.scale * 100 * distance(positions)) / g.distance),
            ),
          );
          return;
        }
        setPan({
          x: g.panX + event.clientX - g.x,
          y: g.panY + event.clientY - g.y,
        });
      }}
      onPointerUp={(event) => {
        if (viewport.onPointerUp(event)) return;
        pointers.current.delete(event.pointerId);
        const placement = pendingPoint.current;
        pendingPoint.current = null;
        if (mode === "comment" && !commentsLocked && placement?.id === event.pointerId && Math.hypot(event.clientX - placement.x, event.clientY - placement.y) <= 6) onPoint(placement.point);
        gesture.current = null;
        if (drawing.current) {
          onAnnotation(drawing.current);
          drawing.current = null;
          setDraft(null);
        }
      }}
      onPointerCancel={(event) => {
        if (viewport.onPointerCancel()) return;
        pointers.current.delete(event.pointerId);
        pendingPoint.current = null;
        gesture.current = null;
        drawing.current = null;
        setDraft(null);
      }}
      onLostPointerCapture={() => { pendingPoint.current = null; viewport.onPointerCancel(); }}
    >
      {mode === "view" && onNavigate ? <div className={styles.galleryNeighbors} aria-hidden="true" data-gallery-neighbors>
        {/* eslint-disable @next/next/no-img-element */}
        {previousUrl ? <img src={previousUrl} alt="" draggable={false} data-side="previous" /> : null}
        {nextUrl ? <img src={nextUrl} alt="" draggable={false} data-side="next" /> : null}
        {/* eslint-enable @next/next/no-img-element */}
      </div> : null}
      <div
        className={styles.frame}
        ref={frameElement}
        data-image-preview={previewLabel}
        style={{
          width: display.width,
          height: display.height,
          transform: `translate(-50%, -50%) translate(calc(var(--image-x, ${pan.x}px) + var(--gallery-x, 0px)), var(--image-y, ${pan.y}px)) scale(var(--image-scale, ${scale}))`,
        }}
      >
        <div
          ref={media}
          data-orientation={orientation ? JSON.stringify(orientation) : undefined}
          className={styles.imageMedia}
          style={{
            width: size.width,
            height: size.height,
            left: orientation ? (display.width - size.width) / 2 : frame?.left ?? 0,
            top: orientation ? (display.height - size.height) / 2 : frame?.top ?? 0,
            transform: orientation ? `scale(${orientation.flipHorizontal ? -1 : 1}, ${orientation.flipVertical ? -1 : 1}) rotate(${orientation.rotate}deg)` : undefined,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={reload}
            src={url}
            alt={title}
            draggable={false}
            data-image-adjustments={adjustments ? JSON.stringify(adjustments) : undefined}
            style={adjusted ? { filter: `url("#${adjustmentId}")` } : undefined}
            onLoad={(e) => {
              const next = {
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              };
              setSize(next);
              onSize(next);
              setError(false);
            }}
            onError={() => { setError(true); onLoadError?.(); }}
          />
          <ImageOverlayInteractionContext.Provider value={(active) => {
            overlayInteracting.current = active;
            if (active) viewport.onPointerCancel();
          }}>
            {imageOverlay?.(size, scale)}
          </ImageOverlayInteractionContext.Provider>
          {frame ? <button type="button" className={styles.outpaintMove}
            aria-label="移动扩图原图" aria-describedby={geometryHintId} disabled={geometryLocked || error}
            onKeyDown={event => {
              const dx = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
              const dy = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
              if (!dx && !dy) return;
              event.preventDefault();
              onFrame?.(moveOutpaintFrame(frame, size, frame.left + dx * (event.shiftKey ? 10 : 1), frame.top + dy * (event.shiftKey ? 10 : 1)));
            }}
            onPointerDown={event => {
              const start = { x: event.clientX, y: event.clientY };
              drag(event, next => onFrame?.(moveOutpaintFrame(frame, size,
                frame.left + (next.clientX - start.x) / scale,
                frame.top + (next.clientY - start.y) / scale)), () => onFrame?.(frame));
            }} /> : null}
          {adjusted ? <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
            <defs><filter id={adjustmentId} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values={imageAdjustmentMatrix(adjustments).join(" ")} />
            </filter></defs>
          </svg> : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            hidden={mode === "orient" || mode === "adjust" || mode === "text_edit"}
            className={styles.annotations}
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
            alt="图片标注"
            draggable={false}
          />
          {(mode === "orient" || mode === "adjust" || mode === "text_edit" ? [] : comments).map((comment, index) =>
            comment.point && !(mode === "comment" && editingCommentId === comment.id) ? (
              <button
                type="button"
                className={styles.pin}
                key={comment.id}
                title={comment.text}
                aria-label={`编辑图片标记 ${index + 1}：${comment.text}`}
                data-selected={selectedCommentIds.includes(comment.id)}
                disabled={commentsLocked || !onSelectComment}
                onClick={() => onSelectComment?.(comment.id)}
                style={pinStyle(comment.point)}
              >
                <span>{index + 1}</span>
              </button>
            ) : null,
          )}
          {mode === "comment" && commentDraft ? <button type="button" className={styles.pin}
            data-draft="true" style={pinStyle(commentDraft.point)} disabled={commentsLocked}
            aria-label={`调整标记 ${commentDraft.number}（草稿），方向键微调，Shift 加快`}
            onKeyDown={event => {
              const dx = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
              const dy = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
              if (!dx && !dy) return;
              event.preventDefault(); event.stopPropagation();
              const step = event.shiftKey ? .1 : .01;
              onPoint({ x: Math.max(0, Math.min(1, commentDraft.point.x + dx * step)), y: Math.max(0, Math.min(1, commentDraft.point.y + dy * step)) });
            }}><span>{commentDraft.number}</span></button> : null}
          {crop ? (
            <div
              className={styles.crop}
              style={{
                left: crop.left,
                top: crop.top,
                width: crop.width,
                height: crop.height,
              }}
            >
              <button
                className={styles.cropMove}
                aria-label="移动裁剪区域"
                disabled={geometryLocked}
                onKeyDown={(event) => {
                  const dx =
                    event.key === "ArrowRight"
                      ? 1
                      : event.key === "ArrowLeft"
                        ? -1
                        : 0;
                  const dy =
                    event.key === "ArrowDown"
                      ? 1
                      : event.key === "ArrowUp"
                        ? -1
                        : 0;
                  if (!dx && !dy) return;
                  event.preventDefault();
                  onCrop?.({
                    ...crop,
                    left: Math.max(
                      0,
                      Math.min(
                        size.width - crop.width,
                        crop.left + dx * (event.shiftKey ? 10 : 1),
                      ),
                    ),
                    top: Math.max(
                      0,
                      Math.min(
                        size.height - crop.height,
                        crop.top + dy * (event.shiftKey ? 10 : 1),
                      ),
                    ),
                  });
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  const start = { x: event.clientX, y: event.clientY };
                  drag(event, (e) =>
                    onCrop?.({
                      ...crop,
                      left: Math.round(
                        Math.max(
                          0,
                          Math.min(
                            size.width - crop.width,
                            crop.left + (e.clientX - start.x) / scale,
                          ),
                        ),
                      ),
                      top: Math.round(
                        Math.max(
                          0,
                          Math.min(
                            size.height - crop.height,
                            crop.top + (e.clientY - start.y) / scale,
                          ),
                        ),
                      ),
                    }), () => onCrop?.(crop),
                  );
                }}
              />
              <button
                className={styles.frameHandle}
                aria-label="调整裁剪区域"
                disabled={geometryLocked}
                style={{ transform: `translate(50%, 50%) scale(${1 / scale})` }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  const start = { x: event.clientX, y: event.clientY };
                  drag(event, (e) =>
                    onCrop?.({
                      ...crop,
                      width: Math.round(
                        Math.max(
                          1,
                          Math.min(
                            size.width - crop.left,
                            crop.width + (e.clientX - start.x) / scale,
                          ),
                        ),
                      ),
                      height: Math.round(
                        Math.max(
                          1,
                          Math.min(
                            size.height - crop.top,
                            crop.height + (e.clientY - start.y) / scale,
                          ),
                        ),
                      ),
                    }), () => onCrop?.(crop),
                  );
                }}
              />
            </div>
          ) : null}
        </div>
        {frame ? (
          <button
            className={styles.frameHandle}
            aria-label="拖动扩图边界"
            aria-describedby={geometryHintId}
            disabled={geometryLocked || error}
            style={{ transform: `translate(50%, 50%) scale(${1 / scale})` }}
            onKeyDown={event => {
              const dx = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
              const dy = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
              if (!dx && !dy) return;
              event.preventDefault();
              const step = event.shiftKey ? 64 : 16;
              onFrame?.(resizeOutpaintFrame(frame, size, frame.width + dx * step, frame.height + dy * step));
            }}
            onPointerDown={(event) => {
              const start = { x: event.clientX, y: event.clientY, ...frame };
              drag(event, next => {
                const value = resizeOutpaintFrame(frame, size, start.width + (next.clientX - start.x) / scale, start.height + (next.clientY - start.y) / scale);
                // Keep the top-left corner still while dragging, including fitted views.
                onZoom(scale * 100);
                setPan({ x: pan.x + (value.width - start.width) * scale / 2, y: pan.y + (value.height - start.height) * scale / 2 });
                onFrame?.(value);
              }, () => { onFrame?.(frame); onZoom(zoom); setPan(pan); });
            }}
          />
        ) : null}
      </div>
      <span className={styles.srOnly} id={viewHintId}>滚轮或双指缩放；浏览时双击切换细节与全图；聚焦图片后按 F 恢复全图。</span>
      {frame ? <span className={styles.srOnly} id={geometryHintId}>方向键微调，Shift 加快；拖动时按 Escape 撤回。</span> : null}
      {previewLabel ? <span className={styles.previewStatus}>{previewLabel}</span> : null}
      {error ? (
        <div className={styles.loadError} role="alert">
          图片加载失败{" "}
          <button
            onClick={() => {
              setError(false);
              setReload((n) => n + 1);
            }}
          >
            重试
          </button>
        </div>
      ) : null}
    </div>
  );
}
