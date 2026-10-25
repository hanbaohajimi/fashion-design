"use client";

import Link from "next/link";
import type { ReactNode } from "react";
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
  hideProjectReturn = false,
}: {
  readonly current: ArchiveSection;
  readonly projectId?: string | undefined;
  readonly projectName?: string | undefined;
  readonly account?: ReactNode;
  readonly navigation?: ReactNode;
  readonly hideProjectReturn?: boolean;
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
      : [
          { id: "fabrics" as const, title: "面料库", href: "/fabrics" },
          {
            id: "trends" as const,
            title: "趋势档案",
            href: "/trends?from=projects",
          },
        ]),
  ];
  // Resource pages keep their current location visible while retaining project return links.
  if (projectId && (current === "fabrics" || current === "trends"))
    entries.push({
      id: current,
      title: current === "fabrics" ? "面料库" : "趋势档案",
      href: `/${current}${context}`,
    });
  return (
    <aside
      className={styles.rail}
      data-archive-navigation
      aria-label="工作区目录"
    >
      <Link
        href="/"
        className={styles.brand}
        aria-label="Atelier 设计工作室 首页"
      >
        <span aria-hidden="true">a</span>
        <span>
          Atelier<small>设计工作室</small>
        </span>
      </Link>
      <nav aria-label="工作区导航" className={styles.navigation}>
        {entries.map((entry) => (
          <Link
            key={entry.id}
            href={entry.href}
            aria-current={current === entry.id ? "page" : undefined}
          >
            <NavigationIcon name={entry.id} />
            <span>{entry.title}</span>
          </Link>
        ))}
      </nav>
      {projectName && !navigation ? (
        <div className={styles.project}>
          <span>当前项目</span>
          <strong title={projectName}>{projectName}</strong>
        </div>
      ) : null}
      {navigation ? (
        <div className={styles.projectNavigation}>{navigation}</div>
      ) : null}
      {projectId ? (
        <details className={styles.resources}>
          <summary>资料库</summary>
          <Link href={`/fabrics${context}`}>面料库</Link>
          <Link href={`/trends${context}`}>趋势档案</Link>
          {!hideProjectReturn &&
          (current === "fabrics" || current === "trends") ? (
            <Link href={`/${encodeURIComponent(projectId)}`}>返回设计画布</Link>
          ) : null}
        </details>
      ) : null}
      <div className={styles.account}>{account}</div>
    </aside>
  );
}
