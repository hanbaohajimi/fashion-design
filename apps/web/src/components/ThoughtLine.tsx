"use client";

import { useEffect, useId, useRef, useState } from "react";
import { WorkspaceIcon } from "../modules/board/workflow/WorkspaceIcon";
import { useMotionActivity } from "./motion/use-motion-activity";
import { StatusMark } from "./StatusMark";
import styles from "./thought-line.module.css";

/** Adapted from the user-supplied ThoughtLine. Trace entries are observed UI phases, not invented reasoning. */
export function ThoughtLine({
  status,
  label,
  startedAt,
  updatedAt,
  attemptId,
}: {
  status: string;
  label: string;
  startedAt: string;
  updatedAt: string;
  attemptId?: string | undefined;
}) {
  const working = status === "pending";
  const attempt = attemptId ?? startedAt;
  const [trace, setTrace] = useState({
    attempt,
    startedAt,
    endedAt: working ? (null as string | null) : updatedAt,
    observed: working,
    working,
    phase: label,
    steps: working ? [label] : [],
    open: false,
  });
  if (
    trace.working !== working ||
    (working && (trace.phase !== label || trace.attempt !== attempt))
  ) {
    const restarted = working && (!trace.working || trace.attempt !== attempt);
    setTrace({
      attempt,
      startedAt: restarted ? updatedAt : trace.startedAt,
      endedAt: working ? null : updatedAt,
      observed: trace.observed || working,
      working,
      phase: label,
      steps: working
        ? trace.working && !restarted
          ? [...trace.steps, label]
          : [label]
        : trace.steps,
      open: trace.working !== working || restarted ? false : trace.open,
    });
  }
  const root = useRef<HTMLDivElement>(null);
  const timer = useRef<HTMLSpanElement>(null);
  const { visible, reduced } = useMotionActivity(root, trace.observed);
  const id = useId();
  const [pointerToggle, setPointerToggle] = useState(false);
  const settled =
    status === "canceled"
      ? "已停止回复"
      : status === "failed"
        ? "回复未完成"
        : "处理用时";
  useEffect(() => {
    const start = Date.parse(trace.startedAt),
      end = Date.parse(trace.endedAt ?? "");
    const paint = () => {
      if (!timer.current) return;
      const seconds = Number.isFinite(start)
        ? Math.max(
            0,
            ((working ? Date.now() : Number.isFinite(end) ? end : start) -
              start) /
              1000,
          )
        : 0;
      timer.current.textContent =
        seconds < 60
          ? `${seconds.toFixed(1)}秒`
          : `${Math.floor(seconds / 60)}分${Math.floor(seconds % 60)}秒`;
    };
    paint();
    if (!working || !visible) return;
    const interval = setInterval(paint, reduced ? 1000 : 100);
    return () => clearInterval(interval);
  }, [trace.startedAt, trace.endedAt, working, visible, reduced]);
  // A historical receipt does not prove which phases were observed or their duration.
  if (!trace.observed) return null;
  return (
    <div
      ref={root}
      className={styles.root}
      data-thought-line
      data-working={working}
      data-active={working && visible && !reduced}
      data-open={trace.open}
      data-toggle-motion={pointerToggle && visible && !reduced}
    >
      <button
        type="button"
        className={styles.head}
        aria-expanded={trace.open}
        aria-controls={id}
        aria-label={`${working ? label : settled}，${trace.open ? "收起" : "展开"}处理过程`}
        onClick={(event) => {
          setPointerToggle(event.detail > 0);
          setTrace((current) => ({ ...current, open: !current.open }));
        }}
      >
        <span className={styles.glyph}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m10 3 2.4 5.6L18 11l-5.6 2.4L10 19l-2.4-5.6L2 11l5.6-2.4ZM19 2v6m-3-3h6" />
          </svg>
        </span>
        <span className={styles.label}>{working ? label : settled}</span>
        <span
          ref={timer}
          className={styles.timer}
          data-thought-timer
          aria-hidden="true"
        />
        <span className={styles.chevron}>
          <WorkspaceIcon name="chevron" />
        </span>
      </button>
      <span className={styles.sr} role="status">
        {working ? label : settled}
      </span>
      <div
        id={id}
        className={styles.trace}
        aria-hidden={!trace.open}
        inert={!trace.open}
      >
        <div className={styles.fold}>
          <ol className={styles.steps}>
            {trace.steps.map((step, index) => {
              const done =
                index < trace.steps.length - 1 || status === "completed";
              return (
                <li key={`${index}:${step}`} data-done={done}>
                  <span className={styles.mark} aria-hidden="true">
                    <StatusMark
                      status={
                        done
                          ? "done"
                          : working
                            ? "running"
                            : status === "failed"
                              ? "failed"
                              : "cancelled"
                      }
                      size={12}
                      decorative
                      animate={trace.open}
                    />
                  </span>
                  <span>{step}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
