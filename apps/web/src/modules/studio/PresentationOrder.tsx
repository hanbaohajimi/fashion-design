"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, ImagePreview } from "../../components/ui";
import type { StudioAsset } from "./studio-ui";
import styles from "./presentation-sets.module.css";
import { motionEase, motionTime, observeMotionCancellation } from "../../components/interactions/motion-policy";

export function movePresentationItem(ids: readonly string[], id: string, to: number): string[] {
  const next = [...ids]; const from = next.indexOf(id);
  if (from < 0 || to < 0 || to >= next.length || from === to) return next;
  next.splice(from, 1); next.splice(to, 0, id); return next;
}

/** 专用把手拖排，不占用图片查看、选中或横向滚动手势。 */
export function PresentationOrder({ ids, assets, currentId, assetName, disabled, onSelect, onReorder }: {
  readonly ids: readonly string[];
  readonly assets: readonly StudioAsset[];
  readonly currentId: string | undefined;
  readonly assetName: (id: string) => string;
  readonly disabled: boolean;
  readonly onSelect: (id: string) => void;
  readonly onReorder: (ids: string[]) => void;
}) {
  const [preview, setPreview] = useState<string[] | null>(null);
  const [grabbed, setGrabbed] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const order = preview ?? ids;
  const currentOrder = useRef(order);
  const sourceOrder = useRef(ids);
  const gesture = useRef<{ id: string; pointerId: number; x: number; y: number; startX: number; startY: number; active: boolean; target: HTMLElement } | null>(null);
  const ghost = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const lastFrame = useRef(0);
  const before = useRef(new Map<string, DOMRect>());
  const animations = useRef(new Set<Animation>());
  const selectRef = useRef(onReorder);
  useLayoutEffect(() => { currentOrder.current = order; sourceOrder.current = ids; selectRef.current = onReorder; }, [order, ids, onReorder]);
  const stop = (commit: boolean) => {
    if (timer.current) clearTimeout(timer.current); timer.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null;
    const pointer = gesture.current;
    gesture.current = null;
    if (pointer?.target.hasPointerCapture?.(pointer.pointerId)) pointer.target.releasePointerCapture(pointer.pointerId);
    const floating = ghost.current; ghost.current = null;
    const target = pointer ? [...(list.current?.querySelectorAll<HTMLElement>("[data-order-id]") ?? [])].find((element) => element.dataset.orderId === pointer.id) : null;
    if (commit && floating?.animate && target && motionTime("--motion-drop", 250)) {
      const box = target.getBoundingClientRect(); const left = Number.parseFloat(floating.style.left); const top = Number.parseFloat(floating.style.top);
      const animation = floating.animate([{ transform: floating.style.transform }, { transform: `translate(${box.left - left}px, ${box.top - top}px) scale(1)` }], { duration: motionTime("--motion-drop", 250), easing: motionEase() });
      animations.current.add(animation);
      void animation.finished.catch(() => undefined).then(() => { floating.remove(); animations.current.delete(animation); });
    } else floating?.remove();
    if (commit) selectRef.current([...currentOrder.current]);
    setPreview(null); setGrabbed(null);
  };
  const cancelRef = useRef(() => stop(false));
  useLayoutEffect(() => { cancelRef.current = () => stop(false); });
  useEffect(() => {
    const cancel = () => cancelRef.current();
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const playing = animations.current;
    const unobserve = observeMotionCancellation(cancel);
    window.addEventListener("blur", cancel); media?.addEventListener("change", cancel);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      ghost.current?.remove(); playing.forEach((animation) => animation.cancel());
      window.removeEventListener("blur", cancel); media?.removeEventListener("change", cancel);
      unobserve();
    };
  }, []);
  useEffect(() => { if (disabled) cancelRef.current(); }, [disabled]);
  useLayoutEffect(() => {
    if (!before.current.size || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    list.current?.querySelectorAll<HTMLElement>("[data-order-id]").forEach((element) => {
      const first = before.current.get(element.dataset.orderId ?? ""); const last = element.getBoundingClientRect();
      if (first && element.animate && element.dataset.orderId !== grabbed) {
        const animation = element.animate([{ transform: `translate(${first.left - last.left}px, ${first.top - last.top}px)` }, { transform: "none" }], { duration: motionTime("--motion-reorder", 200), easing: motionEase() });
        animations.current.add(animation);
        void animation.finished.catch(() => undefined).then(() => animations.current.delete(animation));
      }
    });
    before.current.clear();
  }, [preview, grabbed]);
  const shift = (id: string, to: number, local: boolean) => {
    const next = movePresentationItem(currentOrder.current, id, to);
    before.current.clear();
    list.current?.querySelectorAll<HTMLElement>("[data-order-id]").forEach((element) => { if (element.dataset.orderId) before.current.set(element.dataset.orderId, element.getBoundingClientRect()); });
    currentOrder.current = next;
    if (local) setPreview(next); else onReorder(next);
    setAnnouncement(`${assetName(id)}，第 ${next.indexOf(id) + 1} 张，共 ${next.length} 张`);
  };
  const tick = (time: number) => {
    frame.current = null;
    const pointer = gesture.current; const host = list.current;
    if (!pointer?.active || !host) return;
    if (ghost.current) ghost.current.style.transform = `translate(${pointer.x - pointer.startX}px, ${pointer.y - pointer.startY}px) scale(1.05)`;
    const dt = Math.min(32, Math.max(0, time - (lastFrame.current || time - 16))) / 1000;
    lastFrame.current = time;
    let scrollHost = host.parentElement;
    while (scrollHost && !(scrollHost.scrollHeight > scrollHost.clientHeight && /(auto|scroll)/.test(getComputedStyle(scrollHost).overflowY))) scrollHost = scrollHost.parentElement;
    const scrolling = scrollHost ?? document.scrollingElement;
    const scrollBounds = scrollHost?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
    const speed = pointer.y < scrollBounds.top + 48 ? -480 * Math.min(1, (scrollBounds.top + 48 - pointer.y) / 48) : pointer.y > scrollBounds.bottom - 48 ? 480 * Math.min(1, (pointer.y - scrollBounds.bottom + 48) / 48) : 0;
    const previousScroll = scrolling?.scrollTop ?? 0;
    if (scrolling && speed) scrolling.scrollBy({ top: speed * dt, behavior: "instant" });
    const scrolled = (scrolling?.scrollTop ?? 0) !== previousScroll;
    const rect = host.getBoundingClientRect();
    let nearest = 0; let distance = Infinity;
    host.querySelectorAll<HTMLElement>("[data-order-id]").forEach((element, index) => {
      // offset 尺寸是最终布局，不受邻项正在播放的 FLIP transform 干扰。
      const centerX = rect.left + element.offsetLeft - host.scrollLeft + element.offsetWidth / 2;
      const centerY = rect.top + element.offsetTop - host.scrollTop + element.offsetHeight / 2;
      const delta = Math.hypot(pointer.x - centerX, pointer.y - centerY);
      if (delta < distance) { distance = delta; nearest = index; }
    });
    if (nearest !== currentOrder.current.indexOf(pointer.id)) shift(pointer.id, nearest, true);
    if (speed && scrolled) frame.current = requestAnimationFrame(tick);
  };
  const lift = () => {
    const pointer = gesture.current; if (!pointer || disabled) return;
    const card = [...(list.current?.querySelectorAll<HTMLElement>("[data-order-id]") ?? [])].find((element) => element.dataset.orderId === pointer.id); if (!card) return;
    pointer.active = true; setGrabbed(pointer.id); setPreview([...sourceOrder.current]);
    const rect = card.getBoundingClientRect(); const clone = card.cloneNode(true) as HTMLElement;
    clone.setAttribute("aria-hidden", "true"); clone.inert = true;
    Object.assign(clone.style, { position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: "0", zIndex: "9999", pointerEvents: "none", transform: "scale(1.05)", boxShadow: "0 8px 24px rgb(32 51 46 / 18%)" });
    document.body.append(clone); ghost.current = clone;
    setAnnouncement(`已提起${assetName(pointer.id)}，拖动调整顺序，按 Escape 取消`);
  };
  const down = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (disabled || event.button !== 0 || gesture.current) return;
    stop(false);
    animations.current.forEach((animation) => animation.cancel()); animations.current.clear(); lastFrame.current = 0;
    const host = list.current; if (!host) return;
    gesture.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, active: false, target: host };
    // 捕获在稳定网格上；被拖卡片换位不能丢失指针与边缘滚动。
    host.setPointerCapture(event.pointerId);
    if (event.pointerType === "touch") timer.current = setTimeout(lift, 300); else lift();
  };
  return <section className={styles.orderSection} aria-label="展示图片顺序">
    <p>拖动把手或使用前移、后移调整顺序；图片说明与核对记录随图片保留。</p>
    <div ref={list} className={styles.orderStrip} onPointerMove={(event) => {
      const pointer = gesture.current; if (!pointer || pointer.pointerId !== event.pointerId) return;
      pointer.x = event.clientX; pointer.y = event.clientY;
      if (!pointer.active && Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > 8) { stop(false); return; }
      if (pointer.active && frame.current === null) frame.current = requestAnimationFrame(tick);
    }} onPointerUp={(event) => { if (gesture.current?.pointerId === event.pointerId) stop(gesture.current.active); }} onPointerCancel={(event) => { if (gesture.current?.pointerId === event.pointerId) stop(false); }} onLostPointerCapture={(event) => { if (gesture.current?.pointerId === event.pointerId) stop(false); }} onKeyDown={(event) => { if (event.key === "Escape" && grabbed) { event.preventDefault(); stop(false); setAnnouncement("已取消排序"); } }}>
      {order.map((id, index) => {
        const asset = assets.find((item) => item.id === id);
        return <article key={id} data-order-id={id} data-grabbed={grabbed === id || undefined} className={styles.orderItem}>
          <button type="button" className={styles.orderImage} aria-label={`查看第 ${index + 1} 张：${assetName(id)}`} aria-current={currentId === id ? "true" : undefined} onClick={() => onSelect(id)}><ImagePreview retryable={false} src={asset?.thumbnailUrl ?? asset?.url} alt={assetName(id)} /><span>{index + 1} · {assetName(id)}</span></button>
          <button type="button" className={styles.orderHandle} disabled={disabled || ids.length < 2} aria-label={`调整${assetName(id)}顺序`} aria-pressed={grabbed === id} onPointerDown={(event) => down(event, id)} onKeyDown={(event) => {
            if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (grabbed === id) stop(true); else { setGrabbed(id); setPreview([...ids]); setAnnouncement(`已提起${assetName(id)}，方向键调整，空格确认，Escape取消`); } }
            if (grabbed === id && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); shift(id, Math.max(0, Math.min(order.length - 1, index + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1))), true); }
          }}>⠿ 排序</button>
          <div className={styles.orderButtons}><Button size="small" disabled={disabled || index === 0 || !!grabbed} aria-label={`前移${assetName(id)}`} onClick={() => shift(id, index - 1, false)}>前移</Button><Button size="small" disabled={disabled || index === order.length - 1 || !!grabbed} aria-label={`后移${assetName(id)}`} onClick={() => shift(id, index + 1, false)}>后移</Button></div>
        </article>;
      })}
    </div>
    <p role="status" className={styles.orderAnnouncement}>{announcement}</p>
  </section>;
}
