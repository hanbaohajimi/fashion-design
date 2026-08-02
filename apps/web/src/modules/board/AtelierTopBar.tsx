"use client";

import Link from "next/link";
import { useContext, useEffect, useState } from "react";

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
  const [projectName, setProjectName] = useState("设计项目");

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
          atelier.
        </Link>
        <div className={styles.projectInfo}>
          <span className={styles.projectLabel}>PROJECT</span>
          <strong className={styles.projectName} title={projectName}>
            {projectName}
          </strong>
        </div>
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
