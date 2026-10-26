"use client";

import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import styles from "./pointer-effects.module.css";

const reducedMotion = "(prefers-reduced-motion: reduce)";
const forcedColors = "(forced-colors: active)";
const fineHover = "(hover: hover) and (pointer: fine)";

function permitsMotion(mouseOnly: boolean): boolean {
  return (
    typeof window.matchMedia === "function" &&
    !window.matchMedia(reducedMotion).matches &&
    !window.matchMedia(forcedColors).matches &&
    (!mouseOnly || window.matchMedia(fineHover).matches)
  );
}

function observePreferences(reset: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const queries = [reducedMotion, forcedColors, fineHover].map((query) =>
    window.matchMedia(query),
  );
  queries.forEach((query) => query.addEventListener("change", reset));
  window.addEventListener("blur", reset);
  return () => {
    queries.forEach((query) => query.removeEventListener("change", reset));
    window.removeEventListener("blur", reset);
  };
}

/** Only decoration is imperative: business clicks and form submission remain native. */
export function useRipple(enabled: boolean, blocked: boolean) {
  const layerRef = useRef<HTMLSpanElement>(null);
  const ripples = useRef<{ element: HTMLSpanElement; pointerId: number }[]>([]);
  const clear = () => {
    ripples.current.forEach(({ element }) => element.remove());
    ripples.current = [];
  };
  useEffect(() => {
    if (!enabled) return;
    const stopObserving = observePreferences(clear);
    return () => {
      stopObserving();
      clear();
    };
  }, [enabled]);

  return {
    layerRef,
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (
        !enabled ||
        blocked ||
        event.button !== 0 ||
        !event.isPrimary ||
        !permitsMotion(false)
      )
        return;
      const layer = layerRef.current;
      if (!layer) return;
      const bounds = layer.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const radius = Math.hypot(
        Math.max(x, bounds.width - x),
        Math.max(y, bounds.height - y),
      );
      const element = document.createElement("span");
      element.className = styles.rippleInk ?? "";
      element.style.width = element.style.height = `${radius * 2}px`;
      element.style.left = `${x - radius}px`;
      element.style.top = `${y - radius}px`;
      const remove = () => {
        element.remove();
        ripples.current = ripples.current.filter(
          (ripple) => ripple.element !== element,
        );
      };
      element.addEventListener("animationend", remove, { once: true });
      element.addEventListener("animationcancel", remove, { once: true });
      while (ripples.current.length >= 2)
        ripples.current.shift()?.element.remove();
      ripples.current.push({ element, pointerId: event.pointerId });
      layer.append(element);
    },
    onPointerCancel(event: ReactPointerEvent<HTMLElement>) {
      ripples.current
        .filter((ripple) => ripple.pointerId === event.pointerId)
        .forEach(({ element }) => element.remove());
      ripples.current = ripples.current.filter(
        (ripple) => ripple.pointerId !== event.pointerId,
      );
    },
  };
}

/** The host never moves, so its hit area, focus ring and layout remain stable. */
export function useMagnetic(enabled = true) {
  const visualRef = useRef<HTMLSpanElement>(null);
  const frame = useRef<number | null>(null);
  const pressed = useRef(false);
  const target = useRef({ x: 0, y: 0 });
  const reset = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const visual = visualRef.current;
    if (visual) {
      visual.style.transform = "translate3d(0px, 0px, 0px)";
      delete visual.dataset.magneticTracking;
      delete visual.dataset.magneticPressed;
    }
    pressed.current = false;
  };
  useEffect(() => {
    if (!enabled) {
      reset();
      return;
    }
    const stopObserving = observePreferences(reset);
    return () => {
      stopObserving();
      reset();
    };
  }, [enabled]);

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || event.pointerType !== "mouse" || !permitsMotion(true)) {
      reset();
      return;
    }
    if (pressed.current || event.buttons !== 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    target.current = {
      x: Math.max(
        -4,
        Math.min(4, (event.clientX - bounds.left - bounds.width / 2) * 0.12),
      ),
      y: Math.max(
        -4,
        Math.min(4, (event.clientY - bounds.top - bounds.height / 2) * 0.12),
      ),
    };
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (visualRef.current) {
        visualRef.current.dataset.magneticTracking = "true";
        visualRef.current.style.transform = `translate3d(${target.current.x}px, ${target.current.y}px, 0px)`;
      }
    });
  };
  return {
    visualRef,
    onPointerEnter: move,
    onPointerMove: move,
    onPointerDown() {
      if (!enabled) return;
      reset();
      pressed.current = true;
      if (visualRef.current) visualRef.current.dataset.magneticPressed = "true";
    },
    onPointerUp(event: ReactPointerEvent<HTMLElement>) {
      pressed.current = false;
      if (visualRef.current) delete visualRef.current.dataset.magneticPressed;
      move(event);
    },
    onPointerLeave: reset,
    onPointerCancel: reset,
    onBlur: reset,
    onFocus: reset,
  };
}

export function usePointerSpotlight() {
  const hostRef = useRef<HTMLElement>(null);
  const frame = useRef<number | null>(null);
  const target = useRef({ x: 0, y: 0 });
  const reset = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (hostRef.current) delete hostRef.current.dataset.spotlightActive;
    // Keep the last position while opacity fades out.
  };
  useEffect(() => {
    const stopObserving = observePreferences(reset);
    return () => {
      stopObserving();
      reset();
    };
  }, []);
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" || !permitsMotion(true)) {
      reset();
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    target.current = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const host = hostRef.current;
      if (!host) return;
      host.style.setProperty("--spot-x", `${target.current.x}px`);
      host.style.setProperty("--spot-y", `${target.current.y}px`);
      if (!host.hasAttribute("data-spotlight-active"))
        host.dataset.spotlightActive = "true";
    });
  };
  return {
    hostRef,
    onPointerEnter: move,
    onPointerMove: move,
    onPointerLeave: reset,
    onPointerCancel: reset,
  };
}
