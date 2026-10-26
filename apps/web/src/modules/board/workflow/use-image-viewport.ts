"use client";

import { useLayoutEffect, useRef, type RefObject, type PointerEvent, type WheelEvent } from "react";
import { motionTime, motionEase } from "../../../components/interactions/motion-policy";

interface Point { x: number; y: number }
export function clampImagePan(pan: Point, scale: number, image: { width: number; height: number }, bounds: { width: number; height: number }): Point {
  const x = Math.max(0, (image.width * scale - bounds.width + 32) / 2);
  const y = Math.max(0, (image.height * scale - bounds.height + 32) / 2);
  return { x: Math.max(-x, Math.min(x, pan.x)), y: Math.max(-y, Math.min(y, pan.y)) };
}
export function pinchImagePan(anchor: Point, midpoint: Point, scale: number): Point {
  return { x: midpoint.x - anchor.x * scale, y: midpoint.y - anchor.y * scale };
}
type Options = {
  enabled: boolean;
  url: string;
  scale: number;
  fit: number;
  size: { width: number; height: number };
  bounds: { width: number; height: number };
  host: RefObject<HTMLDivElement | null>;
  frame: RefObject<HTMLDivElement | null>;
  readout: RefObject<HTMLSpanElement | null>;
  onCommit: (scale: number, pan: Point, fitted: boolean) => void;
  onPreview?: ((percent: number | null) => void) | undefined;
  previous?: boolean | undefined;
  next?: boolean | undefined;
  onNavigate?: ((direction: -1 | 1) => void) | undefined;
};
type Gesture = { at: number; first: Point; pan: Point; scale: number; distance: number; anchor: Point; swipe: boolean; dx: number; lastX: number; lastAt: number; velocity: number };
const gap = (points: Point[]) => points[1] && points[0] ? Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) : 0;
const midpoint = (points: Point[]) => points[1] && points[0] ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 } : points[0] ?? { x: 0, y: 0 };

/** 看图手势只移动统一画框，原图、标注与评论点始终共用坐标系。 */
export function useImageViewport(options: Options) {
  const current = useRef(options);
  const visual = useRef({ x: 0, y: 0, scale: options.scale, swipe: 0 });
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef(0);
  const wheelEnd = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animation = useRef<Animation | null>(null);
  const neighborAnimation = useRef<Animation | null>(null);
  const previewAt = useRef(0);
  const paint = () => {
    frame.current = 0;
    const opts = current.current;
    opts.frame.current?.style.setProperty("--image-x", `${visual.current.x}px`);
    opts.frame.current?.style.setProperty("--image-y", `${visual.current.y}px`);
    opts.frame.current?.style.setProperty("--image-scale", String(visual.current.scale));
    opts.host.current?.style.setProperty("--gallery-x", `${visual.current.swipe}px`);
    if (opts.readout.current) opts.readout.current.textContent = `${Math.round(visual.current.scale * 100)}%`;
    if ((gesture.current || wheelEnd.current) && performance.now() - previewAt.current >= 100) { opts.onPreview?.(visual.current.scale * 100); previewAt.current = performance.now(); }
  };
  const schedule = () => { if (!frame.current) frame.current = requestAnimationFrame(paint); };
  const commit = () => {
    cancelAnimationFrame(frame.current); paint();
    current.current.onPreview?.(null);
    current.current.onCommit(visual.current.scale, visual.current, Math.abs(visual.current.scale - current.current.fit) < .0001);
  };
  const cancel = (save = true) => {
    pointers.current.clear(); gesture.current = null;
    if (wheelEnd.current) clearTimeout(wheelEnd.current);
    wheelEnd.current = null;
    animation.current?.cancel(); animation.current = null;
    neighborAnimation.current?.cancel(); neighborAnimation.current = null;
    visual.current.swipe = 0;
    if (save) commit(); else { cancelAnimationFrame(frame.current); frame.current = 0; }
  };
  useLayoutEffect(() => { current.current = options; });
  useLayoutEffect(() => {
    if (!options.enabled) {
      if (gesture.current || wheelEnd.current) cancel();
      for (const name of ["--image-x", "--image-y", "--image-scale"]) options.frame.current?.style.removeProperty(name);
      return;
    }
    if (Math.abs(options.scale - visual.current.scale) > .0001 || gesture.current) cancel(false);
    visual.current = { ...clampImagePan(visual.current, options.scale, options.size, options.bounds), scale: options.scale, swipe: 0 };
    paint();
    // Changes in external zoom/geometry are commands, not gesture frames.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.enabled, options.scale, options.size.width, options.size.height, options.bounds.width, options.bounds.height]);
  useLayoutEffect(() => {
    visual.current.x = visual.current.y = visual.current.swipe = 0;
    if (current.current.enabled) paint();
  }, [options.url]);
  useLayoutEffect(() => {
    const reset = () => { if (current.current.enabled) cancel(); };
    const visibility = () => { if (document.hidden) reset(); };
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    media.addEventListener("change", reset);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", visibility);
    return () => { cancel(false); media.removeEventListener("change", reset); window.removeEventListener("blur", reset); document.removeEventListener("visibilitychange", visibility); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const local = (point: Point) => {
    const rect = current.current.host.current?.getBoundingClientRect();
    return { x: point.x - (rect?.left ?? 0) - current.current.bounds.width / 2, y: point.y - (rect?.top ?? 0) - current.current.bounds.height / 2 };
  };
  const rebase = () => {
    const points = [...pointers.current.values()];
    const center = local(midpoint(points));
    gesture.current = { at: performance.now(), first: points[0] ?? { x: 0, y: 0 }, pan: { x: visual.current.x, y: visual.current.y }, scale: visual.current.scale, distance: gap(points), anchor: { x: (center.x - visual.current.x) / visual.current.scale, y: (center.y - visual.current.y) / visual.current.scale }, swipe: false, dx: 0, lastX: points[0]?.x ?? 0, lastAt: performance.now(), velocity: 0 };
  };
  const zoomAt = (scale: number, center: Point) => {
    const old = visual.current;
    const anchor = { x: (center.x - old.x) / old.scale, y: (center.y - old.y) / old.scale };
    const next = Math.max(.1, Math.min(4, scale));
    visual.current = { ...clampImagePan(pinchImagePan(anchor, center, next), next, current.current.size, current.current.bounds), scale: next, swipe: 0 };
    schedule();
  };
  const navigate = (direction: -1 | 1 | null, dx: number) => {
    const opts = current.current;
    const allowed = direction !== null && (direction < 0 ? opts.previous : opts.next);
    const node = opts.frame.current;
    const duration = motionTime(allowed ? "--motion-gallery" : "--motion-gallery-reset", allowed ? 350 : 280);
    const from = node ? getComputedStyle(node).transform : "none";
    const neighbors = opts.host.current?.querySelector<HTMLElement>("[data-gallery-neighbors]");
    const neighborsFrom = neighbors ? getComputedStyle(neighbors).transform : "none";
    visual.current.swipe = allowed && direction !== null ? -direction * opts.bounds.width : 0;
    paint();
    const to = node ? getComputedStyle(node).transform : "none";
    if (!node || !duration || typeof node.animate !== "function") { visual.current.swipe = 0; paint(); if (allowed && direction !== null) opts.onNavigate?.(direction); return; }
    animation.current = node.animate([{ transform: from }, { transform: to }], { duration, easing: motionEase() });
    if (neighbors) neighborAnimation.current = neighbors.animate([{ transform: neighborsFrom }, { transform: getComputedStyle(neighbors).transform }], { duration, easing: motionEase() });
    void animation.current.finished.then(() => { animation.current = null; visual.current.swipe = 0; paint(); if (allowed && dx && direction !== null) opts.onNavigate?.(direction); }).catch(() => undefined);
  };
  return {
    getScale: () => visual.current.scale,
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (!options.enabled || (event.target instanceof Element && event.target.closest("button,input,select,textarea"))) return false;
      if (!pointers.current.size) cancel(false);
      event.currentTarget.setPointerCapture(event.pointerId);
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      visual.current.swipe = 0; rebase(); return true;
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      if (!options.enabled || !pointers.current.has(event.pointerId) || !gesture.current) return false;
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const points = [...pointers.current.values()];
      const g = gesture.current;
      if (points.length >= 2 && g.distance) {
        const scale = Math.max(.1, Math.min(4, g.scale * gap(points) / g.distance));
        visual.current = { ...clampImagePan(pinchImagePan(g.anchor, local(midpoint(points)), scale), scale, options.size, options.bounds), scale, swipe: 0 };
      } else {
        const dx = event.clientX - g.first.x;
        const dy = event.clientY - g.first.y;
        if (options.onNavigate && g.scale <= options.fit + .001 && (g.swipe || Math.abs(dx) >= 10 && Math.abs(dx) > Math.abs(dy) * 1.2)) {
          g.swipe = true; g.dx = dx;
          const now = performance.now();
          g.velocity = (event.clientX - g.lastX) / Math.max(1, now - g.lastAt); g.lastX = event.clientX; g.lastAt = now;
          visual.current.swipe = dx * (dx > 0 ? options.previous ? 1 : .25 : options.next ? 1 : .25);
        } else Object.assign(visual.current, clampImagePan({ x: g.pan.x + dx, y: g.pan.y + dy }, visual.current.scale, options.size, options.bounds));
      }
      schedule(); return true;
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      if (!options.enabled || !pointers.current.has(event.pointerId)) return false;
      pointers.current.delete(event.pointerId);
      if (pointers.current.size) { rebase(); return true; }
      const g = gesture.current; gesture.current = null;
      if (g?.swipe) {
        cancelAnimationFrame(frame.current); paint();
        const passes = Math.abs(g.dx) >= options.bounds.width * .3 || performance.now() - g.lastAt <= 80 && Math.abs(g.velocity) >= .5 && Math.abs(g.dx) >= 24;
        if (passes) navigate(g.dx < 0 ? 1 : -1, g.dx);
        else navigate(null, g.dx);
      } else commit();
      return true;
    },
    onPointerCancel() { if (!options.enabled || !pointers.current.size && !gesture.current && !wheelEnd.current) return false; cancel(); return true; },
    onWheel(event: WheelEvent<HTMLDivElement>) {
      if (!options.enabled) return false;
      zoomAt(visual.current.scale * (event.deltaY > 0 ? .9 : 1.1), local({ x: event.clientX, y: event.clientY }));
      if (wheelEnd.current) clearTimeout(wheelEnd.current);
      wheelEnd.current = setTimeout(() => { wheelEnd.current = null; commit(); }, 120);
      return true;
    },
    onDoubleClick(event: { clientX: number; clientY: number }) {
      if (!options.enabled) return;
      cancel(false);
      const node = options.frame.current;
      const from = node ? getComputedStyle(node).transform : "none";
      const fitted = Math.abs(visual.current.scale - options.fit) < .001;
      if (fitted) zoomAt(2, local({ x: event.clientX, y: event.clientY }));
      else visual.current = { x: 0, y: 0, scale: options.fit, swipe: 0 };
      commit();
      if (node && typeof node.animate === "function" && !matchMedia("(prefers-reduced-motion: reduce)").matches) animation.current = node.animate([{ transform: from }, { transform: getComputedStyle(node).transform }], { duration: motionTime("--motion-gallery-reset", 280), easing: motionEase() });
    },
    fit() { cancel(false); visual.current = { x: 0, y: 0, scale: options.fit, swipe: 0 }; commit(); },
  };
}
