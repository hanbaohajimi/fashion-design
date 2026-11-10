"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ExperimentCreateInput, StudioDocumentView, StudioStyleView, StudioSummary } from "@fashion/shared";
import {
  Button,
  EmptyState,
  Notice,
  Skeleton,
  SkeletonGroup,
  Dialog,
  TabPanel,
  Menu,
  SegmentedControl,
} from "../../components/ui";
import { ProjectTaskCenter } from "../tasks/ProjectTaskCenter";
import { AppHeader } from "../../components/AppHeader";
import { useWorkspaceChromeActions } from "../../components/WorkspaceChrome";
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
import { RealtimeTryOnPanel } from "./realtime-tryon/RealtimeTryOnPanel";
import { WardrobeWorkspace } from "./wardrobe/WardrobeWorkspace";
import { TrendBriefPanel } from "./TrendBriefPanel";
import { RunwayWorkspace } from "../runway/RunwayWorkspace";
import styles from "./studio.module.css";
import { CreativeProgress } from "./CreativeProgress";
import { useAuth } from "../auth/AuthProvider";
import { rememberCreativeVisit } from "../projects/creative-memory";
import { StudioAssetNames } from "./studio-object-context";
import { StudioNavigation } from "./StudioNavigation";
import { StudioHeaderContext } from "./StudioPageHeader";
import { mergeSavedStyles } from "./style-revisions";
import { mergeSavedDeliveryDocuments, mergeSavedRecords } from "./studio-records";
import { StudioSaveRecovery } from "./StudioSaveRecovery";
import { carryStudioSaveDraft, hasActiveStudioSaveForm } from "./studio-save-recovery";
import {
  isStudioTab,
  type StudioTab as Tab,
} from "./studio-navigation";

const ROLE_LABELS = {
  OWNER: "所有者",
  EDITOR: "编辑",
  REVIEWER: "评审",
  VIEWER: "只读",
};

interface StudioWorkspaceProps {
  readonly projectId: string;
  readonly initialAssetId?: string | undefined;
  readonly initialTab?: string | undefined;
  readonly initialStyleRevisionId?: string | undefined;
  readonly initialShowId?: string | undefined;
  readonly initialRunId?: string | undefined;
  readonly initialPresentationMode?: string | undefined;
}

export function StudioWorkspace(props: StudioWorkspaceProps) {
  const { session } = useAuth();
  return <StudioWorkspaceContent key={`${props.projectId}:${session?.user.id ?? "anonymous"}`} {...props} />;
}

function StudioWorkspaceContent({
  projectId,
  initialAssetId,
  initialTab,
  initialStyleRevisionId,
  initialShowId,
  initialRunId,
  initialPresentationMode,
}: StudioWorkspaceProps) {
  const { session } = useAuth();
  const queryString = useSearchParams().toString();
  const appliedQuery = useRef(queryString);
  const replaceLocation = (url: URL) => {
    appliedQuery.current = url.searchParams.toString();
    window.history.replaceState(window.history.state, "", url);
  };
  const { compact, setOpen: setNavigationOpen } = useWorkspaceChromeActions();
  const [preferredRevision, setPreferredRevision] = useState(
    initialStyleRevisionId,
  );
  const [styleEntry, setStyleEntry] = useState({ revisionId: initialStyleRevisionId, assetId: initialTab === "presentation" ? undefined : initialAssetId });
  const [documentEntry, setDocumentEntry] = useState<string | undefined>(() => new URLSearchParams(queryString).get("documentId") ?? undefined);
  const [documentRevisionEntry, setDocumentRevisionEntry] = useState<string | undefined>(() => new URLSearchParams(queryString).get("documentRevisionId") ?? undefined);
  const savedStyles = useRef<StudioStyleView[]>([]);
  const savedDocuments = useRef<StudioDocumentView[]>([]);
  const [runwayEntry, setRunwayEntry] = useState({
    showId: initialShowId,
    runId: initialRunId,
  });
  const [data, setData] = useState<StudioSummary | null>(null);
  const [name, setName] = useState("设计项目");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(
    isStudioTab(initialTab) ? initialTab : initialAssetId || initialStyleRevisionId ? "styles" : "tasks",
  );
  const [presentationMode, setPresentationMode] = useState<"sets" | "wardrobe" | "realtime">(
    initialPresentationMode === "realtime" || initialPresentationMode === "wardrobe" ? initialPresentationMode : "sets",
  );
  const [wardrobeAssetId, setWardrobeAssetId] = useState(initialAssetId);
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
  // In-app selections update the URL without rebuilding a form. Browser traversal
  // and incoming links apply their own object/revision after the leave guard.
  useEffect(() => {
    if (appliedQuery.current === queryString) return;
    appliedQuery.current = queryString;
    const query = new URLSearchParams(queryString);
    const nextTab = query.get("tab") ?? undefined;
    const assetId = query.get("assetId") ?? undefined;
    const revisionId = query.get("styleRevisionId") ?? undefined;
    const mode = query.get("mode");
    setTab(isStudioTab(nextTab) ? nextTab : assetId || revisionId ? "styles" : "tasks");
    setStyleEntry({ revisionId, assetId: nextTab === "presentation" ? undefined : assetId });
    setPreferredRevision(revisionId);
    setDocumentEntry(query.get("documentId") ?? undefined);
    setDocumentRevisionEntry(query.get("documentRevisionId") ?? undefined);
    setWardrobeAssetId(assetId);
    setPresentationMode(mode === "wardrobe" || mode === "realtime" ? mode : "sets");
    setRunwayEntry({ showId: query.get("showId") ?? undefined, runId: query.get("runId") ?? undefined });
    setExploreAsset(undefined);
    setDirty(false);
    setPanelVersion(current => current + 1);
  }, [queryString]);
  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await fetchStudio(projectId);
      setData(mergeSavedDeliveryDocuments({ ...next, styles: mergeSavedStyles(next.styles, savedStyles.current) }, savedDocuments.current));
      setError(null);
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
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
    if (tab === next) {
      if (compact) setNavigationOpen(false);
      return;
    }
    if (tab !== next && (await guard.confirmLeave())) {
      setDirty(false);
      setTab(next);
      setDocumentEntry(undefined);
      setDocumentRevisionEntry(undefined);
      const url = new URL(window.location.href);
      url.searchParams.delete("documentId");
      url.searchParams.delete("documentRevisionId");
      if (next === "runway")
        setRunwayEntry({
          showId: url.searchParams.get("showId") ?? undefined,
          runId: url.searchParams.get("runId") ?? undefined,
        });
      url.searchParams.set("tab", next);
      if (next !== "styles") url.searchParams.delete("assetId");
      else {
        if (styleEntry.revisionId) url.searchParams.set("styleRevisionId", styleEntry.revisionId);
        else url.searchParams.delete("styleRevisionId");
        if (styleEntry.assetId) url.searchParams.set("assetId", styleEntry.assetId);
        else url.searchParams.delete("assetId");
      }
      // Let Next synchronize the query, draft scope and navigation together.
      replaceLocation(url);
      if (compact) setNavigationOpen(false);
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
    onDocumentSaved: (document: StudioDocumentView) => {
      savedDocuments.current = mergeSavedRecords(savedDocuments.current, [document]);
      setData(current => current ? mergeSavedDeliveryDocuments(current, [document]) : current);
    },
    beforeChange: guard.confirmLeave,
  };
  const openStyleRevision = async (revisionId: string) => {
    if (!(await guard.confirmLeave())) return;
    setDirty(false);
    setStyleEntry({ revisionId, assetId: undefined });
    setPreferredRevision(revisionId);
    setTab("styles");
    setDocumentEntry(undefined);
    setDocumentRevisionEntry(undefined);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "styles");
    url.searchParams.set("styleRevisionId", revisionId);
    url.searchParams.delete("assetId");
    url.searchParams.delete("documentId");
    url.searchParams.delete("documentRevisionId");
    replaceLocation(url);
  };
  return (
    <StudioHeaderContext value={{ readOnly: Boolean(data && !data.capabilities.edit), actions: <>
      <Menu label="项目菜单" trigger={<span className={styles.projectMenuName} title={name}>{name}</span>}>
        {data ? <span className={styles.muted}>{ROLE_LABELS[data.role]}</span> : null}
        <Button disabled={!data} onClick={() => setProgressOpen(true)}>创作进展</Button>
        <Button loading={refreshing} onClick={() => void (async () => {
          if (await guard.confirmLeave()) {
            setDirty(false);
            await reload();
            setPanelVersion(current => current + 1);
          }
        })()}>刷新资料</Button>
      </Menu>
      <ProjectTaskCenter projectId={projectId} />
    </> }}><>
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
        data-guide-page="studio"
        data-guide-ready={!loading && !refreshing && Boolean(data) && !error ? "true" : "false"}
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
          <h1 className={styles.accessibleTitle}>{name} 款式与交付</h1>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {session ? <StudioSaveRecovery accountId={session.user.id} projectId={projectId}
            onConfirmed={({ record, result }) => {
              // Merge confirmed records only when the user opens/reloads them. Updating
              // the active editor's version key here would destroy its newer draft.
              if (record.value.operation.kind === "style") savedStyles.current = mergeSavedStyles(savedStyles.current, [result as StudioStyleView]);
              else savedDocuments.current = mergeSavedRecords(savedDocuments.current, [result as StudioDocumentView]);
            }}
            onOpen={async ({ record, result }) => {
              if (!hasActiveStudioSaveForm(record) && !(await guard.confirmLeave())) return;
              await carryStudioSaveDraft(record, result);
              const url = new URL(window.location.href);
              url.searchParams.delete("assetId"); url.searchParams.delete("mode");
              url.searchParams.delete("documentRevisionId"); setDocumentRevisionEntry(undefined);
              setDirty(false);
              if (record.value.operation.kind === "style") {
                const style = result as StudioStyleView;
                setTab("styles"); setDocumentEntry(undefined);
                setStyleEntry({ revisionId: style.currentRevision.id, assetId: undefined });
                setPreferredRevision(style.currentRevision.id);
                url.searchParams.set("tab", "styles"); url.searchParams.delete("documentId"); url.searchParams.set("styleRevisionId", style.currentRevision.id);
              } else {
                const document = result as StudioDocumentView;
                const target = document.type === "TECH_PACK" ? "tech" : "presentation";
                const revisionId = "styleRevisionId" in document.currentRevision.payload && typeof document.currentRevision.payload.styleRevisionId === "string" ? document.currentRevision.payload.styleRevisionId : undefined;
                setTab(target); setPresentationMode("sets"); setDocumentEntry(document.id); setPreferredRevision(revisionId);
                url.searchParams.set("tab", target); url.searchParams.set("documentId", document.id);
                if (revisionId) url.searchParams.set("styleRevisionId", revisionId); else url.searchParams.delete("styleRevisionId");
              }
              setData(current => current ? mergeSavedDeliveryDocuments({ ...current, styles: mergeSavedStyles(current.styles, savedStyles.current) }, savedDocuments.current) : current);
              replaceLocation(url); setPanelVersion(current => current + 1);
              if (!data) await reload();
            }} /> : null}
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
                      initialAssetId={styleEntry.assetId}
                      initialStyleRevisionId={styleEntry.revisionId}
                      onStyleSaved={style => {
                        savedStyles.current = mergeSavedStyles(savedStyles.current, [style]);
                        setData(current => current ? { ...current, styles: mergeSavedStyles(current.styles, [style]) } : current);
                      }}
                      onSelectionChange={(revisionId, assetId) => {
                        setStyleEntry({ revisionId, assetId });
                        setPreferredRevision(revisionId);
                        const url = new URL(window.location.href);
                        if (revisionId) url.searchParams.set("styleRevisionId", revisionId);
                        else url.searchParams.delete("styleRevisionId");
                        if (assetId) url.searchParams.set("assetId", assetId);
                        else url.searchParams.delete("assetId");
                        replaceLocation(url);
                      }}
                      onWardrobe={(revisionId, assetId) => {
                        void (async () => {
                          if (!(await guard.confirmLeave())) return;
                          setDirty(false);
                          setPreferredRevision(revisionId);
                          setWardrobeAssetId(assetId);
                          setPresentationMode("wardrobe");
                          setTab("presentation");
                          const url = new URL(window.location.href);
                          url.searchParams.set("tab", "presentation");
                          url.searchParams.set("mode", "wardrobe");
                          url.searchParams.set("styleRevisionId", revisionId);
                          url.searchParams.set("assetId", assetId);
                          replaceLocation(url);
                          if (session) rememberCreativeVisit(session.user.id, projectId, url.pathname + url.search);
                        })();
                      }}
                      onPresentation={(revisionId) => {
                        void (async () => {
                          if (!(await guard.confirmLeave())) return;
                          setDirty(false);
                          setPreferredRevision(revisionId);
                          setPresentationMode("sets");
                          setTab("presentation");
                          const url = new URL(window.location.href);
                          url.searchParams.set("tab", "presentation");
                          url.searchParams.delete("mode");
                          url.searchParams.set("styleRevisionId", revisionId);
                          url.searchParams.delete("assetId");
                          replaceLocation(url);
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
                          replaceLocation(url);
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
                          replaceLocation(url);
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
                            replaceLocation(url);
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
                    <div data-workspace-heading className={styles.presentationModes}><SegmentedControl
                      label="商品展示模式"
                      value={presentationMode}
                      options={[{ value: "sets", label: "展示包" }, { value: "wardrobe", label: "衣架搭配" }, { value: "realtime", label: "实时试穿" }]}
                      onChange={(next) => {
                        void (async () => {
                          if (!(await guard.confirmLeave())) return;
                          setDirty(false);
                          setPresentationMode(next);
                          const url = new URL(window.location.href);
                          if (next !== "sets") url.searchParams.set("mode", next);
                          else url.searchParams.delete("mode");
                          replaceLocation(url);
                          if (session) rememberCreativeVisit(session.user.id, projectId, url.pathname + url.search);
                        })();
                      }}
                    /></div>
                    {presentationMode === "realtime" ? <RealtimeTryOnPanel
                      key={`${projectId}:${session?.user.id ?? "anonymous"}`}
                      projectId={projectId}
                      assets={data.assets}
                      initialAssetId={wardrobeAssetId}
                      canEdit={data.capabilities.edit}
                      onSaved={async () => { await reload(); }}
                      onDirty={setDirty}
                    /> : presentationMode === "wardrobe" ? <WardrobeWorkspace
                      key={`${projectId}:${session?.user.id ?? "anonymous"}:${wardrobeAssetId ?? "rack"}`}
                      projectId={projectId}
                      assets={data.assets}
                      styles={data.styles}
                      initialAssetId={wardrobeAssetId}
                      initialStyleRevisionId={preferredRevision}
                      canEdit={data.capabilities.edit}
                      onSaved={async () => { await reload(); }}
                      onDirty={setDirty}
                    /> : <PresentationSets
                      key={preferredRevision ?? "presentation"}
                      {...props}
                      data={data}
                      initialStyleRevisionId={preferredRevision}
                      initialDocumentId={documentEntry}
                      initialDocumentRevisionId={documentRevisionEntry}
                      onOpenStyles={() => void changeTab("styles")}
                      onOpenStyle={revisionId => void openStyleRevision(revisionId)}
                      onGenerate={() => {
                        setExperimentMode("presentation");
                        void changeTab("experiments");
                      }}
                    />}
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
                      initialDocumentId={documentEntry}
                      initialDocumentRevisionId={documentRevisionEntry}
                      onOpenStyle={revisionId => void openStyleRevision(revisionId)}
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
    </></StudioHeaderContext>
  );
}
