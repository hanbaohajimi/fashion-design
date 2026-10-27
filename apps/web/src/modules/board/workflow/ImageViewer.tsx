"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  imageAnnotationsSvg,
  type ImageAnnotation,
  type ImageComment,
} from "@fashion/shared";
import styles from "./image-workspace.module.css";
import { useImageViewport } from "./use-image-viewport";

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
  onZoomPreview,
  previousUrl,
  nextUrl,
  onNavigate,
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
  onZoomPreview?: ((percent: number | null) => void) | undefined;
  previousUrl?: string | undefined;
  nextUrl?: string | undefined;
  onNavigate?: ((direction: -1 | 1) => void) | undefined;
}) {
  const host = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLDivElement>(null);
  const frameElement = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<ImageSize>({ width: 768, height: 1024 });
  const [bounds, setBounds] = useState({ width: 800, height: 600 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<ImageAnnotation | null>(null);
  const drawing = useRef<ImageAnnotation | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
    distance: number;
    scale: number;
  } | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);
  const drag = (move: (event: globalThis.PointerEvent) => void) => {
    dragCleanup.current?.();
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      dragCleanup.current = null;
    };
    dragCleanup.current = up;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", up, { once: true });
  };
  const display = frame ?? size;
  const fit = Math.min(
    (bounds.width - 32) / display.width,
    (bounds.height - 32) / display.height,
    1,
  );
  const scale = zoom === null ? Math.max(0.01, fit) : zoom / 100;
  const viewport = useImageViewport({ enabled: mode === "view", url, scale, fit: Math.max(.01, fit), size: display, bounds, host, frame: frameElement, readout, onCommit: (next, nextPan, fitted) => { setPan({ x: nextPan.x, y: nextPan.y }); onZoom(fitted ? null : next * 100); }, onPreview: onZoomPreview, previous: Boolean(previousUrl), next: Boolean(nextUrl), onNavigate });
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
      onDoubleClick={(event) => { if (!(event.target instanceof Element && event.target.closest("button"))) viewport.onDoubleClick(event); }}
      onWheel={(event) => {
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
          onPoint(point(event));
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
        gesture.current = null;
        drawing.current = null;
        setDraft(null);
      }}
      onLostPointerCapture={() => viewport.onPointerCancel()}
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
        style={{
          width: display.width,
          height: display.height,
          transform: `translate(-50%, -50%) translate(calc(var(--image-x, ${pan.x}px) + var(--gallery-x, 0px)), var(--image-y, ${pan.y}px)) scale(var(--image-scale, ${scale}))`,
        }}
      >
        <div
          ref={media}
          className={styles.imageMedia}
          style={{
            width: size.width,
            height: size.height,
            left: frame?.left ?? 0,
            top: frame?.top ?? 0,
          }}
          onPointerDown={
            frame
              ? (event) => {
                  event.stopPropagation();
                  const start = {
                    x: event.clientX,
                    y: event.clientY,
                    ...frame,
                  };
                  const move = (e: globalThis.PointerEvent) =>
                    onFrame?.({
                      ...frame,
                      left: Math.round(
                        Math.max(
                          0,
                          Math.min(
                            frame.width - size.width,
                            start.left + (e.clientX - start.x) / scale,
                          ),
                        ),
                      ),
                      top: Math.round(
                        Math.max(
                          0,
                          Math.min(
                            frame.height - size.height,
                            start.top + (e.clientY - start.y) / scale,
                          ),
                        ),
                      ),
                    });
                  drag(move);
                }
              : undefined
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={reload}
            src={url}
            alt={title}
            draggable={false}
            onLoad={(e) => {
              const next = {
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              };
              setSize(next);
              onSize(next);
              setError(false);
            }}
            onError={() => setError(true)}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.annotations}
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
            alt="图片标注"
            draggable={false}
          />
          {comments.map((comment, index) =>
            comment.point ? (
              <span
                className={styles.pin}
                key={comment.id}
                title={comment.text}
                style={{
                  left: `${comment.point.x * 100}%`,
                  top: `${comment.point.y * 100}%`,
                }}
              >
                {index + 1}
              </span>
            ) : null,
          )}
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
                  drag((e) =>
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
                    }),
                  );
                }}
              />
              <button
                className={styles.frameHandle}
                aria-label="调整裁剪区域"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  const start = { x: event.clientX, y: event.clientY };
                  drag((e) =>
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
                    }),
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
            onPointerDown={(event) => {
              event.stopPropagation();
              const start = { x: event.clientX, y: event.clientY, ...frame };
              const move = (e: globalThis.PointerEvent) =>
                onFrame?.({
                  ...frame,
                  width: Math.min(
                    2048,
                    Math.ceil(
                      Math.max(
                        frame.left + size.width,
                        start.width + (e.clientX - start.x) / scale,
                      ) / 16,
                    ) * 16,
                  ),
                  height: Math.min(
                    2048,
                    Math.ceil(
                      Math.max(
                        frame.top + size.height,
                        start.height + (e.clientY - start.y) / scale,
                      ) / 16,
                    ) * 16,
                  ),
                });
              drag(move);
            }}
          />
        ) : null}
      </div>
      <button
        className={styles.fit}
        onClick={() => {
          if (mode === "view") { viewport.fit(); return; }
          onZoom(null);
          setPan({ x: 0, y: 0 });
        }}
      >
        适合窗口 <span ref={readout}>{Math.round(scale * 100)}%</span>
      </button>
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
