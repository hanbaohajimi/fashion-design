"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTaskMotion } from "./motion/use-task-motion";
import { isTaskActive, taskState, type TaskOperation } from "./task-feedback-state";
import { UI_TIMING } from "./ui-config";
import { RefineFrame, refineStatus } from "./RefineFrame";
import { userFacingError } from "./user-facing-error";
import styles from "./task-feedback.module.css";

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
  readonly visual?: boolean;
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
  visual = false,
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
    return () => {
      clearTimeout(feedbackTimer);
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
  const frameStatus = refineStatus(status);
  const showFrame = visual && imageTask && active && frameStatus;
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
      {showFrame ? <div className={styles.visualFrame}><RefineFrame status={frameStatus} compact={compact} showStatus={false} animate={elapsed >= 1} aspectRatio="4 / 3" /></div> : null}
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
