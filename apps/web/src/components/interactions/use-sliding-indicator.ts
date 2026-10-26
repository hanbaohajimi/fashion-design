"use client";

import { useLayoutEffect, useRef } from "react";
import { motionEase, motionTime, observeMotionCancellation } from "./motion-policy";
import styles from "./shared-motion.module.css";

/** Opt-in, decorative underline; the buttons retain their original semantics. */
export function useSlidingIndicator(value: string, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const prior = useRef<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!enabled || !host) { prior.current = null; return; }
    const line = document.createElement("span");
    line.className = styles.indicator ?? "";
    line.setAttribute("aria-hidden", "true");
    host.append(line);
    let animation: Animation | undefined;
    const position = (animate = false) => {
      const button = [...host.querySelectorAll<HTMLElement>("[data-indicator-value]")].find(item => item.dataset.indicatorValue === value);
      if (!button) return;
      const a = host.getBoundingClientRect();
      const b = button.getBoundingClientRect();
      const next = { left: b.left - a.left + host.scrollLeft, width: b.width };
      const old = prior.current;
      prior.current = next;
      line.style.width = `${next.width}px`;
      line.style.transform = `translateX(${next.left}px)`;
      const duration = motionTime("--motion-indicator", 350);
      if (animate && old && next.width > 0 && duration && line.animate) {
        const right = next.left > old.left;
        animation = line.animate([0, .37, .6, 1].map(progress => {
          const lead = Math.min(1, progress / .6);
          const tail = Math.max(0, (progress - .37) / .63);
          const left = old.left + (next.left - old.left) * (right ? tail : lead);
          const edge = old.left + old.width + (next.left + next.width - old.left - old.width) * (right ? lead : tail);
          return { transform: `translateX(${left}px) scaleX(${(edge - left) / next.width})`, offset: progress };
        }), { duration, easing: motionEase() });
      }
    };
    position(true);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => position());
    resize?.observe(host);
    const cancel = () => animation?.cancel();
    const stop = observeMotionCancellation(cancel);
    return () => {
      if (animation?.playState === "running") {
        const matrix = new DOMMatrix(getComputedStyle(line).transform);
        prior.current = { left: matrix.m41, width: line.getBoundingClientRect().width };
      }
      cancel(); resize?.disconnect(); stop(); line.remove();
    };
  }, [value, enabled]);
  return ref;
}
