"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WorkflowExecutionProgress } from "@fashion/shared";
import { TaskFeedback } from "../../../components/TaskFeedback";
import { useAuth } from "../../auth/AuthProvider";
import { privateFetch } from "../../auth/private-fetch";
import { requestProjectTaskCenter } from "../../tasks/project-task-navigation";
import styles from "./assistant-execution-status.module.css";

export function AssistantExecutionStatus({
  progress,
  projectId,
  onRefresh,
  disabled = false,
}: {
  progress: WorkflowExecutionProgress;
  projectId: string;
  onRefresh: () => void;
  disabled?: boolean;
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
  return (
    <section
      className={styles.root}
      aria-label="本次执行进度"
      data-execution-progress={progress.executionId}
    >
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
        <button
          type="button"
          onClick={() => requestProjectTaskCenter(projectId)}
        >
          查看任务详情
        </button>
      </div>
    </section>
  );
}
