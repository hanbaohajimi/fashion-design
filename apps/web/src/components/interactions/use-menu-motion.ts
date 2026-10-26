"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import { motionEase, motionTime, observeMotionCancellation } from "./motion-policy";
import { afterSurfaceMotion } from "./floating-position";

/** Native details closes immediately. Only a noninteractive visual may outlive it. */
export function useMenuMotion(open: boolean, panel: RefObject<HTMLDivElement | null>, placement: "top" | "bottom") {
  const previous = useRef<{ element: HTMLDivElement; bounds: DOMRect; container: Element; above: boolean } | null>(null);
  const active = useRef<Animation[]>([]);
  const ghost = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const moving = ghost.current ?? (active.current.some(animation => animation.playState === "running") ? previous.current?.element : null);
    const computed = moving ? getComputedStyle(moving) : null;
    const interrupted = computed ? { opacity: computed.opacity, transform: computed.transform } : null;
    active.current.forEach(animation => animation.cancel());
    active.current = [];
    ghost.current?.remove(); ghost.current = null;
    if (open && panel.current) {
      const element = panel.current;
      const container = element.closest("dialog[open]") ?? document.body;
      const capture = () => {
        if (!element.isConnected) return;
        const rect = element.getBoundingClientRect();
        const fixed = element.style.position === "fixed";
        const bounds = fixed ? DOMRect.fromRect({ x: Number.parseFloat(element.style.left) || rect.left, y: Number.parseFloat(element.style.top) || rect.top, width: element.offsetWidth || rect.width, height: element.offsetHeight || rect.height }) : rect;
        const above = element.dataset.actualPlacement ? element.dataset.actualPlacement === "top" : placement === "top";
        previous.current = { element, bounds, container, above };
      };
      capture();
      const duration = motionTime("--motion-menu-enter", 300);
      if (!duration || !element.animate || document.hidden) return;
      const above = previous.current?.above ?? placement === "top";
      element.style.setProperty("transform-origin", above ? "bottom right" : "top right");
      active.current.push(element.animate([
        interrupted ?? { opacity: 0, transform: `translateY(${above ? 6 : -6}px) scale(.98)` },
        { opacity: 1, transform: "none" },
      ], { duration, easing: motionEase() }));
      [...element.querySelectorAll<HTMLElement>("button,a")].slice(0, 6).forEach((item, index) => {
        active.current.push(item.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 100, delay: index * 40, easing: motionEase(), fill: "backwards" }));
      });
      window.addEventListener("resize", capture);
      window.addEventListener("scroll", capture, true);
      const stopSurface = afterSurfaceMotion(element, capture);
      const stop = observeMotionCancellation(() => active.current.forEach(animation => animation.cancel()));
      return () => { window.removeEventListener("resize", capture); window.removeEventListener("scroll", capture, true); stopSurface(); stop(); };
    } else if (previous.current) {
      const { element, bounds, container, above } = previous.current;
      previous.current = null;
      const duration = motionTime("--motion-menu-exit", 200);
      if (!duration || !element.animate || document.hidden || !bounds.width) return;
      if (!container.isConnected || (container instanceof HTMLDialogElement && !container.open)) return;
      const clone = element.cloneNode(true) as HTMLElement;
      clone.inert = true;
      clone.setAttribute("aria-hidden", "true");
      clone.removeAttribute("id");
      clone.querySelectorAll("[id]").forEach(item => item.removeAttribute("id"));
      Object.assign(clone.style, { position: "fixed", inset: "auto", left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px`, pointerEvents: "none", margin: "0", boxSizing: "border-box" });
      container.append(clone);
      ghost.current = clone;
      const animation = clone.animate([interrupted ?? { opacity: 1, transform: "none" }, { opacity: 0, transform: `translateY(${above ? 6 : -6}px) scale(.98)` }], { duration, easing: motionEase(true) });
      animation.onfinish = () => { clone.remove(); if (ghost.current === clone) ghost.current = null; };
      active.current.push(animation);
    }
    const cancel = () => { active.current.forEach(animation => animation.cancel()); ghost.current?.remove(); ghost.current = null; };
    return observeMotionCancellation(cancel);
  }, [open, panel, placement]);
  useLayoutEffect(() => () => { active.current.forEach(animation => animation.cancel()); ghost.current?.remove(); }, []);
}
