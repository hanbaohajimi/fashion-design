"use client";

import { useState } from "react";

import { useGenerationWorkspace } from "./GenerationWorkspace";
import styles from "./generation.module.css";

const STATUS_LABEL = {
  canceled: "已取消",
  failed: "失败",
  moderation_failed: "内容审核未通过",
  queued: "排队中",
  running: "生成中",
  succeeded: "已完成",
} as const;

export function TaskTray() {
  const { cancel, retry, tasks } = useGenerationWorkspace();
  const [retryingTaskId, setRetryingTaskId] = useState<string | null>(null);
  const active = tasks.filter(
    (task) => task.status === "queued" || task.status === "running",
  );
  const recent = tasks
    .filter((task) => task.status !== "queued" && task.status !== "running")
    .slice(0, 5);
  const visible = [...active, ...recent];

  if (visible.length === 0) return null;

  return (
    <aside className={styles.taskTray} aria-label="生成任务托盘">
      <header>
        <span>TASK / TRAY</span>
        <b>{active.length} 进行中</b>
      </header>
      <ol>
        {visible.map((task) => (
          <li data-status={task.status} key={task.id}>
            <i aria-hidden="true" />
            <div>
              <strong>{task.prompt}</strong>
              <span>{task.error ?? STATUS_LABEL[task.status]}</span>
            </div>
            <time dateTime={task.updatedAt}>
              {new Date(task.updatedAt).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
            {task.status === "queued" || task.status === "running" ? (
              <button
                aria-label={`取消“${task.prompt}”`}
                onClick={() => void cancel(task.id)}
                type="button"
              >
                取消
              </button>
            ) : task.status === "failed" || task.status === "canceled" ? (
              <button
                aria-label={`重试“${task.prompt}”`}
                disabled={retryingTaskId !== null}
                onClick={() => {
                  if (retryingTaskId) return;
                  setRetryingTaskId(task.id);
                  void retry(task.id).finally(() => setRetryingTaskId(null));
                }}
                type="button"
              >
                {retryingTaskId === task.id ? "重试中…" : "重试"}
              </button>
            ) : null}
          </li>
        ))}
      </ol>
    </aside>
  );
}
