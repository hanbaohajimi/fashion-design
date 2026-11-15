"use client";
import { usePersistentDraft } from "../../../components/drafts/use-persistent-draft";

import { Select } from "../../../components/ui";
import { readSwatchColors, type CanvasCommand } from "@fashion/shared";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button, Tabs, TabPanel } from "../../../components/ui";
import { EmbeddedEditor } from "./EmbeddedEditor";
import { useWorkspaceDraft } from "./workspace-drafts";
import controls from "../../../components/ui.module.css";

import { ExportModal } from "../generation/ExportModal";
import {
  signImageUpload,
  putOriginal,
  completeUpload,
  waitForThumbnail,
} from "../file-upload-api";
import { useCanvasCommand } from "./use-canvas-command";
import { isRejectedCanvasCommand } from "./canvas-api";
import {
  MaskCanvas,
  isMaskCanvasDraft,
  type MaskCanvasDraft,
  type MaskCanvasHandle,
  type MaskCanvasState,
} from "../generation/MaskCanvas";
import { VersionTimeline } from "../generation/VersionTimeline";
import type { GenerationPaletteColor } from "../generation/generation-types";
import { useAssetRestore, type AssetRestoreResult } from "./use-asset-restore";
import generationStyles from "../generation/generation.module.css";
import {
  fetchWorkflow,
  type WorkflowGraph,
  type WorkflowNode,
} from "./workflow-api";
import styles from "./workflow-asset-workspace.module.css";

export interface WorkflowAssetWorkspaceProps {
  readonly initialTab?: "inpaint" | "variation" | "history" | "erase";
  readonly embedded?: boolean;
  readonly projectId: string;
  readonly assetId: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onGraphRefresh: () => void;
  readonly onEnsureConversation?: () => Promise<string>;
  readonly onRestoredAsset?: (result: AssetRestoreResult) => void;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly readOnly?: boolean;
}

interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}
type PendingEditPatch = Extract<CanvasCommand, { type: "run_tool" }>;
type Tab = "preview" | "inpaint" | "variation" | "history";

const MAX_MASK_DIMENSION = 2048;

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function generationDimension(value: number): number {
  const safe = Math.min(2048, Math.max(256, value));
  return Math.max(256, Math.round(safe / 8) * 8);
}

function sourceFor(
  graph: WorkflowGraph | null,
  assetId: string,
): WorkflowNode | null {
  return (
    graph?.nodes.find(
      (node) => node.type === "candidate" && node.payload.assetId === assetId,
    ) ?? null
  );
}

function graphPalettes(
  graph: WorkflowGraph | null,
): Array<{ id: string; title: string; colors: GenerationPaletteColor[] }> {
  return (graph?.nodes ?? []).flatMap((node) => {
    if (node.type !== "swatch") return [];
    const colors = readSwatchColors(node.payload, node.title);
    return colors.length ? [{ id: node.id, title: node.title, colors }] : [];
  });
}

export function LegacyAssetTools(props: WorkflowAssetWorkspaceProps) {
  if (!props.open) return null;
  return <AssetWorkspaceContent key={props.assetId} {...props} />;
}

function AssetWorkspaceContent({
  projectId,
  assetId,
  open,
  onClose,
  onGraphRefresh,
  onEnsureConversation,
  onRestoredAsset,
  onBusyChange,
  embedded,
  initialTab,
  readOnly = false,
}: WorkflowAssetWorkspaceProps) {
  const [storedTab, setTab] = useState<Tab>("preview");
  const tab = initialTab === "erase" ? "inpaint" : (initialTab ?? storedTab);
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const tabsId = useId();
  const exportTrigger = useRef<HTMLButtonElement>(null);
  const [actualSize, setActualSize] = useState(false);
  const [maskState, setMaskState] = useState<MaskCanvasState>({
    coverage: 0,
    strokeCount: 0,
  });
  const [maskSeed, setMaskSeed] = useState<MaskCanvasDraft | null>(null);
  const [maskEpoch, setMaskEpoch] = useState(0);
  const [maskRecoveryError, setMaskRecoveryError] = useState<string | null>(
    null,
  );
  const [brushRatio, setBrushRatio] = useState(0.06);
  const [prompts, setPrompts] = useState({ inpaint: "", variation: "" });
  const editMode = tab === "variation" ? "variation" : "inpaint";
  const prompt =
    initialTab === "erase"
      ? "移除蒙版内的对象，自然补全背景，保留未涂抹区域的服装、纹理与光线。"
      : prompts[editMode];
  const setPrompt = (value: string) =>
    setPrompts((previous) => ({ ...previous, [editMode]: value }));
  const [preserve, setPreserve] = useState("");
  const [paletteId, setPaletteId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submissionStage, setSubmissionStage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [preparingPatch, setPendingPatch] = useState(false);
  const versionRestore = useAssetRestore(projectId, assetId);
  const pendingRestore = versionRestore.pending;
  useEffect(() => {
    onBusyChange?.(submitting || versionRestore.busy);
  }, [onBusyChange, submitting, versionRestore.busy]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  usePersistentDraft({
    value: { prompts, preserve, paletteId, brushRatio },
    baseline: JSON.stringify({
      prompts: { inpaint: "", variation: "" },
      preserve: "",
      paletteId: "",
      brushRatio: 0.06,
    }),
    objectKey: `image-tools:${assetId}`,
    restore: (draft) => {
      setPrompts(draft.prompts);
      setPreserve(draft.preserve);
      setPaletteId(draft.paletteId);
      setBrushRatio(draft.brushRatio);
    },
  });
  usePersistentDraft<MaskCanvasDraft | null>({
    value: maskState.draft?.strokes.length ? maskState.draft : null,
    baseline: "null",
    objectKey: `image-mask:${assetId}`,
    restore: (draft) => {
      if (draft !== null && !isMaskCanvasDraft(draft)) {
        setMaskRecoveryError(
          "保存的选区暂时无法读取，请保留本机草稿并重新选择区域。",
        );
        return;
      }
      setMaskRecoveryError(null);
      setMaskSeed(draft);
      setMaskEpoch((value) => value + 1);
    },
  });
  const mask = useRef<MaskCanvasHandle>(null);
  const submissionLock = useRef(false);
  const pendingEditPatch = useRef<PendingEditPatch | null>(null);
  const durableCommand = useCanvasCommand(
    projectId,
    `masked-image-command:${assetId}`,
  );
  const pendingPatch = preparingPatch || durableCommand.pending !== null;
  useEffect(() => {
    if (durableCommand.pending?.type === "run_tool")
      pendingEditPatch.current = durableCommand.pending;
  }, [durableCommand.pending]);
  const previewUrl = `/api/design-assets/${encodeURIComponent(assetId)}/content`;
  const source = sourceFor(graph, assetId);
  const palettes = useMemo(() => graphPalettes(graph), [graph]);
  const selectedPalette = palettes.find((entry) => entry.id === paletteId);
  const changeTab = (next: Tab) => {
    setTab(next);
  };
  const locked = submitting || versionRestore.busy || pendingPatch;
  useWorkspaceDraft(
    "asset-restore",
    pendingRestore,
    Boolean(pendingRestore),
    versionRestore.busy,
  );
  useWorkspaceDraft(
    "inpaint",
    {
      prompt: prompts.inpaint,
      paletteId,
      brushRatio,
      mask: maskState.draft,
      pendingPatch,
    },
    Boolean(
      prompts.inpaint || paletteId || maskState.strokeCount || pendingPatch,
    ),
    locked,
  );
  useWorkspaceDraft(
    "variation",
    { prompt: prompts.variation, preserve },
    Boolean(prompts.variation || preserve),
    locked,
  );

  const reloadGraph = useCallback(async () => {
    try {
      const result = await fetchWorkflow(projectId);
      setGraph(result);
      setGraphError(null);
      return result;
    } catch (error) {
      setGraphError(message(error, "工作流读取失败"));
      throw error;
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void fetchWorkflow(projectId).then(
      (result) => {
        if (active) {
          setGraph(result);
          setGraphError(null);
        }
      },
      (error: unknown) => {
        if (active) setGraphError(message(error, "工作流读取失败"));
      },
    );
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      if (!image.naturalWidth || !image.naturalHeight) {
        setImageError("无法读取原图尺寸");
      } else if (
        image.naturalWidth > MAX_MASK_DIMENSION ||
        image.naturalHeight > MAX_MASK_DIMENSION
      ) {
        setImageError(
          `原图尺寸超过局部重绘上限 ${MAX_MASK_DIMENSION}×${MAX_MASK_DIMENSION}`,
        );
        setDimensions({
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      } else {
        setDimensions({
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
        setImageError(null);
      }
    };
    image.onerror = () => {
      if (active) setImageError("原图加载失败，请重试");
    };
    image.src = previewUrl;
    return () => {
      active = false;
      image.onload = null;
      image.onerror = null;
    };
  }, [assetId, imageAttempt, open, previewUrl, projectId]);

  const restoreVersion = async (targetAssetId?: string) => {
    if (readOnly) return;
    const result = await versionRestore.restore(targetAssetId);
    setGraph(result.graph);
    if (onRestoredAsset) onRestoredAsset(result);
    else {
      onGraphRefresh();
      onClose();
    }
  };

  const saveAndExecuteEdit = async () => {
    const draft = pendingEditPatch.current;
    if (!draft) throw new Error("修改分支尚未准备好");
    setSubmissionStage("正在建立可追溯的修改分支…");
    const conversationId =
      draft.conversationId ?? (await onEnsureConversation?.());
    const result = await durableCommand
      .execute({ ...draft, ...(conversationId ? { conversationId } : {}) })
      .catch((error: unknown) => {
        if (isRejectedCanvasCommand(error)) {
          pendingEditPatch.current = null;
          setPendingPatch(false);
        }
        throw error;
      });
    setGraph(result.graph);
    pendingEditPatch.current = null;
    setPendingPatch(false);
    onGraphRefresh();
    setSubmitting(false);
    onClose();
  };

  const submitVariation = async () => {
    if (readOnly) return;
    if (submissionLock.current) return;
    submissionLock.current = true;
    try {
      const recovered = await durableCommand.getPending();
      if (recovered?.type === "run_tool") pendingEditPatch.current = recovered;
      if (!pendingEditPatch.current && (!dimensions || imageError)) {
        setActionError(imageError ?? "原图尚未就绪");
        return;
      }
      if (!pendingEditPatch.current && prompt.trim().length < 3) {
        setActionError("请描述变体需要如何修改");
        return;
      }
      if (!pendingEditPatch.current && preserve.trim().length < 3) {
        setActionError("请明确需要保留的设计特征");
        return;
      }
      setSubmitting(true);
      setActionError(null);
      try {
        if (!pendingEditPatch.current) {
          if (!dimensions) throw new Error("原图尚未就绪");
          const latest = await reloadGraph();
          const current = sourceFor(latest, assetId);
          if (!current) throw new Error("找不到当前图片节点，无法建立变体分支");
          pendingEditPatch.current = {
            type: "run_tool",
            toolKey: "edit_design",
            title: `变体 ${prompt.trim().slice(0, 42)}`,
            mutationId: crypto.randomUUID(),
            parameters: {
              taskType: "i2i",
              prompt: `${prompt.trim()}\n保持不变：${preserve.trim()}`,
              width: generationDimension(dimensions.width),
              height: generationDimension(dimensions.height),
            },
            inputs: [{ nodeId: current.id, port: "source" }],
          };
          setPendingPatch(true);
        }
        await saveAndExecuteEdit();
      } catch (error) {
        setActionError(message(error, "变体未提交，请重试"));
        setSubmitting(false);
        setSubmissionStage(null);
      }
    } catch (error) {
      setActionError(message(error, "保存的操作暂时无法读取，请重试"));
    } finally {
      submissionLock.current = false;
    }
  };

  const submitInpaint = async () => {
    if (readOnly) return;
    if (submissionLock.current) return;
    submissionLock.current = true;
    try {
      const recovered = await durableCommand.getPending();
      if (recovered?.type === "run_tool") pendingEditPatch.current = recovered;
      if (
        !pendingEditPatch.current &&
        (!dimensions ||
          dimensions.width > MAX_MASK_DIMENSION ||
          dimensions.height > MAX_MASK_DIMENSION)
      ) {
        setActionError(imageError ?? "原图尚未就绪");
        return;
      }
      if (
        !pendingEditPatch.current &&
        (!mask.current || maskState.strokeCount === 0)
      ) {
        setActionError("请先涂抹需要修改的区域");
        return;
      }
      if (!pendingEditPatch.current && prompt.trim().length < 3) {
        setActionError("请描述局部区域需要如何修改");
        return;
      }
      setSubmitting(true);
      setActionError(null);
      try {
        if (!pendingEditPatch.current) {
          if (!mask.current || !dimensions)
            throw new Error("原图与掩码尚未就绪");
          setSubmissionStage("正在准备选区…");
          const blob = await mask.current.exportPng();
          setSubmissionStage("正在上传选区…");
          const maskFile = new File([blob], "局部修改蒙版.png", {
            type: "image/png",
          });
          const signed = await signImageUpload(projectId, maskFile);
          const processing = signed.upload
            ? await putOriginal(signed.upload, maskFile)
                .catch((cause: unknown) => { throw new Error("选区上传失败，涂抹范围和说明已保留，请重试。", { cause }); })
                .then(() => completeUpload(signed.file.id))
            : signed.file;
          const maskReference = await waitForThumbnail(
            signed.file.id,
            processing,
          );
          const latest = await reloadGraph();
          const current = sourceFor(latest, assetId);
          if (!current) throw new Error("找不到当前图片节点，无法建立修改分支");
          pendingEditPatch.current = {
            type: "run_tool",
            toolKey: "edit_design",
            title: `局部修改 ${prompt.trim().slice(0, 42)}`,
            mutationId: crypto.randomUUID(),
            parameters: {
              taskType: "inpaint",
              ...(initialTab === "erase" ? { intent: "erase" } : {}),
              mask: { fileAssetId: maskReference.id },
              prompt: prompt.trim(),
              width: generationDimension(dimensions.width),
              height: generationDimension(dimensions.height),
              ...(selectedPalette ? { palette: selectedPalette.colors } : {}),
            },
            inputs: [{ nodeId: current.id, port: "source" }],
          };
          setPendingPatch(true);
        }
        await saveAndExecuteEdit();
      } catch (error) {
        setActionError(message(error, "局部修改未提交，请重试"));
        setSubmitting(false);
        setSubmissionStage(null);
      }
    } catch (error) {
      setActionError(message(error, "保存的操作暂时无法读取，请重试"));
    } finally {
      submissionLock.current = false;
    }
  };

  if (!open) return null;
  return (
    <EmbeddedEditor
      embedded={embedded}
      label={exportOpen ? "导出成果" : "图片资产工作台"}
      className={`${styles.assetDialog} ${controls.controlSurface}`}
      onClose={() => {
        if (!submitting && !pendingRestore) onClose();
      }}
    >
      <section hidden={exportOpen}>
        <header className={styles.header}>
          <div>
            <span>设计方案</span>
            <h2>{source?.title ?? "设计图"}</h2>
          </div>
          <button
            aria-label="关闭图片工作台"
            disabled={submitting || Boolean(pendingRestore)}
            onClick={onClose}
            type="button"
          >
            关闭
          </button>
        </header>
        <Tabs<Tab>
          id={tabsId}
          label="图片资产操作"
          value={tab}
          onChange={changeTab}
          options={[
            { value: "preview", label: "大图预览" },
            { value: "inpaint", label: "局部重绘" },
            { value: "variation", label: "生成变体" },
            { value: "history", label: "版本历史" },
          ].filter(item => !readOnly || item.value === "history").map((item) => ({
            ...item,
            value: item.value as Tab,
            disabled: submitting || pendingPatch,
          }))}
        />
        {graphError ? (
          <p className={styles.notice} role="alert">
            {graphError}{" "}
            <button
              onClick={() => void reloadGraph().catch(() => undefined)}
              type="button"
            >
              重试
            </button>
          </p>
        ) : null}
        <TabPanel tabsId={tabsId} value="preview" activeValue={tab}>
          <div className={styles.previewLayout}>
            <figure className={styles.imageStage} data-actual-size={actualSize}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt={source?.title ?? "设计图原图"} src={previewUrl} />
            </figure>
            <aside className={styles.previewAside}>
              <span>原图与设计分支</span>
              <div className={styles.previewTools}>
                <Button
                  size="small"
                  onClick={() => setActualSize(false)}
                  aria-pressed={!actualSize}
                >
                  适合窗口
                </Button>
                <Button
                  size="small"
                  onClick={() => setActualSize(true)}
                  aria-pressed={actualSize}
                >
                  原始比例
                </Button>
              </div>
              <h3>沿这张图片继续设计</h3>
              <p>
                版本恢复和局部修改会创建新的分支；当前图片与它的来源会保留在画布中。
              </p>
              {dimensions ? (
                <dl>
                  <div>
                    <dt>原图尺寸</dt>
                    <dd>
                      {dimensions.width} × {dimensions.height}
                    </dd>
                  </div>
                </dl>
              ) : null}
              {imageError ? (
                <p className={styles.error} role="alert">
                  {imageError}
                </p>
              ) : null}
              <div className={styles.actionStack}>
                <button
                  className={styles.primary}
                  onClick={() => changeTab("inpaint")}
                  type="button"
                >
                  创建局部修改分支
                </button>
                <button onClick={() => changeTab("variation")} type="button">
                  创建变体分支
                </button>
                <button onClick={() => changeTab("history")} type="button">
                  查看与恢复版本
                </button>
                <button
                  ref={exportTrigger}
                  onClick={() => setExportOpen(true)}
                  type="button"
                >
                  单图高清导出
                </button>
              </div>
            </aside>
          </div>
        </TabPanel>
        <TabPanel keepMounted tabsId={tabsId} value="inpaint" activeValue={tab}>
          <div
            aria-busy={submitting}
            className={generationStyles.inpaintLayout}
          >
              <figure className={`${generationStyles.maskStage} ${styles.editMaskStage}`}>
              <div className={generationStyles.maskMedia} data-busy={locked}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="局部重绘原图" src={previewUrl} />
                {dimensions &&
                dimensions.width <= MAX_MASK_DIMENSION &&
                dimensions.height <= MAX_MASK_DIMENSION ? (
                  <MaskCanvas
                    key={maskEpoch}
                    brushRatio={brushRatio}
                    disabled={locked}
                    height={dimensions.height}
                    initialDraft={maskSeed ?? undefined}
                    onChange={setMaskState}
                    ref={mask}
                    width={dimensions.width}
                  />
                ) : null}
              </div>
              <figcaption>
                {maskState.strokeCount
                  ? `已选约 ${Math.max(1, Math.round(maskState.coverage * 100))}% 的画面`
                  : "涂抹需要修改的区域"}
              </figcaption>
            </figure>
            <aside className={generationStyles.inpaintControls}>
              <div>
                <strong>选择并描述修改</strong>
              </div>
              <label>
                <span>修改说明</span>
                <textarea
                  aria-label="局部重绘说明"
                  disabled={submitting || pendingPatch}
                  maxLength={1000}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    setActionError(null);
                  }}
                  placeholder="例如：将领口改为窄驳领，保持面料与光线"
                  value={prompt}
                />
              </label>
              {palettes.length ? (
                <label>
                  <span>参考色卡 可选</span>
                  <Select
                    searchable
                    disabled={submitting || pendingPatch}
                    onChange={(event) => setPaletteId(event.target.value)}
                    value={paletteId}
                  >
                    <option value="">保持原图配色</option>
                    {palettes.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : null}
              <label>
                <span>画笔尺寸 {Math.round(brushRatio * 100)}%</span>
                <input
                  aria-label="掩码画笔尺寸"
                  disabled={submitting || pendingPatch}
                  max={0.16}
                  min={0.02}
                  onChange={(event) =>
                    setBrushRatio(Number(event.target.value))
                  }
                  step={0.01}
                  type="range"
                  value={brushRatio}
                />
              </label>
              <div className={generationStyles.maskActions}>
                <button
                  disabled={submitting || pendingPatch || !dimensions}
                  onClick={() => mask.current?.addCenterRegion()}
                  type="button"
                >
                  标记中央区域
                </button>
                <button
                  disabled={
                    submitting || pendingPatch || !maskState.strokeCount
                  }
                  onClick={() => mask.current?.undo()}
                  type="button"
                >
                  撤销一笔
                </button>
                <button
                  disabled={
                    submitting || pendingPatch || !maskState.strokeCount
                  }
                  onClick={() => mask.current?.clear()}
                  type="button"
                >
                  清空
                </button>
              </div>
              {submissionStage ? <p role="status">{submissionStage}</p> : null}
              {maskRecoveryError ? (
                <p className={styles.error} role="alert">
                  {maskRecoveryError}
                </p>
              ) : null}
              {maskSeed &&
              dimensions &&
              (maskSeed.width !== dimensions.width ||
                maskSeed.height !== dimensions.height) ? (
                <p className={styles.error} role="alert">
                  原图尺寸与保存的选区不同，请重新选择区域。本机选区草稿仍保留。
                </p>
              ) : null}
              {pendingPatch ? (
                <p role="status">
                  上次提交尚未确认，选区和说明已锁定。重试会继续同一任务。
                </p>
              ) : null}
              {imageError ? (
                <p className={styles.error} role="alert">
                  {imageError}{" "}
                  <button
                    disabled={submitting}
                    onClick={() => setImageAttempt((value) => value + 1)}
                    type="button"
                  >
                    重新读取原图
                  </button>
                </p>
              ) : null}
              {actionError ? (
                <p className={styles.error} role="alert">
                  {actionError}
                </p>
              ) : null}
              <button
                className={generationStyles.inpaintSubmit}
                disabled={
                  submitting ||
                  (!pendingPatch && (!dimensions || Boolean(imageError)))
                }
                onClick={() => void submitInpaint()}
                type="button"
              >
                {pendingPatch
                  ? "重试局部重绘"
                  : submitting
                    ? "正在处理…"
                    : "提交局部重绘"}
              </button>
            </aside>
          </div>
        </TabPanel>
        <TabPanel tabsId={tabsId} value="variation" activeValue={tab}>
          <div className={styles.previewLayout}>
            <figure className={styles.imageStage}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="变体来源图片" src={previewUrl} />
            </figure>
            <aside className={generationStyles.inpaintControls}>
              <div>
                <span>变体分支</span>
                <strong>从当前图片生成变体</strong>
              </div>
              <p>
                原图片会保留。确认后，新变体将沿当前图片的来源建立独立分支。
              </p>
              <label>
                <span>修改方向</span>
                <textarea
                  aria-label="变体修改说明"
                  disabled={submitting || pendingPatch}
                  maxLength={1000}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    setActionError(null);
                  }}
                  placeholder="例如：探索两种更简洁的领型"
                  value={prompt}
                />
              </label>
              <label>
                <span>需要保留的特征</span>
                <textarea
                  aria-label="变体保留特征"
                  disabled={submitting || pendingPatch}
                  maxLength={1000}
                  onChange={(event) => {
                    setPreserve(event.target.value);
                    setActionError(null);
                  }}
                  placeholder="例如：保持宽松廓形、原有面料与配色"
                  value={preserve}
                />
              </label>
              {submissionStage ? <p role="status">{submissionStage}</p> : null}
              {pendingPatch ? (
                <p role="status">上次提交尚未确认，重试会继续同一任务。</p>
              ) : null}
              {imageError ? (
                <p className={styles.error} role="alert">
                  {imageError}{" "}
                  <button
                    disabled={submitting}
                    onClick={() => setImageAttempt((value) => value + 1)}
                    type="button"
                  >
                    重新读取原图
                  </button>
                </p>
              ) : null}
              {actionError ? (
                <p className={styles.error} role="alert">
                  {actionError}
                </p>
              ) : null}
              <button
                className={generationStyles.inpaintSubmit}
                disabled={
                  submitting ||
                  (!pendingPatch && (!dimensions || Boolean(imageError)))
                }
                onClick={() => void submitVariation()}
                type="button"
              >
                {pendingPatch
                  ? "重试生成变体"
                  : submitting
                    ? "正在处理…"
                    : "确认生成变体"}
              </button>
            </aside>
          </div>
        </TabPanel>
        <TabPanel tabsId={tabsId} value="history" activeValue={tab}>
          <div className={styles.historyBody}>
            {versionRestore.error ? (
              <p className={styles.notice} role="alert">
                {versionRestore.error}
                {!versionRestore.ready ? (
                  <button
                    onClick={() => void versionRestore.reload()}
                    type="button"
                  >
                    重新读取恢复记录
                  </button>
                ) : null}
              </p>
            ) : null}
            {pendingRestore ? (
              <p className={styles.notice} role="status">
                上一次版本恢复尚未确认，继续会沿用原操作。
                <button
                  disabled={readOnly || versionRestore.busy}
                  onClick={() => void restoreVersion().catch(() => undefined)}
                  type="button"
                >
                  {versionRestore.busy ? "正在恢复…" : "继续恢复版本"}
                </button>
              </p>
            ) : null}
            {!pendingRestore ? (
              <VersionTimeline
                assetId={assetId}
                readOnly={readOnly}
                disabled={!versionRestore.ready || versionRestore.busy}
                onRestoreRequest={(asset) => restoreVersion(asset.id)}
              />
            ) : null}
          </div>
        </TabPanel>
      </section>
      {exportOpen ? (
        <ExportModal
          embedded
          onBack={() => {
            setExportOpen(false);
            requestAnimationFrame(() => exportTrigger.current?.focus());
          }}
          onClose={onClose}
          source={{ assetId, previewUrl, type: "asset" }}
        />
      ) : null}
    </EmbeddedEditor>
  );
}
