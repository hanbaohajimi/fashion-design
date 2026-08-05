"use client";

import Link from "next/link";
import { useContext, useEffect, useState } from "react";
import { useEditor, useValue } from "tldraw";

import { useAuth } from "../auth/AuthProvider";
import { fetchProject } from "../projects/projects-api";
import { BoardProjectContext } from "./board-context";
import type { BoardPersistStatus } from "./hooks/useBoardPersist";
import styles from "./atelier-topbar.module.css";

interface AtelierTopBarProps {
  readonly onOpenCollection: () => void;
  readonly onOpenExport: () => void;
  readonly status: BoardPersistStatus;
}

const STATUS_LABELS: Readonly<Record<BoardPersistStatus, string>> = {
  conflict: "版本冲突",
  error: "加载失败",
  loading: "正在加载",
  offline: "离线",
  ready: "已就绪",
  saved: "已保存",
  saving: "保存中",
};

export function AtelierTopBar({
  onOpenCollection,
  onOpenExport,
  status,
}: AtelierTopBarProps) {
  const projectId = useContext(BoardProjectContext);
  const auth = useAuth();
  const editor = useEditor();
  const [projectName, setProjectName] = useState("设计项目");
  const [overviewOpen, setOverviewOpen] = useState(false);
  const boardStats = useValue(
    "project-capsule-stats",
    () => ({
      selected: editor.getSelectedShapeIds().length,
      total: editor.getCurrentPageShapes().length,
    }),
    [editor],
  );

  useEffect(() => {
    let active = true;
    void fetchProject(projectId)
      .then((project) => {
        if (active) setProjectName(project.name);
      })
      .catch(() => {
        if (active) setProjectName("设计项目");
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  return (
    <header className={styles.topBar}>
      <div className={styles.topBarLeft}>
        <Link href="/" className={styles.brandMark} aria-label="返回项目库">
          a.
        </Link>
        <button
          aria-expanded={overviewOpen}
          className={styles.projectButton}
          onClick={() => setOverviewOpen((current) => !current)}
          type="button"
        >
          <span className={styles.projectInfo}>
            <span className={styles.projectLabel}>PROJECT</span>
            <strong className={styles.projectName} title={projectName}>
              {projectName}
            </strong>
          </span>
          <svg aria-hidden="true" viewBox="0 0 16 16">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </button>
        {overviewOpen ? (
          <section className={styles.projectPopover} aria-label="项目概览">
            <header>
              <span>PROJECT / OVERVIEW</span>
              <strong>{projectName}</strong>
            </header>
            <dl>
              <div>
                <dt>画布元素</dt>
                <dd>{boardStats.total}</dd>
              </div>
              <div>
                <dt>当前选中</dt>
                <dd>{boardStats.selected}</dd>
              </div>
              <div>
                <dt>同步状态</dt>
                <dd>{STATUS_LABELS[status]}</dd>
              </div>
            </dl>
            <Link href="/">返回项目库</Link>
          </section>
        ) : null}
      </div>

      <div className={styles.topBarRight}>
        <div className={styles.statusGroup}>
          <span
            className={styles.saveStatus}
            data-status={status}
            role="status"
            aria-live="polite"
          >
            <i aria-hidden="true" />
            {STATUS_LABELS[status]}
          </span>
          <span className={styles.quotaBadge} title="本月剩余生成次数">
            {auth.session?.credits.remaining ?? "—"} / 600
          </span>
        </div>

        <div className={styles.actionGroup}>
          <button
            className={styles.actionButton}
            onClick={onOpenExport}
            type="button"
          >
            导出
          </button>
          <button
            className={styles.actionButton}
            onClick={onOpenCollection}
            type="button"
          >
            系列
          </button>
          <button
            className={styles.userButton}
            aria-label="用户菜单"
            type="button"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="8"
                cy="5"
                r="2.5"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path
                d="M3 13.5c0-2.5 2-4.5 5-4.5s5 2 5 4.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
