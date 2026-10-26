"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { taskState } from "../../../components/task-feedback-state";
import { motionTime, motionEase, observeMotionCancellation } from "../../../components/interactions/motion-policy";
import styles from "./workflow-detail-workspace.module.css";

export interface DetailOrigin {
  x: number;
  y: number;
  width: number;
  height: number;
  keyboard: boolean;
}

export function WorkflowDetailWorkspace({
  open,
  title,
  status,
  origin,
  dirty,
  onClose,
  children,
  fullScreen = false,
}: {
  fullScreen?: boolean;
  open: boolean;
  title: string;
  status: string;
  origin: DetailOrigin | null;
  dirty: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const wasOpen = useRef(false);
  const animations = useRef<Animation[]>([]);
  useLayoutEffect(
    () => () => {
      animations.current.forEach((animation) => animation.cancel());
    },
    [],
  );
  useLayoutEffect(() => {
    const element = root.current;
    const surface = shell.current;
    const content = body.current;
    if (!element || !surface || !content) return;
    if (!open && !wasOpen.current) {
      element.hidden = true;
      return;
    }
    wasOpen.current = open;
    element.hidden = false;
    element.inert = !open;
    const reduced =
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      origin?.keyboard;
    const bounds = surface.getBoundingClientRect();
    const visibleOrigin =
      origin &&
      origin.x + origin.width > bounds.left &&
      origin.x < bounds.right &&
      origin.y + origin.height > bounds.top &&
      origin.y < bounds.bottom;
    const transform = visibleOrigin
      ? `translate(${origin.x - bounds.x}px, ${origin.y - bounds.y}px) scale(${origin.width / bounds.width}, ${origin.height / bounds.height})`
      : "none";
    const duration = reduced
      ? 0
      : motionTime(open ? "--motion-dialog-enter" : "--motion-dialog-exit", open ? 350 : 250);
    const ease = motionEase(!open);
    const currentSurface = getComputedStyle(surface);
    const interrupted = animations.current.some(
      (animation) => animation.playState === "running",
    );
    const from = {
      transform: interrupted
        ? currentSurface.transform
        : open
          ? transform
          : "none",
      opacity: interrupted ? currentSurface.opacity : open ? 0.6 : 1,
    };
    const bodyOpacity = interrupted
      ? getComputedStyle(content).opacity
      : open
        ? 0
        : 1;
    animations.current.forEach((animation) => animation.cancel());
    const animation = surface.animate(
      [from, { transform: open ? "none" : transform, opacity: open ? 1 : 0 }],
      { duration, easing: ease, fill: "both" },
    );
    const contentDelay = open && duration > 0 ? Math.min(40, duration) : 0;
    const fade = content.animate(
      [{ opacity: bodyOpacity }, { opacity: open ? 1 : 0 }],
      { duration: duration - contentDelay, delay: contentDelay, easing: ease, fill: "both" },
    );
    animations.current = [animation, fade];
    if (open) {
      const focus = fullScreen ? [...element.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.checkVisibility() && !button.disabled) : heading.current;
      focus?.focus({ preventScroll: true });
    }
    void animation.finished
      .then(() => {
        if (!open) element.hidden = true;
      })
      .catch(() => undefined);
    const resize = () => {
      animation.cancel();
      fade.cancel();
      if (!open) element.hidden = true;
    };
    const stopObservingMotion = observeMotionCancellation(resize);
    let initialResize = true;
    const observer = new ResizeObserver(() => {
      if (initialResize) initialResize = false;
      else resize();
    });
    observer.observe(element);
    window.addEventListener("resize", resize);
    return () => {
      stopObservingMotion();
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [open, origin, fullScreen]);

  return (
    <section
      ref={root}
      aria-label="节点详情工作区"
      className={`${styles.workspace} ${fullScreen ? styles.fullScreen : ""}`}
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          event.defaultPrevented ||
          document.querySelector("dialog[open]")
        )
          return;
        event.stopPropagation();
        onClose();
      }}
    >
      <div className={styles.shell} ref={shell} />
      <div className={styles.content} ref={body}>
        <header className={styles.header}>
          <button onClick={onClose} type="button">
            ← 返回画布
          </button>
          <h2 ref={heading} tabIndex={-1}>
            {title}
          </h2>
          <span>{taskState(status).label}</span>
          {dirty ? <span className={styles.unsaved}>未保存</span> : null}
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </section>
  );
}
