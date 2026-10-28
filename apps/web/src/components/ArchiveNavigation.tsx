"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLockup } from "./BrandLockup";
import { Menu } from "./ui";
import { ConnectionNotice } from "./interactions/ConnectionNotice";
import styles from "./archive-navigation.module.css";

export type ArchiveSection =
  "projects" | "design" | "studio" | "fabrics" | "trends";

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
      ) : name === "design" ? (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="m3 16 5-5 5 5 3-3 5 5" />
          <circle cx="8" cy="7" r="1" />
        </>
      ) : name === "studio" ? (
        <>
          <path d="M5 3h9l5 5v13H5Z" />
          <path d="M14 3v6h5M8 13h8M8 17h6" />
        </>
      ) : name === "fabrics" ? (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M8 4v16M16 4v16M3 10h18M3 15h18" />
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
  const context = projectId
    ? `?from=board&boardId=${encodeURIComponent(projectId)}`
    : "";
  const entries: { id: ArchiveSection; title: string; href: string }[] = [
    { id: "projects", title: "项目库", href: "/" },
    ...(projectId
      ? [
          {
            id: "design" as const,
            title: "设计工作台",
            href: `/${encodeURIComponent(projectId)}`,
          },
          {
            id: "studio" as const,
            title: "款式与交付",
            href: `/${encodeURIComponent(projectId)}/studio`,
          },
        ]
      : []),
    { id: "fabrics", title: "面料库", href: `/fabrics${context}` },
    {
      id: "trends",
      title: "趋势档案",
      href: `/trends${context || "?from=projects"}`,
    },
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
  return (
    <aside
      className={styles.rail}
      data-archive-navigation
      aria-label="工作区目录"
    >
      <Link href="/" className={styles.brand} aria-label="森织 设计工作室 首页">
        <BrandLockup tone="color" size={44} />
      </Link>
      <nav aria-label="工作区导航" className={styles.navigation} data-guide="projects-navigation">
        <div className={styles.desktopLinks}>{links}</div>
        <div className={styles.mobileMenu}>
          <Menu
            label="切换工作区"
            trigger={
              <>
                <span>
                  {entries.find((entry) => entry.id === current)?.title ??
                    "导航"}
                </span>
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </>
            }
          >
            {projectName ? (
              <span className={styles.menuProject}>{projectName}</span>
            ) : null}
            {links}
          </Menu>
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
      <div className={styles.account}><ConnectionNotice />{account}</div>
    </aside>
  );
}
