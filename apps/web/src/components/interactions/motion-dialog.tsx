"use client";

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { useAnimatedPresence } from "./use-animated-presence";
import { motionEase, motionTime } from "./motion-policy";
import styles from "../ui.module.css";

export function MotionDialog({ open = true, label, children, onClose, onAfterClose,
  returnFocusSelector, describedBy, busy = false, className = "", variant = "dialog" }: {
  readonly open?: boolean;
  readonly label: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly onAfterClose?: (() => void) | undefined;
  readonly returnFocusSelector?: string | undefined;
  readonly describedBy?: string | undefined;
  readonly busy?: boolean;
  readonly className?: string | undefined;
  readonly variant?: "dialog" | "sheet" | "guide";
}) {
  const title = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const previous = useRef<Element | null>(null);
  const pathname = useRef("");
  const inert = useRef(new Map<HTMLElement, boolean>());
  const restoreChildren = () => { inert.current.forEach((value, child) => { child.inert = value; }); inert.current.clear(); };
  const returnFocus = () => {
    if (document.hidden || pathname.current !== location.pathname) return;
    if (variant === "guide") {
      const blocker = [...document.querySelectorAll<HTMLElement>('dialog[open],[role="dialog"][aria-modal="true"],[data-popup-kind]')].filter(element => !element.closest("[data-feature-guide]") && element.checkVisibility({ checkVisibilityCSS: true }) && element.getClientRects().length).at(-1);
      if (blocker) {
        if (!blocker.contains(document.activeElement)) {
          const next = blocker.querySelector<HTMLElement>('[autofocus],[data-autofocus],button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])') ?? blocker;
          if (next === blocker && !next.hasAttribute("tabindex")) next.tabIndex = -1;
          next.focus({ preventScroll: true });
        }
        return;
      }
    }
    const target = (returnFocusSelector ? document.querySelector(returnFocusSelector) : null) ?? previous.current;
    const activeDialog = [...document.querySelectorAll("dialog[open]")].at(-1);
    if (activeDialog && (!(target instanceof Node) || !activeDialog.contains(target))) return;
    const fallback = document.querySelector<HTMLElement>("#main-content h1, main h1, #main-content");
    const safeTarget = target instanceof HTMLElement && target.isConnected && !target.closest("[inert],[hidden]") && !(variant === "guide" && target.matches('input,textarea,select,[contenteditable="true"]'));
    const focus = safeTarget ? target : fallback;
    if (focus instanceof HTMLElement) { if (!focus.hasAttribute("tabindex") && focus === fallback) focus.tabIndex = -1; focus.focus({ preventScroll: variant === "guide" }); }
  };
  const presence = useAnimatedPresence<HTMLDialogElement>(open, ref, {
    enter: { opacity: 0, transform: variant === "guide" ? "none" : variant === "sheet" ? "translateY(100%)" : "translateY(8px) scale(.98)" },
    enterToken: variant === "guide" ? "--motion-guide-enter" : variant === "sheet" ? "--motion-sheet-enter" : "--motion-dialog-enter",
    exitToken: variant === "guide" ? "--motion-guide-exit" : variant === "sheet" ? "--motion-sheet-exit" : "--motion-dialog-exit",
    enterMs: variant === "guide" ? 150 : variant === "sheet" ? 400 : 350, exitMs: variant === "guide" ? 120 : variant === "sheet" ? 300 : 250,
    onOpening() {
      const dialog = ref.current;
      if (!dialog) return;
      restoreChildren();
      if (!dialog.open) {
        previous.current = document.activeElement;
        pathname.current = location.pathname;
        dialog.showModal();
        (dialog.querySelector<HTMLElement>("[autofocus], [data-autofocus]") ?? dialog.querySelector<HTMLElement>("input:not(:disabled):not([type=hidden]),textarea:not(:disabled),select:not(:disabled)") ?? dialog.querySelector<HTMLElement>("button:not(:disabled)") ?? dialog).focus();
      }
    },
    onClosing() {
      const dialog = ref.current;
      if (!dialog?.open) return;
      if (variant !== "guide" || [...document.querySelectorAll("dialog[open]")].at(-1) === dialog) dialog.focus();
      [...dialog.children].forEach(child => { if (child instanceof HTMLElement) { inert.current.set(child, Boolean(child.inert)); child.inert = true; } });
    },
    onClosed() {
      ref.current?.close();
      restoreChildren();
      returnFocus();
      onAfterClose?.();
    },
  });
  const closeRef = useRef(returnFocus);
  useLayoutEffect(() => { closeRef.current = returnFocus; });
  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) { dialog.close(); closeRef.current(); }
      restoreChildren();
    };
  }, [ref]);
  const gesture = useRef<{ id: number; y: number; last: number; time: number; velocity: number; distance: number; height: number; handle: HTMLElement } | null>(null);
  const frame = useRef<number | null>(null);
  const latestOpen = useRef(open);
  const dragAnimation = useRef<Animation | null>(null);
  useLayoutEffect(() => { latestOpen.current = open; });
  const resetDrag = () => {
    dragAnimation.current?.cancel();
    dragAnimation.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const drag = gesture.current;
    if (drag?.handle.hasPointerCapture?.(drag.id)) drag.handle.releasePointerCapture(drag.id);
    gesture.current = null;
    const dialog = ref.current;
    if (dialog) { dialog.style.removeProperty("transform"); dialog.style.removeProperty("--sheet-dim"); }
  };
  useEffect(() => {
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const visibility = () => { if (document.hidden) resetDrag(); };
    window.addEventListener("blur", resetDrag);
    document.addEventListener("visibilitychange", visibility);
    preference?.addEventListener("change", resetDrag);
    return () => { resetDrag(); window.removeEventListener("blur", resetDrag); document.removeEventListener("visibilitychange", visibility); preference?.removeEventListener("change", resetDrag); };
  // Refs own each drag; callbacks never change business state.
  }, []);
  useEffect(() => { if (!open || busy) resetDrag(); });
  return <dialog ref={ref} tabIndex={-1} aria-label={label} aria-describedby={describedBy} aria-busy={busy || undefined}
    className={`${styles.dialog} ${className}`} data-dialog-id={title} data-phase={presence.phase} data-variant={variant} data-feature-guide={variant === "guide" || undefined}
    onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); if (open) onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget || !open) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    }}
    onPointerDown={event => {
      if (variant !== "sheet" || !open || presence.phase !== "open" || busy || event.button !== 0 || event.isPrimary === false || gesture.current || event.defaultPrevented) return;
      const handle = (event.target as Element).closest<HTMLElement>("[data-sheet-handle]");
      if (!handle || (event.target as Element).closest("button,a,input,select,textarea")) return;
      gesture.current = { id: event.pointerId, y: event.clientY, last: event.clientY, time: event.timeStamp, velocity: 0, distance: 0, height: event.currentTarget.getBoundingClientRect().height, handle };
      handle.setPointerCapture?.(event.pointerId);
    }}
    onPointerMove={event => {
      const drag = gesture.current;
      if (!drag || drag.id !== event.pointerId) return;
      drag.velocity = (event.clientY - drag.last) / Math.max(1, event.timeStamp - drag.time);
      drag.last = event.clientY; drag.time = event.timeStamp;
      const delta = event.clientY - drag.y;
      drag.distance = delta < 0 ? delta * .2 : delta;
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const current = gesture.current;
        const dialog = ref.current;
        if (!current || !dialog) return;
        dialog.style.transform = `translateY(${current.distance}px)`;
        dialog.style.setProperty("--sheet-dim", `${Math.max(0, 1 - current.distance / Math.max(1, current.height))}`);
      });
    }}
    onPointerUp={event => {
      const drag = gesture.current;
      const dialog = ref.current;
      if (!drag || !dialog || drag.id !== event.pointerId) return;
      const distance = drag.distance;
      const velocity = event.timeStamp - drag.time <= 120 ? drag.velocity : 0;
      const dismiss = distance > drag.height / 3 || (distance > 24 && velocity > 1);
      resetDrag();
      const returnToOrigin = () => {
        dialog.style.removeProperty("transform");
        dialog.style.removeProperty("--sheet-dim");
        const duration = motionTime("--motion-sheet-enter", 400);
        if (duration) dragAnimation.current = dialog.animate?.([{ transform: `translateY(${distance}px)` }, { transform: "none" }], { duration, easing: motionEase() }) ?? null;
      };
      if (dismiss) {
        dialog.style.transform = `translateY(${distance}px)`;
        onClose();
        frame.current = requestAnimationFrame(() => { frame.current = null; if (latestOpen.current) returnToOrigin(); });
      } else returnToOrigin();
    }}
    onPointerCancel={event => { if (gesture.current?.id === event.pointerId) resetDrag(); }}
    onLostPointerCapture={event => { if (gesture.current?.id === event.pointerId) resetDrag(); }}
    onKeyDownCapture={event => {
      if (variant === "guide") event.stopPropagation();
      if (event.key !== "Tab") return;
      event.stopPropagation();
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),textarea:not(:disabled),select:not(:disabled),summary,[tabindex]:not([tabindex="-1"])')]
        .filter(item => item.getClientRects().length > 0 && !item.closest("[inert],[hidden]"));
      const first = items[0], last = items.at(-1);
      if (!first || !last) { event.preventDefault(); event.currentTarget.focus(); }
      else if (!event.currentTarget.contains(document.activeElement) || document.activeElement === event.currentTarget || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    }}
  >{presence.present ? children : null}</dialog>;
}
