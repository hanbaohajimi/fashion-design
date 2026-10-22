"use client";

import Link from "next/link";
import { AppHeader } from "../../components/AppHeader";
import { Button, Skeleton } from "../../components/ui";
import controls from "../../components/ui.module.css";
import { userFacingError } from "../../components/user-facing-error";
import { useGuardedRouter as useRouter } from "../use-guarded-router";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { EmptyState } from "./EmptyState";
import { ProjectGrid } from "./ProjectGrid";
import type { Project, ProjectStatusFilter } from "./project-types";
import styles from "./projects.module.css";
import {
  useCreateProject,
  useDeleteProject,
  useDuplicateProject,
  useProjects,
  useUpdateProject,
} from "./use-projects";
import {
  clearActiveBoardId,
  readActiveBoardId,
  writeActiveBoardId,
} from "../trends/active-board";

function errorMessage(error: unknown): string {
  return userFacingError(error, "操作失败，请稍后重试");
}

export function ProjectLibrary() {
  const router = useRouter();
  const {
    error: authError,
    loading: authLoading,
    refresh: refreshAuth,
    session,
  } = useAuth();
  const [search, setSearch] = useState("");
  const [projectStatus, setProjectStatus] =
    useState<ProjectStatusFilter>("active");
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [duplicatingProjectIds, setDuplicatingProjectIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const duplicateFlightsRef = useRef(new Map<string, Promise<void>>());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const deferredSearch = useDeferredValue(search.trim());
  const projectsQuery = useProjects(
    deferredSearch,
    projectStatus,
    Boolean(session),
  );
  const createMutation = useCreateProject();
  const updateMutation = useUpdateProject();
  const deleteMutation = useDeleteProject();
  const duplicateMutation = useDuplicateProject();
  const projects = useMemo(
    () => projectsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [projectsQuery.data],
  );
  const total = projectsQuery.data?.pages[0]?.total ?? 0;

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent): void => {
      const searchInput = searchInputRef.current;

      if (!searchInput) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.focus();
        searchInput.select();
        return;
      }

      if (event.key === "Escape" && document.activeElement === searchInput) {
        if (search) {
          setSearch("");
        } else {
          searchInput.blur();
        }
      }
    };

    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, [search]);

  const runCreate = async (name: string): Promise<void> => {
    setNotice(null);
    const created = await createMutation.mutateAsync({
      idempotencyKey: crypto.randomUUID(),
      name,
    });
    setProjectStatus("active");
    writeActiveBoardId(created.id);
    router.push(`/${created.id}`);
  };

  const runRename = async (project: Project, name: string): Promise<void> => {
    setNotice(null);

    try {
      await updateMutation.mutateAsync({
        id: project.id,
        input: { name },
      });
    } catch (error) {
      setNotice(errorMessage(error));
      throw error;
    }
  };

  const runArchive = async (project: Project): Promise<void> => {
    setNotice(null);

    try {
      await updateMutation.mutateAsync({
        id: project.id,
        input: { archived: true },
      });
      if (readActiveBoardId() === project.id) {
        clearActiveBoardId();
      }
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };

  const runRestore = async (project: Project): Promise<void> => {
    setNotice(null);

    try {
      await updateMutation.mutateAsync({
        id: project.id,
        input: { archived: false },
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
      throw error;
    }
  };

  const runDuplicate = async (project: Project): Promise<void> => {
    const existingFlight = duplicateFlightsRef.current.get(project.id);

    if (existingFlight) {
      return existingFlight;
    }

    setNotice(null);
    setDuplicatingProjectIds((current) => {
      const next = new Set(current);
      next.add(project.id);
      return next;
    });

    const idempotencyKey = crypto.randomUUID();
    const flight = duplicateMutation
      .mutateAsync({
        idempotencyKey,
        projectId: project.id,
      })
      .then(() => { setNotice("已复制当前设计；历史对话和执行记录保留在原项目"); })
      .catch((error: unknown) => {
        setNotice(errorMessage(error));
      })
      .finally(() => {
        duplicateFlightsRef.current.delete(project.id);

        setDuplicatingProjectIds((current) => {
          const next = new Set(current);
          next.delete(project.id);
          return next;
        });
      });

    duplicateFlightsRef.current.set(project.id, flight);
    return flight;
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
        <section className={styles.stateCard}>
          <h1>暂时无法打开项目库</h1>
          <p role="alert">
            {authError ?? "登录状态已失效，请重新登录后继续。"}
          </p>
          <div className={styles.stateActions}>
            <button
              className={styles.primaryButton}
              onClick={() => void refreshAuth()}
              type="button"
            >
              重试认证
            </button>
            <Link className={styles.secondaryButton} href="/login">
              前往登录
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`${styles.library} ${controls.controlSurface}`}>
      <AppHeader current="projects" />

      <section className={styles.dashboard} aria-label="项目库">
        <h1 className={styles.dashboardTitle}>项目库</h1>
      </section>

      <section className={styles.toolbar} aria-label="项目工具栏">
        <div className={styles.statusFilters} aria-label="项目状态">
          <button
            aria-pressed={projectStatus === "active"}
            className={
              projectStatus === "active"
                ? styles.statusFilterActive
                : styles.statusFilter
            }
            onClick={() => setProjectStatus("active")}
            type="button"
          >
            进行中
          </button>
          <button
            aria-pressed={projectStatus === "archived"}
            className={
              projectStatus === "archived"
                ? styles.statusFilterActive
                : styles.statusFilter
            }
            onClick={() => setProjectStatus("archived")}
            type="button"
          >
            已归档
          </button>
        </div>
        <label className={styles.search}>
          <span className={styles.srOnly}>搜索项目</span>
          <span aria-hidden="true">⌕</span>
          <input
            aria-keyshortcuts="Control+K Meta+K"
            maxLength={80}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索项目名称"
            ref={searchInputRef}
            type="search"
            value={search}
          />
        </label>
        <span aria-live="polite" className={styles.projectCount} role="status">
          {total} 个{projectStatus === "archived" ? "归档项目" : "项目"}
        </span>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          <span aria-hidden="true">＋</span>
          新建项目
        </Button>
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
            <Skeleton key={index} label="正在加载项目卡片" className={styles.projectSkeleton} />
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
            duplicatingProjectIds={duplicatingProjectIds}
            onArchive={runArchive}
            onDelete={runDelete}
            onDuplicate={runDuplicate}
            onRename={runRename}
            onRestore={runRestore}
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
          archived={projectStatus === "archived"}
          onClearSearch={() => {
            setSearch("");
            searchInputRef.current?.focus();
          }}
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
