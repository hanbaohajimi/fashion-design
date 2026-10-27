"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "../ui";
import styles from "./picture-preview.module.css";
import { motionEase, motionTime, observeMotionCancellation } from "./motion-policy";
import { animateSpring } from "./spring";

export interface PreviewPicture { readonly id: string; readonly src: string | undefined; readonly name: string; }
type Point = { x: number; y: number; time: number };
type Position = { scale: number; x: number; y: number; slide: number; dismiss: number };
const fresh = (): Position => ({ scale: 1, x: 0, y: 0, slide: 0, dismiss: 0 });
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function containedPictureSize(boxWidth: number, boxHeight: number, naturalWidth: number, naturalHeight: number, downOnly = false) {
  if (!naturalWidth || !naturalHeight) return { width: boxWidth, height: boxHeight };
  const ratio = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight, downOnly ? 1 : Infinity);
  return { width: naturalWidth * ratio, height: naturalHeight * ratio };
}

export function picturePanBounds(width: number, height: number, stageWidth: number, stageHeight: number, scale: number) {
  return { x: Math.max(0, (width * scale - stageWidth) / 2), y: Math.max(0, (height * scale - stageHeight) / 2) };
}

/** contain 的元素盒包含留白；转场只取图片实际占据的区域。 */
export function pictureContentRect(element: HTMLElement): DOMRect {
  const image = element instanceof HTMLImageElement ? element : element.querySelector("img");
  const rect = (image ?? element).getBoundingClientRect();
  if (!image?.naturalWidth || !image.naturalHeight) return rect;
  const fit = getComputedStyle(image).objectFit;
  if (fit !== "contain" && fit !== "scale-down") return rect;
  const { width, height } = containedPictureSize(rect.width, rect.height, image.naturalWidth, image.naturalHeight, fit === "scale-down");
  return new DOMRect(rect.left + (rect.width - width) / 2, rect.top + (rect.height - height) / 2, width, height);
}

/** 纯看图层：手势只改变视图，不改变素材选择、比较或标注坐标。 */
export function PicturePreview({ pictures, initialIndex = 0, sourceElement, getSourceElement, keyboardOpened = false, onClose }: {
  readonly pictures: readonly PreviewPicture[];
  readonly initialIndex?: number;
  readonly sourceElement?: HTMLElement | null | undefined;
  readonly getSourceElement?: ((id: string) => HTMLElement | null) | undefined;
  readonly keyboardOpened?: boolean;
  readonly onClose: () => void;
}) {
  const [index, setIndex] = useState(() => clamp(initialIndex, 0, Math.max(0, pictures.length - 1)));
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);
  const displayedIndex = useRef(index);
  const navigationIndex = useRef(index);
  const lastTap = useRef<Point | null>(null);
  const touchDoubleAt = useRef(-Infinity);
  const tapEligible = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLDivElement>(null);
  const zoomLayer = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const origin = useRef<HTMLElement | null>(sourceElement ?? null);
  const focusReturn = useRef<HTMLElement | null>(null);
  const position = useRef(fresh());
  const points = useRef(new Map<number, Point>());
  const start = useRef<{ point: Point; position: Position; distance: number; midpoint: Point; axis: "x" | "y" | null } | null>(null);
  const frame = useRef<number | null>(null);
  const animations = useRef(new Set<Animation>());
  const reduced = useRef(false);
  const closing = useRef(false);
  const mounted = useRef(false);
  const entered = useRef(false);
  const current = pictures[index];
  const write = useCallback(() => {
    const value = position.current;
    zoomLayer.current?.style.setProperty("--picture-scale", String(value.scale));
    zoomLayer.current?.style.setProperty("--picture-x", `${value.x}px`);
    zoomLayer.current?.style.setProperty("--picture-y", `${value.y}px`);
    track.current?.style.setProperty("--picture-slide", `${value.slide}px`);
    track.current?.style.setProperty("--picture-dismiss", `${value.dismiss}px`);
    const progress = Math.min(.8, value.dismiss / Math.max(1, stage.current?.clientHeight ?? 1));
    track.current?.style.setProperty("--picture-dismiss-scale", String(1 - progress * .2));
    picture.current?.style.setProperty("--picture-dismiss-radius", `${progress * 20}px`);
    dialog.current?.style.setProperty("--picture-shade", String(.9 * (1 - progress)));
  }, []);
  const schedule = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => { frame.current = null; write(); });
  };
  const cancelFrames = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    for (const animation of animations.current) animation.cancel();
    animations.current.clear();
  }, []);
  const animate = useCallback((element: HTMLElement | null, frames: Keyframe[], duration: number, exit = false) => {
    if (!element?.animate || reduced.current) return Promise.resolve(true);
    const animation = element.animate(frames, { duration, easing: motionEase(exit) });
    animations.current.add(animation);
    return animation.finished.then(() => true, () => false).then((finished) => { animations.current.delete(animation); return finished; });
  }, []);
  const bound = () => {
    const value = position.current;
    const image = img.current;
    if (!image || !stage.current) { value.x = value.y = 0; return; }
    const fit = getComputedStyle(image).objectFit;
    const size = fit === "contain" || fit === "scale-down" ? containedPictureSize(image.clientWidth, image.clientHeight, image.naturalWidth, image.naturalHeight, fit === "scale-down") : { width: image.clientWidth, height: image.clientHeight };
    const bounds = picturePanBounds(size.width, size.height, stage.current.clientWidth, stage.current.clientHeight, value.scale);
    value.x = clamp(value.x, -bounds.x, bounds.x); value.y = clamp(value.y, -bounds.y, bounds.y);
  };
  const resetGesture = useCallback(() => {
    cancelFrames(); points.current.clear(); start.current = null;
    navigationIndex.current = displayedIndex.current; setTargetIndex(null); lastTap.current = null;
    position.current = fresh(); write(); setZoom(1);
  }, [cancelFrames, write]);
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    cancelFrames(); points.current.clear(); start.current = null;
    const first = img.current ? pictureContentRect(img.current) : picture.current?.getBoundingClientRect();
    const source = current ? getSourceElement?.(current.id) ?? (index === initialIndex ? origin.current : null) : null;
    const target = source?.isConnected ? pictureContentRect(source) : null;
    const shade = dialog.current?.style.getPropertyValue("--picture-shade") ?? ".9";
    position.current = fresh(); write();
    const rect = img.current ? pictureContentRect(img.current) : picture.current?.getBoundingClientRect();
    const aligned = !keyboardOpened && first && rect && target && rect.width && target.width && target.bottom > 0 && target.top < window.innerHeight && target.right > 0 && target.left < window.innerWidth;
    const transformFor = (box: DOMRect, base: DOMRect) => `translate(${box.left + box.width / 2 - base.left - base.width / 2}px, ${box.top + box.height / 2 - base.top - base.height / 2}px) scale(${box.width / base.width}, ${box.height / base.height})`;
    const frames = aligned ? [{ transform: transformFor(first, rect), opacity: 1 }, { transform: transformFor(target, rect), opacity: 0 }] : [{ opacity: 1 }, { opacity: 0 }];
    const duration = aligned ? motionTime("--motion-picture-expand", 500) : motionTime("--motion-tooltip-enter", 150);
    dialog.current?.style.setProperty("--picture-shade", shade || ".9");
    dialog.current?.style.setProperty("--picture-close", `${duration}ms`);
    dialog.current?.setAttribute("data-closing", "true");
    void animate(picture.current, frames, duration, true).then(() => {
      if (!mounted.current) return;
      dialog.current?.close(); onClose();
    });
  }, [animate, cancelFrames, current, getSourceElement, index, initialIndex, keyboardOpened, onClose, write]);
  useEffect(() => {
    mounted.current = true;
    focusReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!origin.current) origin.current = focusReturn.current;
    const element = dialog.current;
    if (typeof element?.showModal === "function") element.showModal(); else element?.setAttribute("open", "");
    closeButton.current?.focus();
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    reduced.current = media?.matches ?? true;
    const preference = () => { reduced.current = media?.matches ?? true; resetGesture(); };
    const blur = () => resetGesture();
    media?.addEventListener("change", preference);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", blur);
    const unobserve = observeMotionCancellation(resetGesture);
    return () => {
      mounted.current = false; cancelFrames();
      media?.removeEventListener("change", preference);
      window.removeEventListener("blur", blur); window.removeEventListener("resize", blur);
      unobserve();
      element?.close();
      if (focusReturn.current?.isConnected) focusReturn.current.focus({ preventScroll: true });
    };
  }, [cancelFrames, resetGesture]);
  useLayoutEffect(() => { displayedIndex.current = index; position.current = fresh(); write(); }, [index, write]);
  const openFromSource = () => {
    if (entered.current) return;
    entered.current = true;
    if (keyboardOpened) return;
    const rect = img.current ? pictureContentRect(img.current) : picture.current?.getBoundingClientRect();
    const source = current ? getSourceElement?.(current.id) ?? origin.current : origin.current;
    const from = source?.isConnected ? pictureContentRect(source) : null;
    if (rect?.width && from?.width) void animate(picture.current, [{ transform: `translate(${from.left + from.width / 2 - rect.left - rect.width / 2}px, ${from.top + from.height / 2 - rect.top - rect.height / 2}px) scale(${from.width / rect.width}, ${from.height / rect.height})`, opacity: 0.4 }, { transform: "none", opacity: 1 }], motionTime("--motion-picture-expand", 500));
  };
  const select = (next: number) => {
    if (next < 0 || next >= pictures.length || next === navigationIndex.current || closing.current) return;
    const before = track.current ? new DOMMatrixReadOnly(getComputedStyle(track.current).transform).m41 : position.current.slide;
    points.current.clear(); start.current = null; cancelFrames();
    navigationIndex.current = next; setTargetIndex(next); lastTap.current = null;
    const direction = next > index ? -1 : 1;
    const target = next === index ? 0 : direction * (stage.current?.clientWidth ?? 0);
    void animate(track.current, pictures.length >= 3 ? [{ transform: `translateX(${before}px)` }, { transform: `translateX(${target}px)` }] : [{ opacity: 1 }, { opacity: 0 }], pictures.length >= 3 ? motionTime("--motion-gallery", 350) : motionTime("--motion-tooltip-enter", 150)).then((finished) => {
      if (!finished || !mounted.current || closing.current) return;
      position.current = fresh(); write(); setIndex(next); setTargetIndex(null); setZoom(1); setFailed(false); setAttempt(0);
    });
  };
  const zoomTo = (scale: number) => {
    cancelFrames(); const before = { ...position.current };
    navigationIndex.current = displayedIndex.current; setTargetIndex(null); lastTap.current = null;
    position.current.slide = position.current.dismiss = 0;
    position.current.scale = clamp(scale, 1, 3); bound();
    if (position.current.scale === 1) position.current.x = position.current.y = 0;
    write(); setZoom(position.current.scale);
    const after = position.current;
    void animate(zoomLayer.current, [{ transform: `translate(${before.x}px,${before.y}px) scale(${before.scale})` }, { transform: `translate(${after.x}px,${after.y}px) scale(${after.scale})` }], motionTime("--motion-gallery-reset", 280));
  };
  const begin = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (closing.current || event.button !== 0 || failed || (event.target as Element).closest("button")) return;
    const slide = track.current ? new DOMMatrixReadOnly(getComputedStyle(track.current).transform).m41 : position.current.slide;
    cancelFrames(); navigationIndex.current = displayedIndex.current; setTargetIndex(null);
    position.current.slide = slide; write();
    tapEligible.current = points.current.size === 0;
    if (points.current.size) lastTap.current = null;
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY, time: event.timeStamp });
    event.currentTarget.setPointerCapture(event.pointerId);
    const pair = [...points.current.values()];
    const a = pair[0]; if (!a) return; const b = pair[1] ?? a;
    start.current = { point: a, position: { ...position.current }, distance: Math.hypot(b.x - a.x, b.y - a.y), midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, time: event.timeStamp }, axis: null };
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!points.current.has(event.pointerId) || !start.current) return;
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY, time: event.timeStamp });
    const pair = [...points.current.values()]; const originState = start.current;
    const a = pair[0]; if (!a) return; const b = pair[1]; const value = position.current;
    if (b && originState.distance > 0) {
      const rect = stage.current?.getBoundingClientRect();
      if (!rect) return;
      value.scale = clamp(originState.position.scale * Math.hypot(b.x - a.x, b.y - a.y) / originState.distance, 1, 3);
      const ratio = value.scale / originState.position.scale;
      const midX = originState.midpoint.x - rect.left - rect.width / 2;
      const midY = originState.midpoint.y - rect.top - rect.height / 2;
      value.x = (originState.position.x - midX) * ratio + midX + (a.x + b.x) / 2 - originState.midpoint.x;
      value.y = (originState.position.y - midY) * ratio + midY + (a.y + b.y) / 2 - originState.midpoint.y;
      value.slide = value.dismiss = 0; bound();
    } else {
      const dx = a.x - originState.point.x; const dy = a.y - originState.point.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 10) tapEligible.current = false;
      if (value.scale > 1) { value.x = originState.position.x + dx; value.y = originState.position.y + dy; bound(); }
      else {
        if (!originState.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 10) originState.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (originState.axis === "x" && pictures.length >= 3) value.slide = originState.position.slide + dx * ((index === 0 && dx > 0) || (index === pictures.length - 1 && dx < 0) ? 0.25 : 1);
        if (originState.axis === "y" && dy > 0 && window.innerHeight > window.innerWidth) value.dismiss = dy;
      }
    }
    schedule();
  };
  const end = (event: ReactPointerEvent<HTMLDivElement>, canceled = false) => {
    if (!points.current.has(event.pointerId)) return;
    const originState = start.current;
    points.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (points.current.size) {
      const remaining = [...points.current.values()][0];
      start.current = remaining ? { point: { ...remaining, time: event.timeStamp }, position: { ...position.current }, distance: 0, midpoint: remaining, axis: null } : null;
      bound(); write(); setZoom(position.current.scale); return;
    }
    start.current = null;
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    write(); setZoom(position.current.scale);
    const value = position.current;
    const elapsed = Math.max(1, event.timeStamp - (originState?.point.time ?? event.timeStamp));
    const velocityX = (event.clientX - (originState?.point.x ?? event.clientX)) / elapsed;
    const velocityY = (event.clientY - (originState?.point.y ?? event.clientY)) / elapsed;
    if (!canceled && event.pointerType === "touch" && tapEligible.current && elapsed < 250) {
      const previous = lastTap.current;
      if (previous && event.timeStamp - previous.time < 300 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 24) {
        touchDoubleAt.current = event.timeStamp; zoomTo(value.scale > 1 ? 1 : 2); return;
      }
      lastTap.current = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    } else lastTap.current = null;
    if (!canceled && value.scale === 1 && window.innerHeight > window.innerWidth && (value.dismiss > window.innerHeight * 0.4 || (value.dismiss >= 48 && velocityY >= 1))) { close(); return; }
    if (!canceled && value.scale === 1 && pictures.length >= 3 && (Math.abs(value.slide) > (stage.current?.clientWidth ?? 0) * 0.3 || (Math.abs(value.slide) >= 24 && Math.abs(velocityX) >= 0.5))) {
      const next = index + (value.slide < 0 ? 1 : -1);
      if (next >= 0 && next < pictures.length) { select(next); return; }
    }
    const slide = value.slide; const dismiss = value.dismiss;
    value.slide = value.dismiss = 0; write();
    if (track.current) {
      const animation = animateSpring(track.current, [slide, dismiss], [0, 0], ([x, y]) => `translate(${x}px, ${y}px)`);
      if (animation) { animations.current.add(animation); void animation.finished.catch(() => undefined).then(() => animations.current.delete(animation)); }
    }
  };
  if (!current) return null;
  const previousPicture = pictures[targetIndex !== null && targetIndex < index ? targetIndex : index - 1];
  const nextPicture = pictures[targetIndex !== null && targetIndex > index ? targetIndex : index + 1];
  return <dialog ref={dialog} aria-label={`查看大图：${current.name}`} className={styles.dialog} onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }} onKeyDown={(event) => {
    if (closing.current) { event.preventDefault(); return; }
    if (event.target instanceof HTMLInputElement) return;
    if (["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      if (position.current.scale > 1) {
        if (event.key === "ArrowRight") position.current.x -= 40;
        if (event.key === "ArrowLeft") position.current.x += 40;
        if (event.key === "ArrowDown") position.current.y -= 40;
        if (event.key === "ArrowUp") position.current.y += 40;
        bound(); write();
      } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") select(navigationIndex.current + (event.key === "ArrowRight" ? 1 : -1));
    }
    if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomTo(position.current.scale + 0.5); }
    if (event.key === "-") { event.preventDefault(); zoomTo(position.current.scale - 0.5); }
    if (event.key === "0") { event.preventDefault(); zoomTo(1); }
  }}>
    <div aria-hidden="true" className={styles.surface} />
    <header className={styles.header}><h3>{current.name}</h3><Button ref={closeButton} onClick={close}>关闭大图</Button></header>
    <div ref={stage} className={styles.stage} data-picture-stage onPointerDown={begin} onPointerMove={move} onPointerUp={(event) => end(event)} onPointerCancel={(event) => end(event, true)} onLostPointerCapture={(event) => end(event, true)} onDoubleClick={(event) => { if (event.timeStamp - touchDoubleAt.current > 500) zoomTo(position.current.scale > 1 ? 1 : 2); }}>
      <div ref={track} className={styles.track}>
        {pictures.length >= 3 && previousPicture ? <div aria-hidden="true" className={`${styles.slot} ${styles.previous}`}><PictureImage picture={previousPicture} /></div> : null}
        <div className={styles.slot}><div ref={picture} className={styles.picture}><div ref={zoomLayer} className={styles.zoom}>
          {failed || !current.src ? <div className={styles.error}><p>图片暂时无法加载。</p><Button onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>重新加载图片</Button></div> : <img /* eslint-disable-line @next/next/no-img-element */ key={`${current.id}:${attempt}`} ref={img} className={styles.image} src={current.src} alt={current.name} draggable={false} decoding="async" onLoad={openFromSource} onError={() => setFailed(true)} />}
        </div></div></div>
        {pictures.length >= 3 && nextPicture ? <div aria-hidden="true" className={`${styles.slot} ${styles.next}`}><PictureImage picture={nextPicture} /></div> : null}
      </div>
    </div>
    <div className={styles.tools}>
      {pictures.length > 1 ? <div className={styles.toolGroup}><Button disabled={(targetIndex ?? index) === 0} onClick={() => select(navigationIndex.current - 1)}>上一张</Button><span>{index + 1} / {pictures.length}</span><Button disabled={(targetIndex ?? index) === pictures.length - 1} onClick={() => select(navigationIndex.current + 1)}>下一张</Button></div> : null}
      <div className={styles.toolGroup}><Button aria-label="缩小图片" disabled={zoom <= 1 || failed} onClick={() => zoomTo(position.current.scale - 0.5)}>−</Button><Button onClick={() => zoomTo(1)}>{Math.round(zoom * 100)}% · 还原</Button><Button aria-label="放大图片" disabled={zoom >= 3 || failed} onClick={() => zoomTo(position.current.scale + 0.5)}>＋</Button></div>
    </div>
    <p className={styles.help}>查看原图，不改变当前选择。双击或双指缩放，放大后拖动查看。</p>
    <span className={styles.live} role="status">{current.name}，第 {index + 1} 张，共 {pictures.length} 张</span>
  </dialog>;
}

function PictureImage({ picture }: { readonly picture: PreviewPicture }) {
  const [failure, setFailure] = useState<string | null>(null);
  if (!picture.src || failure === picture.src) return <span className={styles.error}>图片暂不可用</span>;
  // 相邻图片只用于跟手过渡，不进入读屏或多选状态。
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.image} src={picture.src} alt="" draggable={false} decoding="async" onError={() => setFailure(picture.src ?? "")} />;
}
