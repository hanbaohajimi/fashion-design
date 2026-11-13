"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import { writeProjectIntake } from "./project-intake";

import { useAuth } from "../auth/AuthProvider";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { EmptyState } from "./EmptyState";
import { PublicLanding } from "./PublicLanding";
import { ProjectGrid } from "./ProjectGrid";
import { ProjectSpotlight } from "./ProjectSpotlight";
import { ConversationalStarter } from "./ConversationalStarter";
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

const QUICK_STARTS = [
  {
    id: "collection",
    starterId: "collection",
    title: "从一件外套开始做完整系列",
    description: "先定廓形，再把面料、色彩和搭配一起整理进白板。",
    projectName: "秋冬通勤外套系列",
    icon: "silhouette",
  },
  {
    id: "material",
    starterId: "material",
    title: "把一块面料变成设计语言",
    description: "从触感和纹理出发，建立可继续扩展的材质档案。",
    projectName: "自然肌理面料实验",
    icon: "material",
  },
  {
    id: "lookbook",
    starterId: "lookbook",
    title: "为品牌做一组视觉提案",
    description: "收集参考、比较方向，再把最有潜力的一版推到交付。",
    projectName: "品牌视觉提案一号",
    icon: "campaign",
  },
] as const;

function errorMessage(error: unknown): string {
  return userFacingError(error, "操作失败，请稍后重试");
}

export function ProjectLibrary() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openCreateFromNavigation = searchParams.get("new") === "1";
  const {
    error: authError,
    loading: authLoading,
    session,
  } = useAuth();
  const [search, setSearch] = useState("");
  const [projectStatus, setProjectStatus] =
    useState<ProjectStatusFilter>("active");
  const [createOpen, setCreateOpen] = useState(false);
  const createDialogOpen = createOpen || openCreateFromNavigation;
  const navigatingToProject = useRef(false);
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

  const runCreate = async (
    name: string,
    starterId?: string,
    brief?: string,
  ): Promise<void> => {
    setNotice(null);
    const created = await createMutation.mutateAsync({
      idempotencyKey: crypto.randomUUID(),
      name,
    });
    setProjectStatus("active");
    writeActiveBoardId(created.id);
    if (brief) {
      try {
        writeProjectIntake(window.sessionStorage, created.id, brief);
      } catch {
        // The brief remains optional; the new project is still usable if storage is unavailable.
      }
    }
    markMotion(`project:${created.id}`, "signature");
    navigatingToProject.current = true;
    router.push(`/${created.id}${starterId ? `?starter=${encodeURIComponent(starterId)}` : ""}`);
  };

  const runQuickStart = async (item: (typeof QUICK_STARTS)[number]): Promise<void> => {
    try {
      await runCreate(item.projectName, item.starterId);
    } catch (error) {
      setNotice(errorMessage(error));
    }
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

  const closeCreate = (): void => {
    setCreateOpen(false);
    if (openCreateFromNavigation && !navigatingToProject.current) {
      router.replace("/", { scroll: false });
    }
    navigatingToProject.current = false;
  };

  if (authLoading) {
    return (
      <main className={styles.statePage}>
        <span className={styles.loadingRule} />
        <p>正在打开你的项目库…</p>
      </main>
    );
  }

  if (authError) {
    // The root route is also the public brand surface. A temporary auth
    // outage must not turn the marketing page into a dead-end for visitors.
    return <PublicLanding />;
  }

  if (!session) return <PublicLanding />;

  return (
    <main
      ref={motionRoot}
      className={`${styles.library} ${controls.controlSurface}`}
      data-guide-page="projects"
      data-guide-ready={projectsQuery.isSuccess ? "true" : "false"}
    >
      <AppHeader current="projects" />

      {/* P2：续创入口 —— 仅当有活跃项目且未在搜索时显示 */}
      {!deferredSearch && projectStatus === "active" && projects.length > 0 ? (() => {
        const latest = projects[0];
        if (!latest) return null;
        return (
          <section className={styles.resumeSection} aria-label="继续上次创作">
            <a
              className={styles.resumeCard}
              href={`/${latest.id}`}
              aria-label={`继续上次创作：${latest.name}`}
            >
              <span className={styles.resumeCardLabel}>继续创作</span>
              <span className={styles.resumeCardName}>{latest.name}</span>
              <span className={styles.resumeCardArrow} aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </a>
          </section>
        );
      })() : null}

      {/* P3：对话式创作起步入口 —— 未在搜索时显示 */}
      {!deferredSearch && projectStatus === "active" ? (
        <section className={styles.starterSection} aria-label="新建创作">
          <ConversationalStarter
            disabled={createMutation.isPending}
            onSubmit={(brief) => void runCreate(
              brief.slice(0, 60) || "新项目",
              "conversational",
              brief,
            )}
          />
        </section>
      ) : null}

      <section className={styles.dashboard} aria-label="项目库" data-workspace-heading>
        <div className={styles.dashboardCopy}>
          <h1 className={styles.dashboardTitle}>项目</h1>
        </div>
        <dl className={styles.dashboardStats} aria-label="创作概览">
          <div>
            <dt>进行中</dt>
            <dd>{projectStatus === "active" ? total : "—"}</dd>
          </div>
          <div>
            <dt>已载入</dt>
            <dd>{projects.length}</dd>
          </div>
          <div>
            <dt>设计资料</dt>
            <dd>{projects.reduce((sum, project) => sum + project.assetCount, 0)}</dd>
          </div>
        </dl>
      </section>

      {!deferredSearch && projectStatus === "active" ? (
        <section className={styles.quickStart} aria-labelledby="quick-start-title">
          <div className={styles.quickStartHeader}>
            <div>
              <h2 id="quick-start-title">选一个方向，直接进入白板</h2>
            </div>
            <p>每个入口都会创建真实项目，之后可以继续补充参考、款式和交付资料。</p>
          </div>
          <div className={styles.quickStartGrid}>
            {QUICK_STARTS.map((item) => (
              <button
                className={styles.quickStartCard}
                disabled={createMutation.isPending}
                key={item.id}
                onClick={() => void runQuickStart(item)}
                type="button"
              >
                <span className={`${styles.quickStartIcon} ${styles[`quickStartIcon${item.icon}`]}`} aria-hidden="true">
                  <span className={styles.quickStartIconMark} />
                </span>
                <span className={styles.quickStartBody}>
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
                <span className={styles.quickStartArrow} aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M3 13 13 3M5 3h8v8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </button>
            ))}
          </div>
          <div className={styles.quickStartResearch} aria-label="研究资料入口">
            <p>
              <strong>先做研究，再决定方向</strong>
              <span>从可靠来源和真实面料建立设计语境，再回到项目白板继续。</span>
            </p>
            <nav className={styles.quickStartResearchLinks} aria-label="研究资料">
              <Link href="/trends?from=projects">浏览趋势档案</Link>
              <Link href="/fabrics?from=projects">浏览面料库</Link>
            </nav>
          </div>
        </section>
      ) : null}

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
          <span aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
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
          <span aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
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
        onClose={closeCreate}
        onCreate={(name, brief) => runCreate(name, undefined, brief)}
        open={createDialogOpen}
      />
    </main>
  );
}
