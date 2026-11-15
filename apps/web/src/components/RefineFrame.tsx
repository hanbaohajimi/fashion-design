"use client";

import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useMotionActivity } from "./motion/use-motion-activity";
import { LatticeLoader } from "./LatticeLoader";
import styles from "./refine-frame.module.css";

export type RefineStatus =
  "queued" | "generating" | "refining" | "complete" | "error" | "canceled";
export function refineStatus(status: string): RefineStatus | null {
  if (["preparing", "submitting", "dispatching", "queued"].includes(status))
    return "queued";
  if (["running", "executing", "pending"].includes(status)) return "generating";
  if (status === "processing") return "refining";
  if (["completed", "succeeded"].includes(status)) return "complete";
  if (["failed", "moderation_failed", "not_admitted"].includes(status))
    return "error";
  if (["canceled", "cancelled", "stopped"].includes(status)) return "canceled";
  return null;
}
const LABELS: Record<RefineStatus, string> = {
  queued: "排队中",
  generating: "正在生成",
  refining: "正在处理结果",
  complete: "已完成",
  error: "生成未完成",
  canceled: "已取消",
};
const BLOCKS = [48, 32, 20, 12, 8, 5, 3, 2];

/** React Bits RefineFrame reference, adapted to real task stages and complete garment framing. */
export function RefineFrame({
  status,
  children,
  imageKey = "",
  aspectRatio = "4 / 3",
  width = "100%",
  compact = false,
  previousResult = false,
  label,
  onRetry,
  className = "",
  stageDuration = 400,
  fill = false,
  showStatus = true,
  animate = true,
}: {
  status: RefineStatus;
  children?: ReactNode;
  imageKey?: string;
  aspectRatio?: string;
  width?: number | string;
  compact?: boolean;
  previousResult?: boolean;
  label?: string;
  onRetry?: (() => void) | undefined;
  className?: string;
  stageDuration?: number;
  fill?: boolean;
  showStatus?: boolean;
  animate?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { visible, reduced } = useMotionActivity(host, animate);
  const seenWorking = useRef(false);
  const previousPhase = useRef(status);
  const seenImage = useRef(imageKey);
  const reveal = (value: boolean) => {
    if (value) host.current?.setAttribute("data-revealing", "true");
    else host.current?.removeAttribute("data-revealing");
  };
  const working = ["queued", "generating", "refining"].includes(status);
  useLayoutEffect(() => {
    const completedNow =
      status === "complete" &&
      ["queued", "generating", "refining"].includes(previousPhase.current);
    previousPhase.current = status;
    if (working) {
      seenWorking.current = true;
      host.current?.removeAttribute("data-just-completed");
      return;
    }
    if (!completedNow) return;
    host.current?.setAttribute("data-just-completed", "true");
    const timer = setTimeout(
      () => host.current?.removeAttribute("data-just-completed"),
      1200,
    );
    return () => clearTimeout(timer);
  }, [status, working]);
  useLayoutEffect(() => {
    const fresh = seenWorking.current && status === "complete";
    const changedImage = seenImage.current !== imageKey;
    seenImage.current = imageKey;
    if (status !== "complete") return;
    if (!visible || reduced) {
      seenWorking.current = false;
      reveal(false);
      return;
    }
    if (!fresh || !changedImage || !host.current || !canvas.current) {
      reveal(false);
      return;
    }
    seenWorking.current = false;
    let alive = true,
      frame = 0;
    let buffers: HTMLCanvasElement[] = [];
    const container = host.current,
      target = canvas.current;
    const image = container.querySelector("img");
    if (!image) return;
    const play = () => {
      if (!alive || !image.naturalWidth || !image.naturalHeight) return;
      const bounds = container.getBoundingClientRect();
      const ratio = Math.min(1, 600 / Math.max(bounds.width, bounds.height));
      const width = Math.max(1, Math.round(bounds.width * ratio)),
        height = Math.max(1, Math.round(bounds.height * ratio));
      target.width = width;
      target.height = height;
      const context = target.getContext("2d");
      if (!context) return;
      // Store small levels only, not nine full-resolution frame buffers.
      const fit = Math.min(
        width / image.naturalWidth,
        height / image.naturalHeight,
      );
      const w = image.naturalWidth * fit,
        h = image.naturalHeight * fit;
      const x = (width - w) / 2,
        y = (height - h) / 2;
      const levels = BLOCKS.map((block) => {
        const small = document.createElement("canvas");
        small.width = Math.max(1, Math.round(width / block));
        small.height = Math.max(1, Math.round(height / block));
        const layer = small.getContext("2d");
        if (layer) {
          layer.imageSmoothingEnabled = true;
          layer.drawImage(
            image,
            (x / width) * small.width,
            (y / height) * small.height,
            (w / width) * small.width,
            (h / height) * small.height,
          );
        }
        return small;
      });
      const paintLevel = (index: number) => {
        context.imageSmoothingEnabled = false;
        if (index >= levels.length) {
          context.imageSmoothingEnabled = true;
          context.drawImage(image, x, y, w, h);
        } else {
          const level = levels[index];
          if (level) context.drawImage(level, 0, 0, width, height);
        }
      };
      buffers = levels;
      context.clearRect(0, 0, width, height);
      paintLevel(0);
      let started = 0;
      reveal(true);
      const tick = (now: number) => {
        if (!alive) return;
        started ||= now;
        const progress = Math.min(1, (now - started) / (stageDuration * 2));
        const level = progress * levels.length,
          current = Math.floor(level),
          fraction = level - current;
        context.clearRect(0, 0, width, height);
        context.globalAlpha = 1;
        paintLevel(current);
        if (fraction > 0 && current < levels.length) {
          context.save();
          context.beginPath();
          context.rect(0, 0, width, height * fraction);
          context.clip();
          paintLevel(current + 1);
          context.restore();
          context.fillStyle = "rgba(255,255,255,.22)";
          context.fillRect(0, height * fraction - 1, width, 2);
        }
        if (progress < 1) frame = requestAnimationFrame(tick);
        else {
          reveal(false);
          levels.forEach((level) => {
            level.width = 0;
            level.height = 0;
          });
        }
      };
      frame = requestAnimationFrame(tick);
    };
    const start = () => {
      try {
        play();
      } catch {
        reveal(false);
      }
    };
    if (image.complete && image.naturalWidth) start();
    else image.addEventListener("load", start, { once: true });
    return () => {
      alive = false;
      reveal(false);
      cancelAnimationFrame(frame);
      image.removeEventListener("load", start);
      buffers.forEach((level) => {
        level.width = 0;
        level.height = 0;
      });
      buffers = [];
      target.width = 0;
      target.height = 0;
    };
  }, [imageKey, reduced, stageDuration, status, visible]);
  const text = label ?? LABELS[status];
  const chip = showStatus;
  return (
    <div
      ref={host}
      className={`${styles.frame} ${className}`}
      data-refine-status={status}
      data-active={visible && !reduced}
      data-compact={compact || undefined}
      aria-busy={working}
      style={
        {
          width,
          aspectRatio: fill ? undefined : aspectRatio,
          height: fill ? "100%" : undefined,
          "--refine-stage": `${stageDuration}ms`,
        } as CSSProperties
      }
    >
      {children ? (
        <div
          className={styles.media}
          data-previous={(previousResult && working) || undefined}
        >
          {children}
        </div>
      ) : (
        <div className={styles.placeholder} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      )}
      <canvas ref={canvas} className={styles.mosaic} aria-hidden="true" />
      {working ? <span className={styles.sweep} aria-hidden="true" /> : null}
      {chip ? (
        <div className={styles.chip}>
          <LatticeLoader
            status={
              working
                ? "working"
                : status === "error"
                  ? "error"
                  : status === "canceled"
                    ? "stopped"
                    : "done"
            }
            label={previousResult && working ? `上一版 · ${text}` : text}
            showTimer={false}
          />
        </div>
      ) : null}
      {status === "error" && onRetry ? (
        <button
          type="button"
          className={styles.retry}
          onClick={(event) => {
            event.stopPropagation();
            onRetry();
          }}
        >
          重试
        </button>
      ) : null}
    </div>
  );
}
