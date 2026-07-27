"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { EmptyState } from "./EmptyState";
import { ProjectGrid } from "./ProjectGrid";
import type { Project } from "./project-types";
import styles from "./projects.module.css";
import {
  useCreateProject,
  useDeleteProject,
  useProjects,
  useUpdateProject,
} from "./use-projects";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

export function ProjectLibrary() {
  const { error: authError, loading: authLoading, session } = useAuth();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim());
  const projectsQuery = useProjects(deferredSearch, Boolean(session));
  const createMutation = useCreateProject();
  const updateMutation = useUpdateProject();
  const deleteMutation = useDeleteProject();
  const projects = useMemo(
    () => projectsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [projectsQuery.data],
  );
  const total = projectsQuery.data?.pages[0]?.total ?? 0;

  const runCreate = async (name: string): Promise<void> => {
    setNotice(null);

    try {
      await createMutation.mutateAsync({
        idempotencyKey: crypto.randomUUID(),
        name,
      });
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };

  const runRename = async (
    project: Project,
    name: string,
  ): Promise<void> => {
    setNotice(null);

    try {
      await updateMutation.mutateAsync({
        id: project.id,
        input: { name },
      });
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };

  const runArchive = async (project: Project): Promise<void> => {
    setNotice(null);

    try {
      await updateMutation.mutateAsync({
        id: project.id,
        input: { archived: true },
      });
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };

  const runDelete = async (project: Project): Promise<void> => {
    setNotice(null);

    try {
      await deleteMutation.mutateAsync(project.id);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };

  if (authLoading) {
    return (
      <main className={styles.statePage}>
        <span className={styles.loadingRule} />
        <p>正在打开你的项目库…</p>
      </main>
    );
  }

  if (authError || !session) {
    return (
      <main className={styles.statePage}>
        <p role="alert">{authError ?? "登录状态已失效，正在返回登录页。"}</p>
      </main>
    );
  }

  return (
    <main className={styles.library}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label="AI Fashion Design 首页">
          <span>AI</span>
          <strong>FASHION / DESIGN</strong>
        </Link>
        <div className={styles.account}>
          <span>{session.user.email}</span>
          <span className={styles.avatar} aria-hidden="true">
            {(session.user.name ?? session.user.email).slice(0, 1).toUpperCase()}
          </span>
        </div>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.kicker}>ATELIER INDEX · 01</p>
          <h1>
            项目
            <em>库</em>
          </h1>
        </div>
        <p className={styles.heroNote}>
          每一个系列，都从一块留白开始。
          <br />
          在这里整理你的设计方向与资产。
        </p>
      </section>

      <section className={styles.toolbar} aria-label="项目工具栏">
        <label className={styles.search}>
          <span className={styles.srOnly}>搜索项目</span>
          <span aria-hidden="true">⌕</span>
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索项目名称"
            type="search"
            value={search}
          />
        </label>
        <span className={styles.projectCount}>
          {String(total).padStart(2, "0")} PROJECTS
        </span>
        <button
          className={styles.primaryButton}
          onClick={() => setCreateOpen(true)}
          type="button"
        >
          <span aria-hidden="true">＋</span>
          新建项目
        </button>
      </section>

      {notice ? (
        <div className={styles.notice} role="alert">
          {notice}
          <button onClick={() => setNotice(null)} type="button">
            关闭
          </button>
        </div>
      ) : null}

      {projectsQuery.isPending ? (
        <section className={styles.skeletonGrid} aria-label="正在加载项目">
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} />
          ))}
        </section>
      ) : projectsQuery.isError ? (
        <section className={styles.errorState}>
          <p>{errorMessage(projectsQuery.error)}</p>
          <button
            className={styles.secondaryButton}
            onClick={() => void projectsQuery.refetch()}
            type="button"
          >
            重新加载
          </button>
        </section>
      ) : projects.length > 0 ? (
        <>
          <ProjectGrid
            onArchive={runArchive}
            onDelete={runDelete}
            onRename={runRename}
            projects={projects}
          />
          {projectsQuery.hasNextPage ? (
            <div className={styles.loadMore}>
              <button
                className={styles.secondaryButton}
                disabled={projectsQuery.isFetchingNextPage}
                onClick={() => void projectsQuery.fetchNextPage()}
                type="button"
              >
                {projectsQuery.isFetchingNextPage
                  ? "正在加载…"
                  : "加载更多项目"}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          onCreate={() => setCreateOpen(true)}
          searching={Boolean(deferredSearch)}
        />
      )}

      <CreateProjectDialog
        onClose={() => setCreateOpen(false)}
        onCreate={runCreate}
        open={createOpen}
      />
    </main>
  );
}
