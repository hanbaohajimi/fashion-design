"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useCreateProject, useProjects } from "../projects/use-projects";
import styles from "./trends.module.css";

interface TrendBoardPickerDialogProps {
  readonly importing: boolean;
  readonly onClose: () => void;
  readonly onSelect: (boardId: string) => Promise<void>;
  readonly open: boolean;
}

export function TrendBoardPickerDialog({
  importing,
  onClose,
  onSelect,
  open,
}: TrendBoardPickerDialogProps) {
  const projectsQuery = useProjects("", "active", open);
  const createProject = useCreateProject();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const projects = useMemo(
    () => projectsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [projectsQuery.data],
  );

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  if (!open) return null;

  const createAndSelect = async (): Promise<void> => {
    const trimmed = name.trim();
    if (Array.from(trimmed).length < 3) {
      setError("项目名称至少需要 3 个字");
      return;
    }
    setError(null);
    try {
      const project = await createProject.mutateAsync({
        idempotencyKey: crypto.randomUUID(),
        name: trimmed,
      });
      await onSelect(project.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建项目失败");
    }
  };

  return (
    <div
      className={styles.dialogBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !importing) onClose();
      }}
    >
      <div
        aria-labelledby="trend-board-dialog-title"
        aria-modal="true"
        className={styles.boardDialog}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !importing) onClose();
        }}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className={styles.dialogHeading}>
          <div><span>DESTINATION / BOARD</span><h2 id="trend-board-dialog-title">选择存入位置</h2></div>
          <button aria-label="关闭" disabled={importing} onClick={onClose} type="button">×</button>
        </div>
        <p className={styles.dialogIntro}>趋势将以摘要便签、色卡和代表图保存，原文地址会保留在元素数据中。</p>

        <div className={styles.boardChoices}>
          {projectsQuery.isLoading ? <p>正在读取项目…</p> : null}
          {projectsQuery.error ? <p role="alert">项目读取失败，请稍后重试。</p> : null}
          {projects.map((project) => (
            <button
              disabled={importing}
              key={project.id}
              onClick={() => void onSelect(project.id)}
              type="button"
            >
              <span>{project.name}</span>
              <small>{project.assetCount} 项设计资产</small>
              <i aria-hidden="true">→</i>
            </button>
          ))}
        </div>

        <form
          className={styles.createBoardForm}
          onSubmit={(event) => {
            event.preventDefault();
            void createAndSelect();
          }}
        >
          <label htmlFor="trend-new-project">或创建新项目</label>
          <div>
            <input
              id="trend-new-project"
              maxLength={80}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="例：2027 春夏趋势研究"
              value={name}
            />
            <button disabled={importing || createProject.isPending} type="submit">
              {createProject.isPending ? "创建中…" : "创建并存入"}
            </button>
          </div>
          {error ? <p role="alert">{error}</p> : null}
        </form>
      </div>
    </div>
  );
}
