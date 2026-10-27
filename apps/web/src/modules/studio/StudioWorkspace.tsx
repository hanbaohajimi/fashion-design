"use client";

import { Fragment, useCallback, useEffect, useId, useState } from "react";
import type { ExperimentCreateInput, StudioSummary } from "@fashion/shared";
import {
  Badge,
  Button,
  EmptyState,
  Notice,
  Skeleton,
  SkeletonGroup,
  Dialog,
  TabPanel,
  Menu,
} from "../../components/ui";
import { AppHeader } from "../../components/AppHeader";
import { RevisionSaved } from "../../components/motion/RevisionSaved";
import { fetchProject } from "../projects/projects-api";
import { fetchStudio } from "./studio-api";
import { useStudioLeaveGuard, errorMessage } from "./studio-ui";
import { TaskEntry } from "./TaskEntry";
import { StyleLibrary } from "./StyleLibrary";
import { BrandLibrary } from "./BrandLibrary";
import { PlanningBoard } from "./PlanningBoard";
import { TechPackEditor } from "./TechPackEditor";
import { SampleRounds } from "./SampleRounds";
import { CollaborationPanel } from "./CollaborationPanel";
import { ExperimentPanel } from "./ExperimentPanel";
import { PrintWorkbench } from "./PrintWorkbench";
import { PresentationSets } from "./PresentationSets";
import { TrendBriefPanel } from "./TrendBriefPanel";
import { RunwayWorkspace } from "../runway/RunwayWorkspace";
import styles from "./studio.module.css";
import { CreativeProgress } from "./CreativeProgress";
import { useAuth } from "../auth/AuthProvider";
import { rememberCreativeVisit } from "../projects/creative-memory";
import { StudioAssetNames } from "./studio-object-context";
import { StudioNavigation } from "./StudioNavigation";
import {
  isStudioTab,
  STUDIO_GROUPS,
  type StudioTab as Tab,
} from "./studio-navigation";

const ROLE_LABELS = {
  OWNER: "所有者",
  EDITOR: "编辑",
  REVIEWER: "评审",
  VIEWER: "只读",
};

export function StudioWorkspace({
  projectId,
  initialAssetId,
  initialTab,
  initialStyleRevisionId,
  initialShowId,
  initialRunId,
}: {
  readonly projectId: string;
  readonly initialAssetId?: string | undefined;
  readonly initialTab?: string | undefined;
  readonly initialStyleRevisionId?: string | undefined;
  readonly initialShowId?: string | undefined;
  readonly initialRunId?: string | undefined;
}) {
  const { session } = useAuth();
  const [preferredRevision, setPreferredRevision] = useState(
    initialStyleRevisionId,
  );
  const [runwayEntry, setRunwayEntry] = useState({
    showId: initialShowId,
    runId: initialRunId,
  });
  const [data, setData] = useState<StudioSummary | null>(null);
  const [name, setName] = useState("设计项目");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(
    initialTab === "runway"
      ? "runway"
      : initialAssetId
        ? "styles"
        : isStudioTab(initialTab)
          ? initialTab
          : "tasks",
  );
  const [experimentMode, setExperimentMode] =
    useState<ExperimentCreateInput["mode"]>("color");
  const [dirty, setDirty] = useState(false);
  const [exploreAsset, setExploreAsset] = useState<string | undefined>(
    undefined,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [panelVersion, setPanelVersion] = useState(0);
  const [progressOpen, setProgressOpen] = useState(false);
  const guard = useStudioLeaveGuard(dirty);
  const tabsId = useId();
  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await fetchStudio(projectId);
      setData(next);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setRefreshing(false);
    }
  }, [projectId]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetchStudio(projectId, controller.signal),
      fetchProject(projectId),
    ]).then(
      ([next, project]) => {
        if (controller.signal.aborted) return;
        setData(next);
        setName(project.name);
        setLoading(false);
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(cause));
          setLoading(false);
        }
      },
    );
    return () => controller.abort();
  }, [projectId]);
  const changeTab = async (next: Tab) => {
    if (tab !== next && (await guard.confirmLeave())) {
      setDirty(false);
      setTab(next);
      const url = new URL(window.location.href);
      if (next === "runway")
        setRunwayEntry({
          showId: url.searchParams.get("showId") ?? undefined,
          runId: url.searchParams.get("runId") ?? undefined,
        });
      url.searchParams.set("tab", next);
      if (next !== "styles") url.searchParams.delete("assetId");
      window.history.replaceState(window.history.state, "", url);
      if (session)
        rememberCreativeVisit(
          session.user.id,
          projectId,
          url.pathname + url.search,
        );
    }
  };
  const props = {
    projectId,
    canEdit: data?.capabilities.edit ?? false,
    onDirty: setDirty,
    onSaved: reload,
    beforeChange: guard.confirmLeave,
  };
  return (
    <>
      <AppHeader
        current="studio"
        currentIsParent
        projectId={projectId}
        projectName={name}
        hideProjectReturn
        navigation={
          <StudioNavigation
            id={tabsId}
            value={tab}
            onChange={(next) => void changeTab(next)}
          />
        }
      />
      <main
        data-studio-motion
        data-studio-page={tab}
        className={styles.shell}
        onInvalidCapture={(event) => {
          const input = event.target;
          if (input instanceof HTMLElement) {
            let parent: HTMLElement | null = input.parentElement;
            while (parent) {
              if (parent instanceof HTMLDetailsElement) parent.open = true;
              parent = parent.parentElement;
            }
          }
        }}
      >
        <div className={styles.workspaceMain}>
          <header className={styles.header}>
            <h1 className={styles.accessibleTitle}>{name} · 款式与交付</h1>
            <div>
              <nav aria-label="项目导航" className={styles.toolbar}>
                <strong>{name}</strong>
                {[
                  ["项目库", "/"],
                  ["设计工作台", `/${encodeURIComponent(projectId)}`],
                  [
                    "面料库",
                    `/fabrics?from=board&boardId=${encodeURIComponent(projectId)}`,
                  ],
                  [
                    "趋势档案",
                    `/trends?from=board&boardId=${encodeURIComponent(projectId)}`,
                  ],
                ].map(([label, href]) => (
                  <Button
                    key={label}
                    onClick={() => {
                      void (async () => {
                        if (href && (await guard.confirmLeave()))
                          window.location.assign(href);
                      })();
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </nav>
              <span className={styles.projectCaption}>款式与交付</span>
            </div>
            <div className={styles.toolbar}>
              {data ? (
                <Button
                  size="small"
                  variant="ghost"
                  onClick={() => setProgressOpen(true)}
                >
                  创作进展
                </Button>
              ) : null}
              <div className={styles.toolbar} aria-label="项目选项">
                {data ? <Badge>{ROLE_LABELS[data.role]}</Badge> : null}

                <Button
                  size="small"
                  loading={refreshing}
                  onClick={() =>
                    void (async () => {
                      if (await guard.confirmLeave()) {
                        setDirty(false);
                        await reload();
                        setPanelVersion((current) => current + 1);
                      }
                    })()
                  }
                >
                  刷新资料
                </Button>
              </div>
              {data && !data.capabilities.edit ? (
                <span className={styles.muted}>只读工作区</span>
              ) : null}
            </div>
            <div className={styles.mobileNavigation}>
              <div className={styles.mobileFunction}>
                <span title={name}>{name}</span>
                <Menu label="当前功能" trigger={STUDIO_GROUPS.map((group) => group.items.find((item) => item.value === tab)?.label).find(Boolean) ?? "切换功能"}>
                  {STUDIO_GROUPS.map((group) => (
                    <Fragment key={group.label}>
                      <span className={styles.muted}>{group.label}</span>
                      {group.items.map((item) => (
                        <button type="button" aria-current={item.value === tab ? "page" : undefined} onClick={() => void changeTab(item.value)} key={item.value}>
                          {item.label}
                        </button>
                      ))}
                    </Fragment>
                  ))}
                </Menu>
              </div>
            </div>
          </header>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {loading || (!data && refreshing) ? (
            <SkeletonGroup className={styles.section}>
              <Skeleton
                className={styles.skeleton}
                label="正在加载工作室资料"
              />
              <Skeleton
                className={styles.skeleton}
                label="正在加载款式与修订"
              />
            </SkeletonGroup>
          ) : data ? (
            <>
              <StudioAssetNames data={data}>
                <div className={styles.body} key={panelVersion}>
                  <TabPanel tabsId={tabsId} value="trends" activeValue={tab}>
                    <TrendBriefPanel
                      projectId={projectId}
                      brands={data.brandProfiles}
                      canEdit={data.capabilities.edit}
                      onDirty={setDirty}
                    />
                  </TabPanel>
                  <TabPanel tabsId={tabsId} value="tasks" activeValue={tab}>
                    <TaskEntry {...props} data={data} />
                  </TabPanel>
                  <TabPanel tabsId={tabsId} value="styles" activeValue={tab}>
                    <StyleLibrary
                      {...props}
                      data={data}
                      initialAssetId={initialAssetId}
                      onPresentation={(revisionId) => {
                        void (async () => {
                          if (!(await guard.confirmLeave())) return;
                          setDirty(false);
                          setPreferredRevision(revisionId);
                          setTab("presentation");
                          const url = new URL(window.location.href);
                          url.searchParams.set("tab", "presentation");
                          url.searchParams.set("styleRevisionId", revisionId);
                          url.searchParams.delete("assetId");
                          window.history.replaceState(
                            window.history.state,
                            "",
                            url,
                          );
                          if (session)
                            rememberCreativeVisit(
                              session.user.id,
                              projectId,
                              url.pathname + url.search,
                            );
                        })();
                      }}
                      onRunway={(revisionId) => {
                        void (async () => {
                          if (!(await guard.confirmLeave())) return;
                          setDirty(false);
                          setPreferredRevision(revisionId);
                          setTab("runway");
                          setRunwayEntry({
                            showId: undefined,
                            runId: undefined,
                          });
                          const url = new URL(window.location.href);
                          url.searchParams.set("tab", "runway");
                          url.searchParams.set("styleRevisionId", revisionId);
                          url.searchParams.delete("assetId");
                          url.searchParams.delete("showId");
                          url.searchParams.delete("runId");
                          window.history.replaceState(
                            window.history.state,
                            "",
                            url,
                          );
                          if (session)
                            rememberCreativeVisit(
                              session.user.id,
                              projectId,
                              url.pathname + url.search,
                            );
                        })();
                      }}
                      onTechPack={(revisionId) => {
                        void (async () => {
                          if (!(await guard.confirmLeave())) return;
                          setDirty(false);
                          setPreferredRevision(revisionId);
                          setTab("tech");
                          const url = new URL(window.location.href);
                          url.searchParams.set("tab", "tech");
                          url.searchParams.set("styleRevisionId", revisionId);
                          url.searchParams.delete("assetId");
                          window.history.replaceState(
                            window.history.state,
                            "",
                            url,
                          );
                          if (session)
                            rememberCreativeVisit(
                              session.user.id,
                              projectId,
                              url.pathname + url.search,
                            );
                        })();
                      }}
                      onExplore={(assetId) => {
                        void (async () => {
                          if (await guard.confirmLeave()) {
                            setDirty(false);
                            setExploreAsset(assetId);
                            setTab("experiments");
                            const url = new URL(window.location.href);
                            url.searchParams.set("tab", "experiments");
                            url.searchParams.delete("assetId");
                            window.history.replaceState(
                              window.history.state,
                              "",
                              url,
                            );
                            if (session)
                              rememberCreativeVisit(
                                session.user.id,
                                projectId,
                                url.pathname + url.search,
                              );
                          }
                        })();
                      }}
                    />
                  </TabPanel>
                  <TabPanel
                    tabsId={tabsId}
                    value="experiments"
                    activeValue={tab}
                  >
                    <ExperimentPanel
                      key={exploreAsset ?? "default"}
                      {...(exploreAsset
                        ? { initialSourceAssetId: exploreAsset }
                        : {})}
                      projectId={projectId}
                      assets={data.assets}
                      styles={data.styles}
                      initialMode={experimentMode}
                      canEdit={data.capabilities.edit}
                      onDirty={setDirty}
                      onRefresh={() => void reload()}
                    />
                  </TabPanel>
                  <TabPanel tabsId={tabsId} value="patterns" activeValue={tab}>
                    <PrintWorkbench
                      projectId={projectId}
                      assets={data.assets}
                      documents={data.patterns}
                      canEdit={data.capabilities.edit}
                      onDirty={setDirty}
                      beforeChange={guard.confirmLeave}
                      onRefresh={() => void reload()}
                    />
                  </TabPanel>
                  <TabPanel
                    tabsId={tabsId}
                    value="presentation"
                    activeValue={tab}
                  >
                    <PresentationSets
                      key={preferredRevision ?? "presentation"}
                      {...props}
                      data={data}
                      initialStyleRevisionId={preferredRevision}
                      onOpenStyles={() => void changeTab("styles")}
                      onGenerate={() => {
                        setExperimentMode("presentation");
                        void changeTab("experiments");
                      }}
                    />
                  </TabPanel>
                  <TabPanel tabsId={tabsId} value="runway" activeValue={tab}>
                    <RunwayWorkspace
                      {...props}
                      data={data}
                      initialShowId={runwayEntry.showId}
                      initialRunId={runwayEntry.runId}
                      initialStyleRevisionId={preferredRevision}
                    />
                  </TabPanel>
                  <TabPanel tabsId={tabsId} value="brand" activeValue={tab}>
                    <BrandLibrary {...props} data={data} />
                  </TabPanel>
                  <TabPanel tabsId={tabsId} value="planning" activeValue={tab}>
                    <PlanningBoard {...props} data={data} />
                  </TabPanel>
                  <TabPanel tabsId={tabsId} value="tech" activeValue={tab}>
                    <TechPackEditor
                      {...props}
                      data={data}
                      initialStyleRevisionId={preferredRevision}
                    />
                  </TabPanel>
                  <TabPanel tabsId={tabsId} value="samples" activeValue={tab}>
                    <SampleRounds {...props} data={data} />
                  </TabPanel>
                  <TabPanel tabsId={tabsId} value="team" activeValue={tab}>
                    <CollaborationPanel {...props} data={data} />
                  </TabPanel>
                </div>
              </StudioAssetNames>
            </>
          ) : (
            <EmptyState
              title="工作室暂时无法打开"
              action={<Button loading={refreshing} onClick={() => void reload()}>重新加载</Button>}
            >
              检查网络和项目访问权限后重试。
            </EmptyState>
          )}
        </div>
        {progressOpen && data ? (
          <Dialog
            className={styles.dialog}
            label="创作进展"
            onClose={() => setProgressOpen(false)}
          >
            <div className={styles.progressDialog}>
              <div className={styles.recordHeader}>
                <h2>创作进展</h2>
                <Button onClick={() => setProgressOpen(false)}>关闭</Button>
              </div>
              <CreativeProgress
                expanded
                data={data}
                onNavigate={(next) => {
                  if (isStudioTab(next)) {
                    setProgressOpen(false);
                    void changeTab(next);
                  }
                }}
              />
            </div>
          </Dialog>
        ) : null}
        {guard.dialog}
        <RevisionSaved />
      </main>
    </>
  );
}
