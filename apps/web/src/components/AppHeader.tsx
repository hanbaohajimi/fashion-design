"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useAuth } from "../modules/auth/AuthProvider";
import { Button, Menu } from "./ui";
import styles from "./app-header.module.css";

export function AppHeader({
  current,
  projectId,
  account,
}: {
  readonly current: "projects" | "fabrics" | "trends";
  readonly projectId?: string | undefined;
  readonly account?: ReactNode;
}) {
  const context = projectId
    ? `?from=board&boardId=${encodeURIComponent(projectId)}`
    : "";
  return (
    <header className={styles.header}>
      <Link
        className={styles.brand}
        href="/"
        aria-label="Atelier 设计工作室 首页"
      >
        <span aria-hidden="true">A</span>
        <strong>
          Atelier <small>设计工作室</small>
        </strong>
      </Link>
      <nav aria-label="工作区导航" className={styles.nav}>
        <Link
          aria-current={current === "projects" ? "page" : undefined}
          href="/"
        >
          项目库
        </Link>
        <Link
          aria-current={current === "fabrics" ? "page" : undefined}
          href={`/fabrics${context}`}
        >
          面料库
        </Link>
        <Link
          aria-current={current === "trends" ? "page" : undefined}
          href={`/trends${context || (current === "projects" ? "?from=projects" : "")}`}
        >
          趋势档案
        </Link>
      </nav>
      <div className={styles.account}>
        {projectId ? (
          <Link
            className={styles.returnLink}
            href={`/${encodeURIComponent(projectId)}`}
          >
            返回设计工作室
          </Link>
        ) : null}
        {account ?? <Account />}
      </div>
    </header>
  );
}

function Account() {
  const { session, logout } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!session) return null;
  return (
    <div>
      <Menu label={session.user.name ?? session.user.email}>
        <span className={styles.email}>{session.user.email}</span>
        <Button
          loading={pending}
          onClick={() => {
            setPending(true);
            setError(null);
            void logout().catch(() => {
              setPending(false);
              setError("退出失败，请重试");
            });
          }}
        >
          退出登录
        </Button>
      </Menu>
      {error ? <small role="alert">{error}</small> : null}
    </div>
  );
}
