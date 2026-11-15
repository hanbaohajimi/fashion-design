"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WorkflowExecutionProgress } from "@fashion/shared";
import { TaskFeedback } from "../../../components/TaskFeedback";
import { StatusMark } from "../../../components/StatusMark";
import { useAuth } from "../../auth/AuthProvider";
import { privateFetch } from "../../auth/private-fetch";
import { requestProjectTaskCenter } from "../../tasks/project-task-navigation";
import styles from "./assistant-execution-status.module.css";
import redesign from "./assistant-redesign.module.css";

export function AssistantExecutionStatus({
  progress,
  projectId,
  onRefresh,
  disabled = false,
  compact = false,
}: {
  progress: WorkflowExecutionProgress;
  projectId: string;
  onRefresh: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { session } = useAuth(),
    cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    executionId: string;
    message: string;
    failed: boolean;
  } | null>(null);
  const active = useRef(true),
    flight = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      flight.current?.abort();
    };
  }, [progress.executionId]);
  const stop = async () => {
    if (flight.current || disabled || !progress.cancelTaskIds.length) return;
    const controller = new AbortController();
    flight.current = controller;
    setBusy(true);
    const responses = await Promise.allSettled(
      progress.cancelTaskIds.map(async (id) => {
        const response = await privateFetch(
          `/api/generations/${encodeURIComponent(id)}`,
          {
            method: "DELETE",
            credentials: "include",
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error("停止结果尚未确认");
      }),
    );
    if (active.current && !controller.signal.aborted) {
      const failed = responses.some(
        (response) => response.status === "rejected",
      );
      setNotice({
        executionId: progress.executionId,
        failed,
        message: failed
          ? "停止结果尚未全部确认，请重新读取任务状态。"
          : "已请求停止，正在核对执行结果。",
      });
      onRefresh();
      void cache.invalidateQueries({
        queryKey: ["project-tasks", session?.user.id, projectId],
      });
      setBusy(false);
    }
    if (flight.current === controller) flight.current = null;
  };
  const state =
    progress.status === "preparing"
      ? "submitting"
      : progress.status === "partial_failed"
        ? "failed"
        : progress.status;
  const currentNotice =
    notice?.executionId === progress.executionId &&
    progress.cancelTaskIds.length
      ? notice
      : null;
  const activeStatus = [
    "preparing",
    "queued",
    "running",
    "processing",
  ].includes(progress.status);
  if (compact) return <section className={styles.root} data-compact aria-label="本次执行进度" data-execution-progress={progress.executionId}>
    <div className={styles.statusLine} role="status"><StatusMark status={progress.status === "queued" || progress.status === "preparing" ? "pending" : "running"} decorative />
      <span>{progress.status === "queued" ? "生成任务排队中…" : progress.status === "preparing" ? "正在准备生成…" : progress.status === "processing" ? "正在整理生成结果…" : progress.operation === "image" ? "正在生成图片…" : "正在处理…"}{progress.counts.total > 1 ? `（已完成 ${progress.counts.completed} / ${progress.counts.total}）` : ""}</span>
    </div>
    {currentNotice ? <p role={currentNotice.failed ? "alert" : "status"}>{currentNotice.message}</p> : null}
    {progress.cancelTaskIds.length ? <div className={styles.actions}><button type="button" disabled={busy || disabled} onClick={() => void stop()}>{busy ? "正在请求停止…" : `停止 ${progress.cancelTaskIds.length} 项图片任务`}</button>{currentNotice?.failed ? <button type="button" onClick={onRefresh}>重新读取状态</button> : null}</div> : null}
  </section>;
  return (
    <section
      className={styles.root}
      aria-label="本次执行进度"
      data-execution-progress={progress.executionId}
    >
      <details>
        <summary className={redesign.progressSummary}>
          <span>{({ preparing: "准备中", queued: "排队中", running: "处理中", processing: "正在核对结果", completed: "已完成", partial_failed: "部分完成", failed: "未完成", canceled: "已取消" } as Record<string, string>)[progress.status] ?? progress.title}，已完成 {progress.counts.completed} / {progress.counts.total} 项</span>
        </summary>
        <div className={redesign.progressDetails}>
      <TaskFeedback
        taskId={progress.executionId}
        status={state}
        operation={progress.operation === "analysis" ? "analysis" : "generate"}
        title={progress.title}
        updatedAt={progress.updatedAt}
        {...(progress.status === "partial_failed"
          ? { error: "部分操作未完成" }
          : {})}
        compact
      />
      <div className={styles.counts} aria-label="实际操作数量">
        <span>
          已完成 {progress.counts.completed} / {progress.counts.total} 项
        </span>
        {progress.counts.queued ? (
          <span>排队 {progress.counts.queued} 项</span>
        ) : null}
        {progress.counts.running ? (
          <span>处理中 {progress.counts.running} 项</span>
        ) : null}
        {progress.counts.preparing && activeStatus ? (
          <span>准备 {progress.counts.preparing} 项</span>
        ) : null}
        {progress.counts.failed ? (
          <span>未完成 {progress.counts.failed} 项</span>
        ) : null}
        {progress.counts.canceled ? (
          <span>已取消 {progress.counts.canceled} 项</span>
        ) : null}
      </div>
      {progress.status === "processing" ? <p>正在核对任务结果。</p> : null}
        <button type="button" onClick={() => requestProjectTaskCenter(projectId)}>查看任务详情</button>
        </div>
      </details>
      {progress.status === "partial_failed" ? (
        <p>部分操作未完成，已完成的结果会保留。</p>
      ) : null}
      {currentNotice ? (
        <p role={currentNotice.failed ? "alert" : "status"}>
          {currentNotice.message}
        </p>
      ) : null}
      <div className={styles.actions}>
        {progress.cancelTaskIds.length ? (
          <button
            type="button"
            disabled={busy || disabled}
            onClick={() => void stop()}
          >
            {busy
              ? "正在请求停止…"
              : `停止 ${progress.cancelTaskIds.length} 项图片任务`}
          </button>
        ) : null}
        {currentNotice?.failed ? (
          <button type="button" onClick={onRefresh}>
            重新读取状态
          </button>
        ) : null}
      </div>
    </section>
  );
}
