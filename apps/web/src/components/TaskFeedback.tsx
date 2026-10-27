"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTaskMotion } from "./motion/use-task-motion";
import { isTaskActive, taskState } from "./task-feedback-state";
import { PAINTING_LOADERS_ENABLED, UI_TIMING } from "./ui-config";
import { paintingFor, type TaskOperation } from "./painting-media";
import { userFacingError } from "./user-facing-error";
import styles from "./task-feedback.module.css";

const PaintingLoader = dynamic(() => import("./PaintingLoader"), {
  ssr: false,
});

export interface TaskFeedbackProps {
  readonly taskId: string;
  readonly motionKey?: string;
  readonly status: string;
  readonly operation?: TaskOperation;
  readonly title?: string;
  readonly error?: string | null;
  readonly updatedAt?: string;
  readonly completed?: number;
  readonly total?: number;
  readonly compact?: boolean;
  readonly painting?: boolean;
  readonly actions?: ReactNode;
}

export function TaskFeedback(props: TaskFeedbackProps) {
  const motionAnchor = useRef<HTMLParagraphElement>(null);
  useTaskMotion(props.motionKey ?? `task:${props.taskId}`, props.status, motionAnchor);
  // Reset every local timer/media state when changing tasks or starting another attempt.
  return (
    <TaskFeedbackContent
      motionAnchor={motionAnchor}
      key={`${props.taskId}:${isTaskActive(props.status) ? "active" : props.status}`}
      {...props}
    />
  );
}

function TaskFeedbackContent({
  motionAnchor,
  status,
  operation = "generate",
  title,
  error,
  updatedAt,
  completed,
  total,
  compact = false,
  painting = false,
  actions,
}: TaskFeedbackProps & { motionAnchor: RefObject<HTMLParagraphElement | null> }) {
  const active = isTaskActive(status);
  const state = taskState(status);
  const [elapsed, setElapsed] = useState(0);
  const [staleAt, setStaleAt] = useState<string | null>(null);
  const staleKey = updatedAt ?? "current";
  useEffect(() => {
    if (!active) return;
    const feedbackTimer = setTimeout(
      () => setElapsed(1),
      UI_TIMING.busyFeedback,
    );
    const paintingTimer = setTimeout(
      () => setElapsed(2),
      UI_TIMING.paintingDelay,
    );
    return () => {
      clearTimeout(feedbackTimer);
      clearTimeout(paintingTimer);
    };
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const timestamp = updatedAt ? Date.parse(updatedAt) : NaN;
    const remaining = Number.isFinite(timestamp)
      ? Math.max(0, UI_TIMING.staleTask - (Date.now() - timestamp))
      : UI_TIMING.staleTask;
    const timer = setTimeout(() => setStaleAt(staleKey), remaining);
    return () => clearTimeout(timer);
  }, [active, updatedAt, staleKey]);
  const imageTask = !["analysis", "export"].includes(operation);
  const showPainting =
    PAINTING_LOADERS_ENABLED && painting && imageTask && active && elapsed >= 2;
  const count =
    typeof completed === "number" &&
    typeof total === "number" &&
    Number.isInteger(completed) &&
    Number.isInteger(total) &&
    total > 0 &&
    completed >= 0 &&
    completed <= total;

  return (
    <section
      className={styles.feedback}
      data-state={state.state}
      data-compact={compact}
      aria-label={title ? `${title}任务状态` : "任务状态"}
    >
      {showPainting ? (
        <PaintingLoader
          key={paintingFor(operation)}
          painting={paintingFor(operation)}
          compact={compact}
        />
      ) : null}
      <div className={styles.feedbackContent}>
        {title ? <strong>{title}</strong> : null}
        <p ref={motionAnchor} role="status" aria-atomic="true">
          <i aria-hidden="true" />
          {error
            ? userFacingError(error, "任务未完成，请重试")
            : state.label}
          {count ? <span className={styles.taskCount}>{completed}/{total}</span> : null}
        </p>
        {active && staleAt === staleKey ? (
          <small>暂未收到新状态，可继续处理其他设计。</small>
        ) : null}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
    </section>
  );
}
