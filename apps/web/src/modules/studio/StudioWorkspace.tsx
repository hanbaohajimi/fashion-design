"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import type { ExperimentCreateInput, StudioSummary } from "@fashion/shared";
import {
  Badge,
  Button,
  EmptyState,
  Notice,
  Skeleton,
  Tabs,
  TabPanel,
  Select,
  SegmentedControl,
} from "../../components/ui";
import { AppHeader } from "../../components/AppHeader";
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
import styles from "./studio.module.css";

type Tab =
  | "trends"
  | "tasks"
  | "styles"
  | "experiments"
  | "presentation"
  | "patterns"
  | "brand"
  | "planning"
  | "tech"
  | "samples"
  | "team";
const TABS: readonly { value: Tab; label: string }[] = [
  { value: "trends", label: "趋势简报" },
  { value: "tasks", label: "开始任务" },
  { value: "styles", label: "款式档案" },
  { value: "experiments", label: "色料实验" },
  { value: "patterns", label: "印花工作台" },
  { value: "presentation", label: "商品展示" },
  { value: "brand", label: "品牌资料" },
  { value: "planning", label: "系列规划" },
  { value: "tech", label: "技术包" },
  { value: "samples", label: "样衣反馈" },
  { value: "team", label: "团队评审" },
];
const GROUPS = [
  {
    value: "design",
    label: "设计",
    tabs: ["tasks", "styles", "experiments", "patterns", "presentation"],
  },
  {
    value: "delivery",
    label: "开发交付",
    tabs: ["planning", "tech", "samples", "team"],
  },
  { value: "project", label: "项目资料", tabs: ["trends", "brand"] },
] as const;
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
}: {
  readonly projectId: string;
  readonly initialAssetId?: string | undefined;
  readonly initialTab?: string | undefined;
}) {
  const [data, setData] = useState<StudioSummary | null>(null);
  const [name, setName] = useState("设计项目");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(
    initialAssetId
      ? "styles"
      : TABS.some((item) => item.value === initialTab)
        ? (initialTab as Tab)
        : "tasks",
  );
  const [experimentMode, setExperimentMode] =
    useState<ExperimentCreateInput["mode"]>("color");
  const [dirty, setDirty] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [panelVersion, setPanelVersion] = useState(0);
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
      url.searchParams.set("tab", next);
      if (next !== "styles") url.searchParams.delete("assetId");
      window.history.replaceState(window.history.state, "", url);
    }
  };
  const group =
    GROUPS.find((item) => (item.tabs as readonly string[]).includes(tab)) ??
    GROUPS[0];
  const visibleTabs = group.tabs.flatMap((value) => {
    const item = TABS.find((entry) => entry.value === value);
    return item ? [item] : [];
  });
  const props = {
    projectId,
    canEdit: data?.capabilities.edit ?? false,
    onDirty: setDirty,
    onSaved: reload,
    beforeChange: guard.confirmLeave,
  };
  return (
    <>
      <AppHeader current="projects" projectId={projectId} hideProjectReturn />
      <main id="main-content" className={styles.shell}>
        <header className={styles.header}>
          <div>
            <h1>{name}</h1>
            <span className={styles.muted}>款式与交付</span>
          </div>
          <div className={styles.toolbar}>
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
            <Link
              className={styles.link}
              href={"/" + encodeURIComponent(projectId)}
            >
              返回设计画布
            </Link>
          </div>
        </header>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {loading ? (
          <div className={styles.section}>
            <Skeleton className={styles.skeleton} label="正在加载工作室资料" />
            <Skeleton className={styles.skeleton} label="正在加载款式与修订" />
          </div>
        ) : data ? (
          <>
            <div className={styles.workspaceNavigation}>
              <SegmentedControl
                label="工作室功能分组"
                value={group.value}
                options={GROUPS.map(({ value, label }) => ({ value, label }))}
                onChange={(value) => {
                  const next = GROUPS.find((item) => item.value === value);
                  if (next) void changeTab(next.tabs[0]);
                }}
              />
              <div className={styles.desktopTabs}>
                <Tabs
                  id={tabsId}
                  className={styles.tabs}
                  label="设计工作室功能"
                  value={tab}
                  options={visibleTabs}
                  onChange={(next) => void changeTab(next)}
                />
              </div>
              <label className={styles.mobileFunction}>
                当前功能
                <Select
                  aria-label="当前功能"
                  value={tab}
                  onChange={(event) =>
                    void changeTab(event.target.value as Tab)
                  }
                >
                  {visibleTabs.map((item) => (
                    <option value={item.value} key={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
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
                />
              </TabPanel>
              <TabPanel tabsId={tabsId} value="experiments" activeValue={tab}>
                <ExperimentPanel
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
              <TabPanel tabsId={tabsId} value="presentation" activeValue={tab}>
                <PresentationSets
                  {...props}
                  data={data}
                  onGenerate={() => {
                    setExperimentMode("presentation");
                    void changeTab("experiments");
                  }}
                />
              </TabPanel>
              <TabPanel tabsId={tabsId} value="brand" activeValue={tab}>
                <BrandLibrary {...props} data={data} />
              </TabPanel>
              <TabPanel tabsId={tabsId} value="planning" activeValue={tab}>
                <PlanningBoard {...props} data={data} />
              </TabPanel>
              <TabPanel tabsId={tabsId} value="tech" activeValue={tab}>
                <TechPackEditor {...props} data={data} />
              </TabPanel>
              <TabPanel tabsId={tabsId} value="samples" activeValue={tab}>
                <SampleRounds {...props} data={data} />
              </TabPanel>
              <TabPanel tabsId={tabsId} value="team" activeValue={tab}>
                <CollaborationPanel {...props} data={data} />
              </TabPanel>
            </div>
          </>
        ) : (
          <EmptyState
            title="工作室暂时无法打开"
            action={<Button onClick={() => void reload()}>重新加载</Button>}
          >
            检查网络和项目访问权限后重试。
          </EmptyState>
        )}
        {guard.dialog}
      </main>
    </>
  );
}
