"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  StudioDocumentView,
  StudioStyleView,
  StudioSummary,
} from "@fashion/shared";
import { Button, Dialog, Notice } from "../../../components/ui";
import { DraftScopeProvider } from "../../../components/drafts/use-persistent-draft";
import { flushWorkspaceDrafts } from "../../../components/drafts/draft-repository";
import { fetchStudio } from "../../studio/studio-api";
import { TechPackEditor } from "../../studio/TechPackEditor";
import { SampleRounds } from "../../studio/SampleRounds";
import { CollaborationPanel } from "../../studio/CollaborationPanel";
import { CollectionWorkbench } from "../../studio/CollectionWorkbench";
import { BrandLibrary } from "../../studio/BrandLibrary";
import { StyleLibrary } from "../../studio/StyleLibrary";
import { WardrobeWorkspace } from "../../studio/wardrobe/WardrobeWorkspace";
import { RealtimeTryOnPanel } from "../../studio/realtime-tryon/RealtimeTryOnPanel";
import { RunwayWorkspace } from "../../runway/RunwayWorkspace";
import { StudioHeaderContext } from "../../studio/StudioPageHeader";
import { StudioAssetNames } from "../../studio/studio-object-context";
import { mergeSavedRecords } from "../../studio/studio-records";
import { StudioSaveRecovery } from "../../studio/StudioSaveRecovery";
import {
  carryStudioSaveDraft,
  hasActiveStudioSaveForm,
} from "../../studio/studio-save-recovery";
import type {
  CanvasProjectPanel,
  CanvasProjectEntry,
} from "./canvas-project-functions";
import styles from "./canvas-project-workspace.module.css";

const titles: Record<CanvasProjectPanel, string> = {
  tech: "技术包",
  samples: "样衣反馈",
  team: "团队评审",
  planning: "系列工作台",
  brand: "品牌资料",
  realtime: "实时试穿",
  runway: "服装秀",
  wardrobe: "衣橱",
  styles: "款式档案",
};

/** Opened forms stay mounted for this account/project, alongside the same canvas. */
export default function CanvasProjectWorkspace({
  accountId,
  projectId,
  projectName,
  activeTab,
  visitedTabs,
  onClose,
  onOpenPanel,
  onEditAsset,
  onRefreshCanvas,
}: {
  accountId: string;
  projectId: string;
  projectName: string;
  activeTab: CanvasProjectPanel | null;
  visitedTabs: readonly CanvasProjectPanel[];
  onClose: () => void;
  onOpenPanel: (panel: CanvasProjectPanel) => void;
  onEditAsset: (assetId: string, styleRevisionId: string) => void;
  onRefreshCanvas: () => Promise<void>;
}) {
  const [entries, setEntries] = useState<
    Partial<Record<CanvasProjectPanel, CanvasProjectEntry>>
  >({});
  const navigate = async (
    panel: CanvasProjectPanel,
    entry?: CanvasProjectEntry,
  ) => {
    await flushWorkspaceDrafts();
    if (entry) setEntries((current) => ({ ...current, [panel]: entry }));
    onOpenPanel(panel);
  };
  return visitedTabs.map((tab) => (
    <ProjectPanel
      key={`${tab}:${entries[tab]?.assetId ?? ""}:${entries[tab]?.styleRevisionId ?? ""}`}
      accountId={accountId}
      projectId={projectId}
      projectName={projectName}
      tab={tab}
      open={activeTab === tab}
      onClose={onClose}
      entry={entries[tab]}
      onNavigate={navigate}
      onEditAsset={onEditAsset}
      onRefreshCanvas={onRefreshCanvas}
    />
  ));
}

function ProjectPanel({
  accountId,
  projectId,
  projectName,
  tab,
  open,
  onClose,
  entry,
  onNavigate,
  onEditAsset,
  onRefreshCanvas,
}: {
  accountId: string;
  projectId: string;
  projectName: string;
  tab: CanvasProjectPanel;
  open: boolean;
  onClose: () => void;
  entry: CanvasProjectEntry | undefined;
  onNavigate: (
    panel: CanvasProjectPanel,
    entry?: CanvasProjectEntry,
  ) => Promise<void>;
  onEditAsset: (assetId: string, styleRevisionId: string) => void;
  onRefreshCanvas: () => Promise<void>;
}) {
  const [data, setData] = useState<StudioSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [changingRecord, setChangingRecord] = useState(false);
  const [recoveredRecord, setRecoveredRecord] = useState<{
    id: string;
    revisionId?: string;
    nonce: number;
  } | null>(null);
  const dirty = useRef(false);
  const active = useRef(false);
  const closeFlight = useRef(false);
  const request = useRef<AbortController | null>(null);
  const savedDocuments = useRef<StudioDocumentView[]>([]);
  const savedStyles = useRef<StudioStyleView[]>([]);
  const recordChange = useRef<((allowed: boolean) => void) | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const scroll = useRef(0);
  const scope = useMemo(
    () => ({
      accountId,
      projectId,
      editor: `studio:${tab === "wardrobe" || tab === "realtime" ? "presentation" : tab}`,
    }),
    [accountId, projectId, tab],
  );
  const reload = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const next = await fetchStudio(projectId, controller.signal);
      if (!active.current || controller.signal.aborted) return false;
      const saved = savedDocuments.current;
      setData({
        ...next,
        styles: mergeSavedRecords(next.styles, savedStyles.current),
        techPacks: mergeSavedRecords(
          next.techPacks,
          saved.filter((item) => item.type === "TECH_PACK"),
        ),
        samples: mergeSavedRecords(
          next.samples,
          saved.filter((item) => item.type === "SAMPLE_ROUND"),
        ),
      });
      setError(null);
      return true;
    } catch (cause) {
      if (active.current && !controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "项目资料读取失败，请重试。",
        );
      return false;
    }
  }, [projectId]);
  useEffect(() => {
    active.current = true;
    void reload();
    return () => {
      active.current = false;
      request.current?.abort();
      recordChange.current?.(false);
    };
  }, [reload]);
  useLayoutEffect(() => {
    if (!open) return;
    const top = scroll.current;
    const frame = requestAnimationFrame(() => {
      if (body.current) body.current.scrollTop = top;
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => {
    if (!open)
      body.current
        ?.querySelectorAll<HTMLMediaElement>("video,audio")
        .forEach((media) => media.pause());
  }, [open]);
  const close = async () => {
    if (closeFlight.current) return false;
    closeFlight.current = true;
    setClosing(true);
    scroll.current = body.current?.scrollTop ?? 0;
    body.current
      ?.querySelectorAll<HTMLMediaElement>("video,audio")
      .forEach((media) => media.pause());
    try {
      await flushWorkspaceDrafts();
      if (!active.current) return false;
      onClose();
      return true;
    } catch {
      if (active.current)
        setError("草稿暂未写入本机，当前输入已保留。请重试关闭面板。");
      return false;
    } finally {
      closeFlight.current = false;
      if (active.current) setClosing(false);
    }
  };
  const beforeChange = async () => {
    try {
      await flushWorkspaceDrafts();
    } catch {
      if (active.current)
        setError("草稿暂未写入本机，当前输入已保留。请稍后重试切换资料。");
      return false;
    }
    if (!dirty.current) return true;
    if (recordChange.current) return false;
    setChangingRecord(true);
    return new Promise<boolean>((resolve) => {
      recordChange.current = resolve;
    });
  };
  const resolveRecordChange = (allowed: boolean) => {
    recordChange.current?.(allowed);
    recordChange.current = null;
    setChangingRecord(false);
  };
  const onDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  const onDocumentSaved = useCallback((document: StudioDocumentView) => {
    savedDocuments.current = mergeSavedRecords(savedDocuments.current, [
      document,
    ]);
  }, []);
  const onStyleSaved = useCallback((style: StudioStyleView) => {
    savedStyles.current = mergeSavedRecords(savedStyles.current, [style]);
  }, []);
  const navigate = async (
    panel: CanvasProjectPanel,
    nextEntry?: CanvasProjectEntry,
  ) => {
    try {
      await onNavigate(panel, nextEntry);
    } catch {
      if (active.current)
        setError("草稿暂未写入本机，当前输入已保留。请稍后重试打开功能。");
    }
  };
  const props = {
    projectId,
    canEdit: data?.capabilities.edit ?? false,
    onDirty,
    onSaved: reload,
    onDocumentSaved,
    beforeChange,
  };
  return (
    <Dialog
      open={open}
      keepMounted
      label={titles[tab]}
      className={styles.dialog}
      returnFocusSelector='[data-guide="workspace-functions"]'
      onClose={() => void close()}
    >
      <section
        className={styles.workspace}
        data-canvas-project-panel={tab}
        data-studio-motion={open ? "" : undefined}
      >
        <header className={styles.header}>
          <div>
            <h2>{titles[tab]}</h2>
            <span title={projectName}>{projectName}</span>
          </div>
          <Button
            disabled={closing}
            loading={closing}
            onClick={() => void close()}
          >
            返回画布
          </Button>
        </header>
        <div ref={body} className={styles.body} data-canvas-project-scroll>
          {tab === "tech" || tab === "styles" ? (
            <StudioSaveRecovery
              accountId={accountId}
              projectId={projectId}
              editor={scope.editor}
              onConfirmed={({ result }) => {
                if ("type" in result && result.type === "TECH_PACK")
                  onDocumentSaved(result);
                else if (!("type" in result)) onStyleSaved(result);
              }}
              onOpen={async ({ record, result }) => {
                if (
                  tab === "tech" &&
                  (!("type" in result) || result.type !== "TECH_PACK")
                )
                  return;
                if (tab === "styles" && "type" in result) return;
                if (!hasActiveStudioSaveForm(record) && !(await beforeChange()))
                  return;
                await carryStudioSaveDraft(record, result);
                if (!active.current) return;
                if ("type" in result) {
                  onDocumentSaved(result);
                  setData((current) =>
                    current
                      ? {
                          ...current,
                          techPacks: mergeSavedRecords(current.techPacks, [
                            result,
                          ]),
                        }
                      : current,
                  );
                } else {
                  onStyleSaved(result);
                  setData((current) =>
                    current
                      ? {
                          ...current,
                          styles: mergeSavedRecords(current.styles, [result]),
                        }
                      : current,
                  );
                }
                setRecoveredRecord((current) => ({
                  id: result.id,
                  ...(!("type" in result)
                    ? { revisionId: result.currentRevision.id }
                    : {}),
                  nonce: (current?.nonce ?? 0) + 1,
                }));
              }}
            />
          ) : null}
          {error ? (
            <Notice tone="error">
              {error}
              <Button onClick={() => void reload()}>重新读取资料</Button>
            </Notice>
          ) : null}
          {!data && !error ? <p role="status">正在读取{titles[tab]}…</p> : null}
          {data ? (
            <DraftScopeProvider scope={scope}>
              <StudioHeaderContext
                value={{
                  actions: null,
                  readOnly: !data.capabilities.edit,
                  embedded: true,
                }}
              >
                <StudioAssetNames data={data}>
                  {tab === "tech" ? (
                    <TechPackEditor
                      key={recoveredRecord?.nonce ?? 0}
                      {...props}
                      data={data}
                      initialDocumentId={recoveredRecord?.id}
                      initialStyleRevisionId={entry?.styleRevisionId}
                    />
                  ) : tab === "samples" ? (
                    <SampleRounds {...props} data={data} />
                  ) : tab === "team" ? (
                    <CollaborationPanel {...props} data={data} />
                  ) : tab === "planning" ? (
                    <CollectionWorkbench {...props} data={data} />
                  ) : tab === "brand" ? (
                    <BrandLibrary
                      {...props}
                      data={data}
                      onAppliedToCanvas={onRefreshCanvas}
                    />
                  ) : tab === "styles" ? (
                    <StyleLibrary
                      key={recoveredRecord?.nonce ?? 0}
                      {...props}
                      data={data}
                      initialAssetId={entry?.assetId}
                      initialStyleRevisionId={
                        recoveredRecord?.revisionId ?? entry?.styleRevisionId
                      }
                      onStyleSaved={onStyleSaved}
                      onEditInCanvas={async (assetId, revisionId) => {
                        if (await close()) onEditAsset(assetId, revisionId);
                      }}
                      onTechPack={(revisionId) =>
                        void navigate("tech", { styleRevisionId: revisionId })
                      }
                      onRunway={(revisionId) =>
                        void navigate("runway", {
                          styleRevisionId: revisionId,
                        })
                      }
                      onWardrobe={(revisionId, assetId) =>
                        void navigate("wardrobe", {
                          styleRevisionId: revisionId,
                          assetId,
                        })
                      }
                    />
                  ) : tab === "wardrobe" ? (
                    <WardrobeWorkspace
                      projectId={projectId}
                      assets={data.assets}
                      styles={data.styles}
                      canEdit={props.canEdit}
                      active={open && !closing}
                      embedded
                      heading={
                        <div>
                          <p>当前项目的单品陈列，点击服装聚焦查看。</p>
                        </div>
                      }
                      initialAssetId={entry?.assetId}
                      initialStyleRevisionId={entry?.styleRevisionId}
                      onDirty={onDirty}
                      onSaved={async () => {
                        await reload();
                      }}
                    />
                  ) : tab === "realtime" ? (
                    <RealtimeTryOnPanel
                      projectId={projectId}
                      assets={data.assets}
                      canEdit={props.canEdit}
                      embedded
                      active={open && !closing}
                      initialAssetId={entry?.assetId}
                      onDirty={onDirty}
                      onSaved={async () => {
                        await reload();
                      }}
                      onOpenStyle={(assetId) =>
                        void navigate("styles", { assetId })
                      }
                      onReturnToCanvas={() => void close()}
                    />
                  ) : (
                    <RunwayWorkspace
                      {...props}
                      data={data}
                      embedded
                      active={open && !closing}
                      initialStyleRevisionId={entry?.styleRevisionId}
                    />
                  )}
                </StudioAssetNames>
              </StudioHeaderContext>
            </DraftScopeProvider>
          ) : null}
        </div>
      </section>
      {changingRecord ? (
        <Dialog label="切换资料" onClose={() => resolveRecordChange(false)}>
          <div className={styles.confirm}>
            <h2>保留草稿并切换资料？</h2>
            <p>当前修改已保留为本机草稿，再次打开这份资料时可以继续编辑。</p>
            <div>
              <Button onClick={() => resolveRecordChange(false)}>
                继续编辑
              </Button>
              <Button
                variant="primary"
                onClick={() => resolveRecordChange(true)}
              >
                保留草稿并切换
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </Dialog>
  );
}
