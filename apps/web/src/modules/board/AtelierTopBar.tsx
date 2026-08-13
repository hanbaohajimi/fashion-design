"use client";

import Link from "next/link";
import { useContext, useEffect, useRef, useState } from "react";

import { fetchProject } from "../projects/projects-api";
import { BoardProjectContext } from "./board-context";
import type { BoardPersistStatus } from "./hooks/useBoardPersist";
import styles from "./atelier-topbar.module.css";

interface AtelierTopBarProps {
  readonly exportOpen?: boolean;
  readonly onOpenExport: () => void;
  readonly status: BoardPersistStatus;
}

export function AtelierTopBar({
  exportOpen = false,
  onOpenExport,
}: AtelierTopBarProps) {
  const projectId = useContext(BoardProjectContext);
  const [projectName, setProjectName] = useState("设计项目");
  const [overviewOpen, setOverviewOpen] = useState(false);
  const projectButtonRef = useRef<HTMLButtonElement>(null);
  const projectPopoverRef = useRef<HTMLElement>(null);

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

  useEffect(() => {
    if (!overviewOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        overviewOpen &&
        !projectButtonRef.current?.contains(target) &&
        !projectPopoverRef.current?.contains(target)
      ) {
        setOverviewOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setOverviewOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [overviewOpen]);

  return (
    <header className={styles.topBar}>
      <div className={styles.topBarLeft}>
        <button
          aria-expanded={overviewOpen}
          className={styles.projectButton}
          onClick={() => setOverviewOpen((current) => !current)}
          ref={projectButtonRef}
          type="button"
        >
          <span className={styles.projectInfo}>
            <strong className={styles.projectName} title={projectName}>
              {projectName}
            </strong>
          </span>
          <svg aria-hidden="true" viewBox="0 0 16 16">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </button>
        {overviewOpen ? (
          <nav
            className={styles.projectPopover}
            aria-label="项目导航"
            ref={projectPopoverRef}
          >
            <Link href="/">返回项目库</Link>
          </nav>
        ) : null}
      </div>

      <div className={styles.topBarRight}>
        <div className={styles.actionGroup}>
          <button
            aria-expanded={exportOpen}
            className={styles.actionButton}
            onClick={onOpenExport}
            type="button"
          >
            导出
          </button>
        </div>
      </div>
    </header>
  );
}
