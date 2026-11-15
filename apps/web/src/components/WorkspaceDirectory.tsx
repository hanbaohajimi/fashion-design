"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLockup } from "./BrandLockup";
import { Dialog } from "./ui";
import { useWorkspaceChrome } from "./WorkspaceChrome";
import { WorkspaceToolIcon } from "../modules/projects/WorkspaceToolIcon";
import type { StudioTab } from "../modules/studio/studio-navigation";
import styles from "./archive-navigation.module.css";

export type ArchiveSection =
  | "home"
  | "projects"
  | "design"
  | "studio"
  | "fabrics"
  | "trends"
  | "discover"
  | "assets"
  | "wardrobe";
export interface StudioDirectoryNavigation {
  id: string;
  tab: StudioTab;
  onChange: (tab: StudioTab) => void;
}

/** Global destinations only; project operations live in the canvas catalog. */
export function ArchiveNavigation({
  current,
  projectId,
  account,
}: {
  readonly current: ArchiveSection;
  readonly projectId?: string | undefined;
  readonly projectName?: string | undefined;
  readonly account?: ReactNode;
  readonly navigation?: ReactNode;
  readonly hideProjectReturn?: boolean;
  readonly currentIsParent?: boolean;
  readonly studioNavigation?: StudioDirectoryNavigation | undefined;
}) {
  const { open, setOpen, compact, focused, kind } = useWorkspaceChrome();
  const context = projectId
    ? `?from=board&boardId=${encodeURIComponent(projectId)}`
    : "?from=projects";
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() =>
      document.getElementById("workspace-navigation-toggle")?.focus(),
    );
  };
  const link = (
    id: "home" | "projects" | "assets" | "discover" | "fabrics" | "wardrobe",
    label: string,
    href: string,
  ) => (
    <Link
      href={href}
      aria-current={
        current === id ||
        (id === "discover" && current === "trends") ||
        (id === "projects" && (current === "studio" || current === "design"))
          ? "page"
          : undefined
      }
    >
      <WorkspaceToolIcon name={id} size={18} />
      <span>{label}</span>
    </Link>
  );
  const directory = (
    <aside
      className={styles.rail}
      data-archive-navigation
      data-expanded={open}
      data-navigation-kind={kind}
      id="workspace-navigation"
      inert={!open}
      aria-hidden={!open || undefined}
      aria-label="工作区目录"
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          !event.currentTarget.querySelector("details[open]")
        ) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className={styles.brandRow}>
        <Link
          href="/"
          className={styles.brand}
          aria-label="森织 设计工作室 首页"
        >
          <BrandLockup tone="color" size={44} />
        </Link>
        <button
          className={styles.toggle}
          type="button"
          aria-label="收起工作区目录"
          onClick={close}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="m15 5-7 7 7 7" />
          </svg>
        </button>
      </div>
      <nav
        aria-label="工作区导航"
        className={styles.navigation}
        data-guide="projects-navigation"
        data-workspace-navigation-scroll
      >
        <div className={styles.navGroup}>
          <span className={styles.navGroupLabel}>工作空间</span>
          {link("home", "首页", "/")}
          {link("projects", "项目", "/projects")}
          {link("assets", "资产库", "/assets")}
        </div>
        <div className={styles.navGroup}>
          <span className={styles.navGroupLabel}>灵感与资料</span>
          {link(
            "wardrobe",
            "衣橱",
            projectId
              ? `/wardrobe?projectId=${encodeURIComponent(projectId)}`
              : "/wardrobe",
          )}
          {link("fabrics", "面料库", `/fabrics${context}`)}
          {link("discover", "发现", `/trends${context}`)}
        </div>
      </nav>
      <div className={styles.account}>{account}</div>
    </aside>
  );
  return (
    <>
      <button
        id="workspace-navigation-toggle"
        className={`${styles.toggle} ${styles.reopen}`}
        type="button"
        hidden={focused || (open && !compact)}
        aria-label="展开工作区目录"
        aria-controls="workspace-navigation"
        aria-expanded={open}
        data-guide={!open ? "projects-navigation" : undefined}
        data-guide-variant="collapsed"
        onClick={() => {
          setOpen(!open);
          if (!compact && !open)
            requestAnimationFrame(() =>
              document
                .querySelector<HTMLElement>("#workspace-navigation button")
                ?.focus(),
            );
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M9 4v16m4-11 3 3-3 3" />
        </svg>
      </button>
      {compact ? (
        <Dialog
          open={open}
          label="工作区目录"
          variant="navigation"
          className={styles.drawer}
          returnFocusSelector="#workspace-navigation-toggle"
          onClose={() => setOpen(false)}
        >
          {directory}
        </Dialog>
      ) : (
        directory
      )}
    </>
  );
}
