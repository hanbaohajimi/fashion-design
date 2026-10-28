"use client";

import Link from "next/link";
import { markMotion } from "../../components/motion/events";
import { useArchiveOpening } from "../../components/motion/use-archive-opening";
import { AppHeader } from "../../components/AppHeader";
import { Button, Notice, Skeleton, SkeletonGroup } from "../../components/ui";
import { useSlidingIndicator } from "../../components/interactions/use-sliding-indicator";
import { notifyOperation } from "../../components/operation-notice";
import controls from "../../components/ui.module.css";
import { userFacingError } from "../../components/user-facing-error";
import { useGuardedRouter as useRouter } from "../use-guarded-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchQuery } from "./use-search-query";
import { useProjectArchiveUndo } from "./project-archive-undo";

import { useAuth } from "../auth/AuthProvider";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { EmptyState } from "./EmptyState";
import { ProjectGrid } from "./ProjectGrid";
import { ProjectSpotlight } from "./ProjectSpotlight";
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
  const removalFocus = useRef<{ id: string; next: HTMLElement | null } | null>(
    null,
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchState = useSearchQuery(search);
  const deferredSearch = searchState.query;
  const indicator = useSlidingIndicator(projectStatus, true);
  const projectsQuery = useProjects(
    deferredSearch,
    projectStatus,
    Boolean(session),
  );
  const createMutation = useCreateProject();
  const updateMutation = useUpdateProject();
  const recordArchive = useProjectArchiveUndo((project) => updateMutation.mutateAsync({
    id: project.id, input: { archived: false }, source: project,
  }));
  const deleteMutation = useDeleteProject();
  const duplicateMutation = useDuplicateProject();
  const projects = useMemo(
    () => projectsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [projectsQuery.data],
  );
  const total = projectsQuery.data?.pages[0]?.total ?? 0;
  const motionRoot = useRef<HTMLElement>(null);
  useArchiveOpening(
    motionRoot,
    Boolean(session) && !authLoading && projectsQuery.isSuccess,
    false,
  );
  useEffect(() => {
    const pending = removalFocus.current;
    if (!pending || projects.some((item) => item.id === pending.id)) return;
    removalFocus.current = null;
    if (document.activeElement !== document.body) return;
    if (pending.next?.isConnected) pending.next.focus();
    else searchInputRef.current?.focus();
  }, [projects]);
  const prepareRemovalFocus = (project: Project) => {
    const cards = Array.from(
      motionRoot.current?.querySelectorAll<HTMLElement>("[data-project-id]") ??
        [],
    );
    const index = cards.findIndex(
      (card) => card.dataset.projectId === project.id,
    );
    const card = cards[index];
    if (!card) return;
    const active = document.activeElement;
    // 菜单挂在卡片外时，通过触发器的 aria-controls 保留焦点归属。
    const ownsFocus = card.contains(active) || Array.from(
      card.querySelectorAll<HTMLElement>("[aria-controls]"),
    ).some((trigger) => trigger.getAttribute("aria-controls")?.split(/\s+/).some(
      (id) => document.getElementById(id)?.contains(active),
    ));
    if (!ownsFocus) return;
    const next = cards[index + 1] ?? cards[index - 1];
    removalFocus.current = {
      id: project.id,
      next: next?.querySelector<HTMLElement>("summary,a[href]") ?? null,
    };
  };

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
    markMotion(`project:${created.id}`, "signature");
    router.push(`/${created.id}`);
  };

  const runRename = async (project: Project, name: string): Promise<void> => {
    setNotice(null);

    try {
      await updateMutation.mutateAsync({
        id: project.id,
        input: { name },
        source: project,
      });
    } catch (error) {
      throw new Error(errorMessage(error));
    }
  };

  const runArchive = async (project: Project): Promise<void> => {
    setNotice(null);
    prepareRemovalFocus(project);

    try {
      const archived = await updateMutation.mutateAsync({
        id: project.id,
        input: { archived: true },
        source: project,
      });
      if (readActiveBoardId() === project.id) {
        clearActiveBoardId();
      }
      recordArchive(archived);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };

  const runRestore = async (project: Project): Promise<void> => {
    setNotice(null);
    prepareRemovalFocus(project);

    try {
      await updateMutation.mutateAsync({
        id: project.id,
        input: { archived: false },
        source: project,
      });
      notifyOperation({ id: `restore:${project.id}`, title: "项目已恢复" });
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };

  const runDelete = async (project: Project): Promise<void> => {
    setNotice(null);
    prepareRemovalFocus(project);

    try {
      await deleteMutation.mutateAsync(project.id);
    } catch (error) {
      throw new Error(errorMessage(error));
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
      .then(() => {
        notifyOperation({
          id: `duplicate:${project.id}`,
          title: "已复制当前设计；历史对话和执行记录保留在原项目",
        });
      })
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
    <main
      ref={motionRoot}
      className={`${styles.library} ${controls.controlSurface}`}
      data-guide-page="projects"
      data-guide-ready={projectsQuery.isSuccess ? "true" : "false"}
    >
      <AppHeader current="projects" />

      <section className={styles.dashboard} aria-label="项目库">
        <h1 className={styles.dashboardTitle}>项目库</h1>
      </section>

      <section className={styles.toolbar} aria-label="项目工具栏">
        <div ref={indicator} style={{ position: "relative" }} className={styles.statusFilters} aria-label="项目状态">
          <button
            aria-pressed={projectStatus === "active"}
            data-indicator-value="active"
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
            data-indicator-value="archived"
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
        <label className={styles.search} data-guide={projects.length ? "projects-search" : undefined}>
          <span className={styles.srOnly}>搜索项目</span>
          <span aria-hidden="true">⌕</span>
          <input
            aria-keyshortcuts="Control+K Meta+K"
            maxLength={80}
            onChange={(event) => setSearch(event.target.value)}
            onCompositionStart={searchState.onCompositionStart}
            onCompositionEnd={searchState.onCompositionEnd}
            placeholder="搜索项目名称"
            ref={searchInputRef}
            type="search"
            value={search}
          />
        </label>
        <span aria-live="polite" className={styles.projectCount} role="status">
          {searchState.pending || projectsQuery.isPlaceholderData ? "正在搜索，暂显示上次结果…" : `${total} 个${projectStatus === "archived" ? "归档项目" : "项目"}`}
        </span>
        <Button
          data-guide="projects-create"
          interaction="ripple"
          variant={projects.length ? "primary" : "secondary"}
          onClick={() => setCreateOpen(true)}
        >
          <span aria-hidden="true">＋</span>
          新建项目
        </Button>
      </section>

      {!deferredSearch &&
      projectStatus === "active" &&
      !projectsQuery.isError &&
      !projectsQuery.isPending &&
      projects.length ? (
        <ProjectSpotlight projects={projects} userId={session.user.id} />
      ) : null}

      {notice ? (
        <Notice tone="error">
          {notice}
          <button onClick={() => setNotice(null)} type="button">
            关闭
          </button>
        </Notice>
      ) : null}

      {projectsQuery.isError && projectsQuery.data ? (
        <Notice tone="error">
          项目列表刷新失败，仍显示上次载入的资料。
          <Button size="small" loading={projectsQuery.isFetching} onClick={() => void projectsQuery.refetch()}>
            重新加载
          </Button>
        </Notice>
      ) : null}
      {projectsQuery.isPending ? (
        <section aria-label="正在加载项目"><SkeletonGroup className={styles.skeletonGrid ?? ""}>
          {Array.from({ length: 6 }, (_, index) => (
            <div className={styles.projectSkeleton} key={index}>
              <Skeleton
                label="正在加载项目作品"
                className={styles.projectCover}
              />
              <div className={styles.cardBody}>
                <Skeleton label="正在加载项目名称" />
                <Skeleton label="正在加载项目资料" />
              </div>
            </div>
          ))}
        </SkeletonGroup></section>
      ) : projectsQuery.isError && !projectsQuery.data ? (
        <section className={styles.errorState}>
          <p>{errorMessage(projectsQuery.error)}</p>
          <Button
            className={styles.secondaryButton}
            loading={projectsQuery.isFetching}
            onClick={() => void projectsQuery.refetch()}
            type="button"
          >
            重新加载
          </Button>
        </section>
      ) : (
        <>
          <ProjectGrid
            duplicatingProjectIds={duplicatingProjectIds}
            onArchive={runArchive}
            onDelete={runDelete}
            onDuplicate={runDuplicate}
            onRename={runRename}
            onRestore={runRestore}
            projects={projects}
            busy={searchState.pending || projectsQuery.isFetching}
          />
          {projects.length === 0 ? <EmptyState
            archived={projectStatus === "archived"}
            onClearSearch={() => { setSearch(""); searchInputRef.current?.focus(); }}
            onCreate={() => setCreateOpen(true)}
            searching={Boolean(deferredSearch)}
          /> : null}
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
      )}

      <CreateProjectDialog
        onClose={() => setCreateOpen(false)}
        onCreate={runCreate}
        open={createOpen}
      />
    </main>
  );
}
