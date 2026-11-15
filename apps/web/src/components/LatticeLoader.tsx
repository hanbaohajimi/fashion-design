"use client";

import { useEffect, useRef } from "react";
import { useMotionActivity } from "./motion/use-motion-activity";
import styles from "./lattice-loader.module.css";

// Adapted from the user-supplied React Bits LatticeLoader (3×3 orbit, 90ms step).
const ORBIT = [0, 1, 2, 7, null, 3, 6, 5, 4];
const MARKS = {
  done: [2, 3, 5, 7],
  error: [0, 2, 4, 6, 8],
  stopped: [3, 4, 5],
};
export type LatticeStatus = "working" | "done" | "error" | "stopped";

export function LatticeLoader({
  status = "working",
  label = status === "working"
    ? "正在思考"
    : status === "done"
      ? "已完成"
      : status === "error"
        ? "未完成"
        : "已停止",
  startedAt,
  showTimer = true,
}: {
  status?: LatticeStatus;
  label?: string;
  startedAt?: string | number | undefined;
  showTimer?: boolean;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const timer = useRef<HTMLSpanElement>(null);
  const start = useRef<number | null>(null);
  const stopped = useRef<number | null>(null);
  const previousStatus = useRef<LatticeStatus>(status);
  const { visible, reduced } = useMotionActivity(host);
  useEffect(() => {
    const stamp =
      typeof startedAt === "number"
        ? startedAt
        : startedAt
          ? Date.parse(startedAt)
          : NaN;
    start.current = Number.isFinite(stamp) ? stamp : Date.now();
    stopped.current = null;
  }, [startedAt]);
  useEffect(() => {
    if (status === "working" && previousStatus.current !== "working") {
      start.current = Date.now();
      stopped.current = null;
    }
    if (status !== "working" && stopped.current === null)
      stopped.current = Date.now();
    previousStatus.current = status;
    const paint = () => {
      if (!timer.current || start.current === null) return;
      const seconds = Math.max(
        0,
        Math.floor(((stopped.current ?? Date.now()) - start.current) / 1000),
      );
      timer.current.textContent =
        seconds < 60
          ? `${seconds}秒`
          : `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
    };
    if (status === "working" || visible) paint();
    if (!visible || status !== "working" || !showTimer) return;
    const interval = setInterval(paint, 1000);
    return () => clearInterval(interval);
  }, [showTimer, startedAt, status, visible]);
  const mark = status === "working" ? [] : MARKS[status];
  return (
    <span
      ref={host}
      className={styles.root}
      data-status={status}
      data-active={visible}
      data-reduced={reduced}
      role="status"
      aria-label={label}
    >
      <span className={styles.grid} aria-hidden="true">
        <span className={styles.run}>
          {ORBIT.map((delay, index) => (
            <i
              key={index}
              className={styles.cell}
              data-hole={delay === null || undefined}
              style={
                delay === null
                  ? undefined
                  : { animationDelay: `${delay * 108}ms` }
              }
            />
          ))}
        </span>
        <span className={styles.mark}>
          {ORBIT.map((_, index) => (
            <i
              key={index}
              className={styles.cell}
              data-on={mark.includes(index) || undefined}
            />
          ))}
        </span>
      </span>
      <span>{label}</span>
      {showTimer ? (
        <span ref={timer} className={styles.timer} aria-hidden="true">
          0秒
        </span>
      ) : null}
    </span>
  );
}
