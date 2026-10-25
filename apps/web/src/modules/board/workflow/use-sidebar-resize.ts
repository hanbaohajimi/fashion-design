"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { STUDIO_LAYOUT } from "../../../components/ui-config";

export function sidebarMaximum(available: number) {
  return Math.max(
    STUDIO_LAYOUT.sidebarMin,
    Math.min(STUDIO_LAYOUT.sidebarMax, available - STUDIO_LAYOUT.canvasMin),
  );
}
const clamp = (width: number, maximum: number) =>
  Math.max(STUDIO_LAYOUT.sidebarMin, Math.min(maximum, width));
interface Drag {
  id: number;
  startX: number;
  startWidth: number;
  draft: number;
  max: number;
  target: HTMLElement;
}

export function useSidebarResize(enabled: boolean) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(STUDIO_LAYOUT.sidebarDefault);
  const [maximum, setMaximum] = useState<number>(STUDIO_LAYOUT.sidebarMax);
  const drag = useRef<Drag | null>(null);
  const frame = useRef(0);
  const paint = useCallback((value: number, target?: HTMLElement) => {
    workspaceRef.current?.style.setProperty(
      "--studio-sidebar-width",
      `${value}px`,
    );
    target?.setAttribute("aria-valuenow", String(value));
  }, []);
  const cancel = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    paint(current.startWidth, current.target);
    if (current.target.hasPointerCapture(current.id))
      current.target.releasePointerCapture(current.id);
    workspaceRef.current?.removeAttribute("data-resizing");
  }, [paint]);

  useEffect(() => {
    const measure = () => {
      cancel();
      const max = sidebarMaximum(
        workspaceRef.current?.clientWidth ?? window.innerWidth,
      );
      setMaximum(max);
      if (enabled) setWidth((current) => clamp(current, max));
    };
    const initial = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("blur", cancel);
    return () => {
      cancelAnimationFrame(initial);
      window.removeEventListener("resize", measure);
      window.removeEventListener("blur", cancel);
      cancel();
    };
  }, [enabled, cancel]);

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.id) return;
    current.draft = clamp(
      current.startWidth + current.startX - event.clientX,
      current.max,
    );
    if (!frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (drag.current) paint(drag.current.draft, drag.current.target);
      });
  };
  return {
    workspaceRef,
    width,
    maximum,
    resizerProps: {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (!enabled || !event.isPrimary || event.button !== 0 || drag.current)
          return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          id: event.pointerId,
          startX: event.clientX,
          startWidth: width,
          draft: width,
          max: maximum,
          target: event.currentTarget,
        };
        workspaceRef.current?.setAttribute("data-resizing", "true");
      },
      onPointerMove: move,
      onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
        const current = drag.current;
        if (!current || event.pointerId !== current.id) return;
        const final = clamp(
          current.startWidth + current.startX - event.clientX,
          current.max,
        );
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        drag.current = null;
        paint(final, current.target);
        setWidth(final);
        workspaceRef.current?.removeAttribute("data-resizing");
        if (current.target.hasPointerCapture(current.id))
          current.target.releasePointerCapture(current.id);
      },
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        const next =
          event.key === "Home"
            ? STUDIO_LAYOUT.sidebarMin
            : event.key === "End"
              ? maximum
              : event.key === "ArrowLeft"
                ? width + STUDIO_LAYOUT.resizeStep
                : event.key === "ArrowRight"
                  ? width - STUDIO_LAYOUT.resizeStep
                  : null;
        if (next === null) return;
        event.preventDefault();
        cancel();
        setWidth(clamp(next, maximum));
      },
    },
  };
}
