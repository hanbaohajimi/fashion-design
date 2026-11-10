"use client";

import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { Box, computed, react, useEditor, type TLCamera } from "tldraw";
import { fitCanvasContents } from "./canvas-placements";
import { overviewBounds, overviewContains, overviewPoint, readOverviewShapes, type OverviewBox, type OverviewPoint } from "./canvas-overview";
import styles from "./canvas-overview.module.css";

interface Gesture { id: number; bounds: OverviewBox; camera: TLCamera; offset: OverviewPoint }
interface Runtime { schedule: () => void; cancel: () => boolean; bounds: () => OverviewBox | null; move: (point: OverviewPoint) => void; commit: () => void }

export const CanvasOverview = memo(function CanvasOverview({ onClose }: { onClose: () => void }) {
  const editor = useEditor();
  const canvas = useRef<HTMLCanvasElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  const zoomLabel = useRef<HTMLOutputElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const descriptionId = useId();
  const [unavailable, setUnavailable] = useState(false);
  const geometry = useMemo(() => computed("canvas-overview-geometry", () => {
    const shapes = readOverviewShapes(editor);
    const content = shapes.length ? Box.Common(shapes.map(shape => new Box(shape.x, shape.y, shape.w, shape.h))) : null;
    return { shapes, content };
  }), [editor]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext("2d");
    if (!context) { queueMicrotask(() => setUnavailable(true)); return; }
    let alive = true, frame = 0, moveFrame = 0, visible = true;
    let pending: OverviewPoint | null = null;
    let mapping: OverviewBox | null = null;
    let width = 0, height = 0;
    const style = getComputedStyle(element);
    const colors = {
      background: style.getPropertyValue("--color-paper").trim(),
      shape: style.getPropertyValue("--color-ink-secondary").trim(),
      selected: style.getPropertyValue("--color-action").trim(),
      viewport: style.getPropertyValue("--color-navigation-selected").trim(),
    };
    const draw = () => {
      frame = 0;
      if (!alive || !visible || document.hidden || width < 1 || height < 1) return;
      const { shapes, content } = geometry.get();
      const viewport = editor.getViewportPageBounds();
      const bounds = gesture.current?.bounds ?? overviewBounds(content, viewport, width, height);
      mapping = bounds;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      if (element.width !== Math.round(width * ratio)) element.width = Math.round(width * ratio);
      if (element.height !== Math.round(height * ratio)) element.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = colors.background; context.fillRect(0, 0, width, height);
      const sx = width / bounds.w, sy = height / bounds.h;
      const rect = (box: OverviewBox) => ({ x: (box.x - bounds.x) * sx, y: (box.y - bounds.y) * sy, w: box.w * sx, h: box.h * sy });
      const view = rect(viewport);
      context.fillStyle = colors.viewport; context.fillRect(view.x, view.y, view.w, view.h);
      const selected = editor.getShapeAndDescendantIds(editor.getSelectedShapeIds());
      for (const shape of shapes) {
        const box = rect(shape);
        context.fillStyle = selected.has(shape.id) ? colors.selected : colors.shape;
        context.globalAlpha = selected.has(shape.id) ? 1 : .65;
        context.fillRect(box.x, box.y, Math.max(1, box.w), Math.max(1, box.h));
      }
      context.globalAlpha = 1;
      context.strokeStyle = colors.selected; context.lineWidth = 1.5;
      context.strokeRect(view.x, view.y, view.w, view.h);
      if (count.current) count.current.textContent = `${shapes.length} 个可见对象`;
      if (zoomLabel.current) zoomLabel.current.textContent = `${Math.round(editor.getZoomLevel() * 100)}%`;
      element.dataset.objectCount = String(shapes.length);
      element.dataset.bounds = JSON.stringify(bounds);
      element.dataset.viewport = JSON.stringify({ x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h });
      element.dataset.zoom = String(editor.getZoomLevel());
    };
    const schedule = () => { if (alive && !frame && visible && !document.hidden) frame = requestAnimationFrame(draw); };
    const commit = () => {
      cancelAnimationFrame(moveFrame); moveFrame = 0;
      if (pending && alive) { const point = pending; pending = null; editor.centerOnPoint(point); }
    };
    const cancel = () => {
      const active = gesture.current;
      if (!active) return false;
      gesture.current = null; pending = null;
      cancelAnimationFrame(moveFrame); moveFrame = 0;
      editor.setCamera(active.camera);
      if (element.hasPointerCapture(active.id)) element.releasePointerCapture(active.id);
      schedule(); return true;
    };
    runtime.current = { schedule, cancel, bounds: () => mapping,
      move: point => { pending = point; if (!moveFrame) moveFrame = requestAnimationFrame(commit); }, commit };
    const stop = react("canvas-overview-draw", () => {
      geometry.get(); editor.getViewportPageBounds(); editor.getSelectedShapeIds();
      schedule();
    });
    const resize = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      if (width !== rect.width || height !== rect.height) { cancel(); width = rect.width; height = rect.height; }
      schedule();
    });
    resize.observe(element);
    const intersection = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (visible) schedule(); else { cancel(); cancelAnimationFrame(frame); frame = 0; }
    });
    intersection.observe(element);
    const visibility = () => {
      if (document.hidden) { cancel(); cancelAnimationFrame(frame); frame = 0; }
      else schedule();
    };
    const blockWheel = (event: WheelEvent) => { event.preventDefault(); event.stopPropagation(); };
    element.addEventListener("wheel", blockWheel, { passive: false });
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", cancel);
    const focus = requestAnimationFrame(() => element.focus({ preventScroll: true }));
    return () => {
      cancel(); alive = false; runtime.current = null;
      cancelAnimationFrame(focus); cancelAnimationFrame(frame); cancelAnimationFrame(moveFrame);
      stop(); resize.disconnect(); intersection.disconnect();
      element.removeEventListener("wheel", blockWheel);
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("blur", cancel);
    };
  }, [editor, geometry]);

  return <section className={styles.panel} aria-label="画布总览" data-canvas-overview onWheel={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
        event.preventDefault(); if (!runtime.current?.cancel()) onClose();
      }
    }}>
    <div className={styles.header}><h2>画布总览</h2><button type="button" aria-label="关闭画布总览" onClick={onClose}>×</button></div>
    {unavailable ? <p className={styles.fallback}>总览暂不可用，可使用下方按钮查看全图。</p> : <canvas ref={canvas} className={styles.map} tabIndex={0} role="application" aria-label="画布总览导航" aria-describedby={descriptionId}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary || gesture.current) return;
        const bounds = runtime.current?.bounds();
        if (!bounds || !geometry.get().shapes.length) return;
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        const point = overviewPoint({ x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect(), bounds);
        const viewport = editor.getViewportPageBounds();
        const inside = overviewContains(viewport, point);
        gesture.current = { id: event.pointerId, bounds, camera: { ...editor.getCamera() }, offset: inside ? { x: point.x - viewport.center.x, y: point.y - viewport.center.y } : { x: 0, y: 0 } };
        event.currentTarget.setPointerCapture(event.pointerId);
        if (!inside) { runtime.current?.move(point); runtime.current?.commit(); }
      }}
      onPointerMove={event => {
        const active = gesture.current;
        if (!active || event.pointerId !== active.id) return;
        event.preventDefault(); event.stopPropagation();
        const point = overviewPoint({ x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect(), active.bounds);
        runtime.current?.move({ x: point.x - active.offset.x, y: point.y - active.offset.y });
      }}
      onPointerUp={event => {
        if (gesture.current?.id !== event.pointerId) return;
        runtime.current?.commit(); gesture.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        runtime.current?.schedule();
      }}
      onPointerCancel={() => runtime.current?.cancel()}
      onLostPointerCapture={() => runtime.current?.cancel()}
      onDoubleClick={event => { event.stopPropagation(); event.preventDefault(); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return;
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "+", "=", "-", "0"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); runtime.current?.cancel();
        if (event.key === "Home") fitCanvasContents(editor);
        else if (["+", "="].includes(event.key)) editor.zoomIn();
        else if (event.key === "-") editor.zoomOut();
        else if (event.key === "0") editor.resetZoom();
        else {
          const viewport = editor.getViewportPageBounds();
          const amount = event.shiftKey ? .5 : .15;
          editor.centerOnPoint({ x: viewport.center.x + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0) * viewport.w * amount,
            y: viewport.center.y + (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0) * viewport.h * amount });
        }
      }} />}
    <span id={descriptionId} className={styles.srOnly}>点击或拖动以移动视野。方向键平移，Shift加速，Home查看全图，加减键缩放，0恢复原始比例。Escape取消拖动，再次按下关闭总览。</span>
    <div className={styles.footer}><span ref={count}>{unavailable ? "缩放与定位" : "正在读取画布"}</span><div>
      <button type="button" aria-label="总览缩小画布" title="缩小" onClick={() => editor.zoomOut()}>−</button>
      {!unavailable ? <output ref={zoomLabel} aria-label="画布缩放比例" aria-live="off" /> : null}
      <button type="button" aria-label="总览放大画布" title="放大" onClick={() => editor.zoomIn()}>＋</button>
      <button type="button" onClick={() => fitCanvasContents(editor)}>全图</button>
    </div></div>
  </section>;
});
