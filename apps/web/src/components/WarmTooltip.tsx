"use client";

import { cloneElement, createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import styles from "./warm-tooltip.module.css";

// Adapted from the user's React Bits WarmTooltip source: shared warmth and one
// travelling label, with viewport collision handling and no canvas pointer capture.
type Side = "top" | "bottom" | "left" | "right";
type Entry = { id: string; anchor: HTMLElement; content: ReactNode; shortcut?: ReactNode; side: Side; instant: boolean };
type Group = { id: string; activeId: string | null; delay: number; warm: () => boolean; show: (entry: Entry) => void; hide: (id: string, instant?: boolean) => void };
const Context = createContext<Group | null>(null);
const EASE = [0.23, 1, 0.32, 1] as const;

export function WarmTooltipGroup({ children, delay = 400, warmWindow = 300, travel = 180 }: { children: ReactNode; delay?: number; warmWindow?: number; travel?: number }) {
  const id = useId();
  const [entry, setEntry] = useState<Entry | null>(null);
  const active = useRef<Entry | null>(null);
  const warmUntil = useRef(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hide = useCallback((target: string, instant = false) => {
    if (active.current?.id !== target) return;
    clearTimeout(closeTimer.current);
    const close = () => { active.current = null; warmUntil.current = Date.now() + warmWindow; setEntry(null); };
    if (instant) close(); else closeTimer.current = setTimeout(close, 80);
  }, [warmWindow]);
  const show = useCallback((next: Entry) => { clearTimeout(closeTimer.current); active.current = next; setEntry(next); }, []);
  const warm = useCallback(() => Boolean(active.current) || Date.now() < warmUntil.current, []);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const group = useMemo(() => ({ id, activeId: entry?.id ?? null, delay, show, hide, warm }), [id, entry?.id, delay, show, hide, warm]);
  return <Context.Provider value={group}>{children}<TooltipLayer id={id} entry={entry} travel={travel} onClose={hide} /></Context.Provider>;
}

function TooltipLayer({ id, entry, travel, onClose }: { id: string; entry: Entry | null; travel: number; onClose: Group["hide"] }) {
  const reduce = useReducedMotion();
  const measurement = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; side: Side; arrow: number } | null>(null);
  const attachMeasurement = useCallback((element: HTMLSpanElement | null) => { measurement.current = element; if (!element) setBox(null); }, []);
  useLayoutEffect(() => {
    if (!entry || !measurement.current) return;
    const place = () => {
      if (!entry.anchor.isConnected || !measurement.current) { onClose(entry.id, true); return; }
      const anchor = entry.anchor.getBoundingClientRect();
      const width = measurement.current.offsetWidth, height = measurement.current.offsetHeight;
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const right = left + (viewport?.width ?? innerWidth), bottom = top + (viewport?.height ?? innerHeight);
      const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));
      let side = entry.side;
      if (side === "top" && anchor.top - height - 9 < top + 8) side = "bottom";
      if (side === "bottom" && anchor.bottom + height + 9 > bottom - 8 && anchor.top > height + 16) side = "top";
      if (side === "left" && anchor.left - width - 9 < left + 8) side = "right";
      if (side === "right" && anchor.right + width + 9 > right - 8) side = "left";
      const horizontal = side === "top" || side === "bottom";
      const x = clamp(horizontal ? anchor.left + anchor.width / 2 - width / 2 : side === "left" ? anchor.left - width - 9 : anchor.right + 9, left + 8, right - width - 8);
      const y = clamp(horizontal ? side === "top" ? anchor.top - height - 9 : anchor.bottom + 9 : anchor.top + anchor.height / 2 - height / 2, top + 8, bottom - height - 8);
      setBox({ x, y, side, arrow: horizontal ? clamp(anchor.left + anchor.width / 2 - x, 10, width - 10) : clamp(anchor.top + anchor.height / 2 - y, 10, height - 10) });
    };
    place();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(measurement.current);
    const dismiss = () => onClose(entry.id, true);
    const outside = (event: PointerEvent) => { if (!(event.target instanceof Node) || !entry.anchor.contains(event.target)) dismiss(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { dismiss(); event.stopPropagation(); } };
    const hidden = () => { if (document.hidden) dismiss(); };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("visibilitychange", hidden);
    return () => { observer?.disconnect(); window.removeEventListener("scroll", dismiss, true); window.removeEventListener("resize", place); window.visualViewport?.removeEventListener("resize", place); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", key, true); document.removeEventListener("visibilitychange", hidden); };
  }, [entry, onClose]);
  if (typeof document === "undefined") return null;
  const instant = Boolean(reduce || entry?.instant);
  const content = entry ? <>{entry.content}{entry.shortcut ? <kbd>{entry.shortcut}</kbd> : null}</> : null;
  return createPortal(<>
    {entry ? <span ref={attachMeasurement} className={`${styles.label} ${styles.measure}`} aria-hidden="true">{content}</span> : null}
    <AnimatePresence initial={false}>{entry && box ? <motion.span key="shared-label" id={id} role="tooltip" className={styles.floating} data-side={box.side}
      initial={{ opacity: 0, transform: `translate(${box.x}px, ${box.y}px)` }} animate={{ opacity: 1, transform: `translate(${box.x}px, ${box.y}px)` }} exit={{ opacity: 0 }}
      transition={{ duration: instant ? 0 : travel / 1000, ease: EASE }}>
      <motion.span className={styles.label} initial={instant ? false : { transform: "translateY(2px) scale(0.96)" }} animate={{ transform: "translateY(0px) scale(1)" }} transition={{ duration: instant ? 0 : .16, ease: EASE }}>
        {content}<i className={styles.arrow} data-side={box.side} style={box.side === "top" || box.side === "bottom" ? { left: box.arrow } : { top: box.arrow }} aria-hidden="true" />
      </motion.span>
    </motion.span> : null}</AnimatePresence>
  </>, document.fullscreenElement ?? document.body);
}

interface Props {
  children: ReactElement<{ "aria-describedby"?: string | undefined }>;
  content: ReactNode;
  shortcut?: ReactNode;
  side?: Side;
  delay?: number;
  longPress?: number;
  disabled?: boolean;
  className?: string;
  triggerSelector?: string;
}
export default function WarmTooltip(props: Props) {
  const context = useContext(Context);
  return context ? <Trigger {...props} group={context} /> : <WarmTooltipGroup><WarmTooltip {...props} /></WarmTooltipGroup>;
}
function Trigger({ group, content, shortcut, children, side = "top", delay, longPress = 500, disabled = false, className = "", triggerSelector }: Props & { group: Group }) {
  const id = useId();
  const hide = group.hide;
  const anchor = useRef<HTMLSpanElement>(null);
  const timers = useRef<{ open?: ReturnType<typeof setTimeout> | undefined; press?: ReturnType<typeof setTimeout> | undefined; point?: { x: number; y: number } | undefined; suppressClick: boolean; touch: boolean }>({ suppressClick: false, touch: false });
  const clear = () => { clearTimeout(timers.current.open); clearTimeout(timers.current.press); timers.current.point = undefined; };
  const show = (instant = false) => { if (!disabled && anchor.current?.isConnected) group.show({ id, anchor: anchor.current, content, shortcut, side, instant }); };
  useEffect(() => {
    const owned = timers.current;
    return () => { clearTimeout(owned.open); clearTimeout(owned.press); hide(id, true); };
  }, [hide, id]);
  useEffect(() => { if (disabled) { clearTimeout(timers.current.open); clearTimeout(timers.current.press); hide(id, true); } }, [disabled, hide, id]);
  useLayoutEffect(() => {
    if (!triggerSelector || group.activeId !== id) return;
    const target = anchor.current?.querySelector<HTMLElement>(triggerSelector);
    if (!target) return;
    const existing = target.getAttribute("aria-describedby");
    target.setAttribute("aria-describedby", [existing, group.id].filter(Boolean).join(" "));
    return () => { if (existing) target.setAttribute("aria-describedby", existing); else target.removeAttribute("aria-describedby"); };
  }, [group.activeId, group.id, id, triggerSelector]);
  const described = [children.props["aria-describedby"], group.activeId === id ? group.id : null].filter(Boolean).join(" ") || undefined;
  return <span ref={anchor} className={`${styles.trigger} ${className}`} data-warm-tooltip-trigger
    onPointerEnter={(event) => { if (disabled || event.pointerType === "touch" || event.buttons) return; clear(); timers.current.touch = false; if (group.warm()) show(); else timers.current.open = setTimeout(() => show(), delay ?? group.delay); }}
    onPointerLeave={(event) => { clear(); if (event.pointerType !== "touch") group.hide(id); }}
    onPointerDown={(event) => {
      clear(); timers.current.suppressClick = false; timers.current.touch = event.pointerType === "touch";
      group.hide(id, true);
      if (!disabled && event.pointerType === "touch") {
        timers.current.point = { x: event.clientX, y: event.clientY };
        timers.current.press = setTimeout(() => { timers.current.point = undefined; timers.current.suppressClick = true; show(); }, longPress);
      }
    }}
    onPointerMove={(event) => { const point = timers.current.point; if (point && Math.hypot(point.x - event.clientX, point.y - event.clientY) > 10) clear(); }}
    onPointerUp={clear} onPointerCancel={() => { clear(); group.hide(id, true); }}
    onClickCapture={(event) => { if (timers.current.suppressClick) { timers.current.suppressClick = false; event.preventDefault(); event.stopPropagation(); } else group.hide(id, true); }}
    onContextMenu={(event) => { if (timers.current.point || timers.current.suppressClick) event.preventDefault(); }}
    onFocus={(event) => { if (event.currentTarget.contains(event.target) && !timers.current.touch && event.target.matches(":focus-visible")) { clear(); show(true); } }}
    onBlur={() => { clear(); group.hide(id, true); }}>
    {triggerSelector ? children : cloneElement(children, described ? { "aria-describedby": described } : {})}
  </span>;
}
