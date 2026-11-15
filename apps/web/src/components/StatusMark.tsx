"use client";

import { useRef, type CSSProperties } from "react";
import { useMotionActivity } from "./motion/use-motion-activity";
import styles from "./status-mark.module.css";

export type StatusMarkState =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "cancelled"
  | "partial"
  | "unconfirmed";
const labels: Record<StatusMarkState, string> = {
  pending: "等待处理",
  running: "正在处理",
  done: "已完成",
  failed: "未完成",
  cancelled: "已停止",
  partial: "部分完成",
  unconfirmed: "结果待确认",
};

/** User-supplied React Bits StatusMark, adapted to an icon-only, state-driven SVG.
 * CSS interpolates the original dash geometry; no timer can complete an operation.
 * The initial glyph is static, so loading history never redraws a success mark.
 */
export function StatusMark({
  status,
  size = 16,
  strokeWidth = 1.5,
  decorative = false,
  label,
  animate = true,
  className = "",
}: {
  status: StatusMarkState;
  size?: number;
  strokeWidth?: number;
  decorative?: boolean;
  label?: string;
  animate?: boolean;
  className?: string;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const { visible, reduced } = useMotionActivity(host, animate);
  return (
    <span
      ref={host}
      className={`${styles.root} ${className}`}
      data-status-mark
      data-status={status}
      data-motion={visible && !reduced && animate}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : (label ?? labels[status])}
      aria-hidden={decorative || undefined}
      style={
        {
          "--status-size": `${size}px`,
          "--status-stroke": strokeWidth,
        } as CSSProperties
      }
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        aria-hidden="true"
        focusable="false"
      >
        <circle
          className={styles.track}
          cx="12"
          cy="12"
          r={10 - strokeWidth / 2}
        />
        <g className={styles.rotation}>
          <circle
            className={styles.ring}
            cx="12"
            cy="12"
            r={10 - strokeWidth / 2}
            pathLength="1"
            transform="rotate(-90 12 12)"
          />
        </g>
        <path
          className={styles.check}
          d="M7.5 12.25 10.5 15.25 16.75 8.75"
          pathLength="1"
        />
        <path
          className={styles.cross}
          d="M8.5 8.5 15.5 15.5M15.5 8.5 8.5 15.5"
          pathLength="1"
        />
        <path className={styles.warning} d="M12 7.5v6M12 16.5v.01" />
        <path
          className={styles.question}
          d="M9.2 9.3a2.8 2.8 0 1 1 4.7 2.1c-1.2.8-1.9 1.2-1.9 2.6M12 17v.01"
        />
      </svg>
    </span>
  );
}
