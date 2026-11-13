"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLockup } from "./BrandLockup";
import { Dialog } from "./ui";
import { useWorkspaceChrome } from "./WorkspaceChrome";
import styles from "./archive-navigation.module.css";

export type ArchiveSection =
  "projects" | "design" | "studio" | "fabrics" | "trends" | "discover" | "assets";

function NavigationIcon({ name }: { readonly name: ArchiveSection }) {
  return (
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
      {name === "projects" ? (
        <>
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </>
      ) : name === "fabrics" ? (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M8 4v16M16 4v16M3 10h18M3 15h18" />
        </>
      ) : name === "discover" || name === "trends" ? (
        <>
          <circle cx="12" cy="12" r="10" />
          <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
        </>
      ) : name === "assets" ? (
        <>
          <rect x="3" y="7" width="13" height="13" rx="2" />
          <path d="M8 7V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
        </>
      ) : (
        <>
          <path d="M4 20V4M4 20h17M7 15l4-5 4 2 5-7" />
        </>
      )}
    </svg>
  );
}

export function ArchiveNavigation({
  current,
  projectId,
  projectName,
  account,
  navigation,
  currentIsParent = false,
}: {
  readonly current: ArchiveSection;
  readonly projectId?: string | undefined;
  readonly projectName?: string | undefined;
  readonly account?: ReactNode;
  readonly navigation?: ReactNode;
  readonly hideProjectReturn?: boolean;
  readonly currentIsParent?: boolean;
}) {
  const { open, setOpen, compact, focused, kind } = useWorkspaceChrome();
  const context = projectId
    ? `?from=board&boardId=${encodeURIComponent(projectId)}`
    : "";
  // 固定 4 项导航，不随 projectId 变化；项目内二级导航由项目页内部 tab 实现
  const entries: { id: ArchiveSection; title: string; href: string }[] = [
    { id: "projects", title: "项目", href: "/" },
    { id: "discover", title: "发现", href: `/trends${context || "?from=projects"}` },
    { id: "fabrics",  title: "面料库", href: `/fabrics${context}` },
    { id: "assets",   title: "资产", href: "/assets" },
  ];
  const links = entries.map((entry) => (
    <Link
      key={entry.id}
      href={entry.href}
      aria-current={current === entry.id ? "page" : undefined}
      data-current-parent={current === entry.id && currentIsParent || undefined}
    >
      <NavigationIcon name={entry.id} />
      <span>{entry.title}</span>
    </Link>
  ));
  // 工作空间：项目 + 发现；灵感与资料：面料库 + 资产
  const workspaceEntries = links.slice(0, 2);
  const referenceEntries = links.slice(2);
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
      onKeyDown={event => {
        if (event.key === "Escape" && !event.defaultPrevented && !event.currentTarget.querySelector("details[open]")) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          requestAnimationFrame(() => document.getElementById("workspace-navigation-toggle")?.focus());
        }
      }}
    >
      <div className={styles.brandRow}>
        <Link href="/" className={styles.brand} aria-label="森织 设计工作室 首页">
          <BrandLockup tone="color" size={44} />
        </Link>
        <button className={styles.toggle} type="button" aria-label="收起工作区目录" onClick={() => {
          setOpen(false);
          requestAnimationFrame(() => document.getElementById("workspace-navigation-toggle")?.focus());
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
        </button>
      </div>
      <Link className={styles.newProject} href="/?new=1">
        <span aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></span>
        <span>新建</span>
      </Link>
      <nav aria-label="工作区导航" className={styles.navigation} data-guide="projects-navigation">
        <div className={styles.desktopLinks}>
          <div className={styles.navGroup}>
            <span className={styles.navGroupLabel}>工作空间</span>
            {workspaceEntries}
          </div>
          <div className={styles.navGroup}>
            <span className={styles.navGroupLabel}>灵感与资料</span>
            {referenceEntries}
          </div>
        </div>
      </nav>
      {projectName ? (
        <div className={styles.project}>
          <span>当前项目</span>
          <strong title={projectName}>{projectName}</strong>
        </div>
      ) : null}
      {navigation ? (
        <div className={styles.projectNavigation} data-workspace-navigation-scroll>{navigation}</div>
      ) : null}
      <div className={styles.account}>{account}</div>
    </aside>
  );
  return <>
    <button
      id="workspace-navigation-toggle"
      className={`${styles.toggle} ${styles.reopen}`}
      type="button"
      hidden={focused || open && !compact}
      aria-label="展开工作区目录"
      aria-controls="workspace-navigation"
      aria-expanded={open}
      data-guide={!open ? current === "studio" ? "studio-navigation" : "projects-navigation" : undefined}
      data-guide-variant="collapsed"
      onClick={() => {
        setOpen(!open);
        if (!compact && !open) requestAnimationFrame(() => document.querySelector<HTMLElement>("#workspace-navigation button")?.focus());
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16m4-11 3 3-3 3" /></svg>
    </button>
    {compact ? <Dialog open={open} label="工作区目录" variant="navigation" className={styles.drawer} returnFocusSelector="#workspace-navigation-toggle" onClose={() => setOpen(false)}>{directory}</Dialog> : directory}
  </>;
}
