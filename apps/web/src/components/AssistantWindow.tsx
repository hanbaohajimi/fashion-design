"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type RefObject,
} from "react";
import {
  ASSISTANT_WINDOW,
  constrainAssistantBounds,
  initialAssistantBounds,
  resizeAssistantBounds,
  type AssistantBounds,
  type AssistantPresentation,
  type AssistantResizeEdge,
} from "./assistant-window-geometry";
import {
  readWorkspacePreference,
  saveWorkspacePreference,
} from "./workspace-preferences";
import styles from "./workspace-split.module.css";

export interface AssistantWindowControls {
  mode: "floating" | "docked" | "mobile";
  canDock: boolean;
  setPresentation: (value: AssistantPresentation) => void;
  close: () => void;
  reset: () => void;
  dragProps: HTMLAttributes<HTMLElement>;
}
export const AssistantWindowContext =
  createContext<AssistantWindowControls | null>(null);
export const useAssistantWindow = () => useContext(AssistantWindowContext);

const edges: AssistantResizeEdge[] = [
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
];
const edgeNames = {
  n: "上边",
  s: "下边",
  e: "右边",
  w: "左边",
  ne: "右上角",
  nw: "左上角",
  se: "右下角",
  sw: "左下角",
};

/** Gestures update only the window's styles. Chat and canvas are never rerendered per frame. */
export function useFloatingAssistant(
  host: RefObject<HTMLDivElement | null>,
  surface: RefObject<HTMLDialogElement | null>,
  key: string,
  active: boolean,
  enabled = true,
) {
  const rect = useRef<AssistantBounds>({
    x: ASSISTANT_WINDOW.gap,
    y: ASSISTANT_WINDOW.gap,
    width: ASSISTANT_WINDOW.width,
    height: ASSISTANT_WINDOW.height,
  });
  const restored = useRef(false);
  const gesture = useRef<{
    pointerId: number;
    x: number;
    y: number;
    start: AssistantBounds;
    edge?: AssistantResizeEdge;
  } | null>(null);
  const keyboardStart = useRef<AssistantBounds | null>(null);
  const size = () => ({
    width: host.current?.clientWidth ?? window.innerWidth,
    height: host.current?.clientHeight ?? window.innerHeight,
  });
  const paint = (next: AssistantBounds) => {
    rect.current = next;
    const element = surface.current;
    if (!element) return;
    element.style.setProperty("--assistant-x", `${next.x}px`);
    element.style.setProperty("--assistant-y", `${next.y}px`);
    element.style.setProperty("--assistant-width", `${next.width}px`);
    element.style.setProperty("--assistant-height", `${next.height}px`);
    element.querySelectorAll<HTMLElement>("[data-edge]").forEach((handle) => {
      handle.setAttribute(
        "aria-valuenow",
        String(
          handle.dataset.edge === "n" || handle.dataset.edge === "s"
            ? next.height
            : next.width,
        ),
      );
    });
  };
  const save = () => {
    if (restored.current)
      saveWorkspacePreference(key, { floatingBounds: rect.current });
  };
  const cancel = () => {
    const previous = gesture.current?.start ?? keyboardStart.current;
    gesture.current = null;
    keyboardStart.current = null;
    if (previous) paint(constrainAssistantBounds(previous, size()));
    surface.current?.removeAttribute("data-adjusting");
  };
  const latest = useRef({ size, paint, save, cancel });
  useLayoutEffect(() => {
    latest.current = { size, paint, save, cancel };
  });
  useLayoutEffect(() => {
    if (!enabled) return;
    restored.current = false;
    const saved = readWorkspacePreference(key).floatingBounds;
    const next = saved ?? initialAssistantBounds(latest.current.size());
    latest.current.paint(constrainAssistantBounds(next, latest.current.size()));
    restored.current = true;
    const resize = () => {
      latest.current.cancel();
      latest.current.paint(
        constrainAssistantBounds(rect.current, latest.current.size()),
      );
    };
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    if (host.current) observer?.observe(host.current);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      latest.current.cancel();
      observer?.disconnect();
      window.visualViewport?.removeEventListener("resize", resize);
      restored.current = false;
    };
  }, [key, host, enabled]);
  useLayoutEffect(() => {
    if (!active) {
      latest.current.cancel();
      return;
    }
    latest.current.paint(rect.current);
    let frame = 0;
    let pending: AssistantBounds | null = null;
    const move = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      event.preventDefault();
      const dx = event.clientX - current.x,
        dy = event.clientY - current.y;
      pending = current.edge
        ? resizeAssistantBounds(
            current.start,
            current.edge,
            dx,
            dy,
            latest.current.size(),
          )
        : constrainAssistantBounds(
            {
              ...current.start,
              x: current.start.x + dx,
              y: current.start.y + dy,
            },
            latest.current.size(),
          );
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (pending && gesture.current) latest.current.paint(pending);
          pending = null;
        });
    };
    const finish = (event: PointerEvent) => {
      if (gesture.current?.pointerId !== event.pointerId) return;
      cancelAnimationFrame(frame);
      frame = 0;
      if (pending) latest.current.paint(pending);
      pending = null;
      gesture.current = null;
      surface.current?.removeAttribute("data-adjusting");
      latest.current.save();
    };
    const abort = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      pending = null;
      latest.current.cancel();
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        (gesture.current || keyboardStart.current)
      ) {
        event.preventDefault();
        event.stopPropagation();
        abort();
      }
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", abort);
    window.addEventListener("blur", abort);
    window.addEventListener("keydown", escape, true);
    return () => {
      abort();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", abort);
      window.removeEventListener("blur", abort);
      window.removeEventListener("keydown", escape, true);
    };
  }, [active, surface]);
  const gestureProps = (
    edge?: AssistantResizeEdge,
  ): HTMLAttributes<HTMLElement> => ({
    tabIndex: active ? 0 : undefined,
    onPointerDown: (event) => {
      if (!active || gesture.current || event.button !== 0 || !event.isPrimary)
        return;
      if (
        !edge &&
        (event.target as Element).closest(
          "button, summary, input, textarea, a, [role=menu]",
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      keyboardStart.current = null;
      gesture.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        start: { ...rect.current },
        ...(edge ? { edge } : {}),
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      surface.current?.setAttribute("data-adjusting", "true");
    },
    onKeyDown: (event) => {
      if (
        !active ||
        event.target !== event.currentTarget ||
        event.nativeEvent.isComposing
      )
        return;
      if (event.key === "Enter") {
        keyboardStart.current = null;
        save();
        return;
      }
      if (
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      keyboardStart.current ??= { ...rect.current };
      const step = event.shiftKey ? 32 : 8;
      const dx =
        event.key === "ArrowLeft"
          ? -step
          : event.key === "ArrowRight"
            ? step
            : 0;
      const dy =
        event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      paint(
        edge
          ? resizeAssistantBounds(rect.current, edge, dx, dy, size())
          : constrainAssistantBounds(
              {
                ...rect.current,
                x: rect.current.x + dx,
                y: rect.current.y + dy,
              },
              size(),
            ),
      );
    },
    onBlur: () => {
      if (keyboardStart.current) {
        keyboardStart.current = null;
        save();
      }
    },
  });
  return {
    dragProps: gestureProps(),
    reset: () => {
      cancel();
      paint(initialAssistantBounds(size()));
      save();
    },
    handles: active
      ? edges.map((edge) => (
          <div
            key={edge}
            {...gestureProps(edge)}
            className={styles.windowHandle}
            data-edge={edge}
            role="separator"
            aria-label={`调整助手浮窗${edgeNames[edge]}`}
            aria-orientation={
              edge === "n" || edge === "s" ? "horizontal" : "vertical"
            }
            aria-valuenow={
              edge === "n" || edge === "s"
                ? ASSISTANT_WINDOW.height
                : ASSISTANT_WINDOW.width
            }
          />
        ))
      : null,
  };
}
