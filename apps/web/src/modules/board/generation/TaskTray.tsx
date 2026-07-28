"use client";

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
  const { tasks } = useGenerationWorkspace();
  const active = tasks.filter(
    (task) => task.status === "queued" || task.status === "running",
  );
  const recent = tasks
    .filter(
      (task) => task.status !== "queued" && task.status !== "running",
    )
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
          </li>
        ))}
      </ol>
    </aside>
  );
}
