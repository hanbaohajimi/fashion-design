"use client";
import { readSwatchColors } from "@fashion/shared";

import { privateFetch as fetch } from "../../auth/private-fetch";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Tabs, TabPanel } from "../../../components/ui";
import { EmbeddedEditor } from "./EmbeddedEditor";
import { useWorkspaceDraft } from "./workspace-drafts";
import controls from "../../../components/ui.module.css";

import { ExportModal } from "../generation/ExportModal";
import { uploadTemporaryMask } from "../generation/generation-api";
import {
  MaskCanvas,
  type MaskCanvasHandle,
  type MaskCanvasState,
} from "../generation/MaskCanvas";
import { VersionTimeline } from "../generation/VersionTimeline";
import type { DesignAssetVersion, GenerationPaletteColor } from "../generation/generation-types";
import generationStyles from "../generation/generation.module.css";
import {
  executeWorkflowNode,
  fetchWorkflow,
  patchWorkflow,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowOperation,
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
}

interface ImageDimensions { readonly width: number; readonly height: number }
interface PendingRestore { readonly asset: DesignAssetVersion; readonly mutationId: string }
interface PendingEditPatch {
  readonly toolId: string;
  readonly mutationId: string;
  readonly baseRevision: number;
  readonly operations: readonly WorkflowOperation[];
}
type Tab = "preview" | "inpaint" | "variation" | "history";

const MAX_MASK_DIMENSION = 2048;

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function equalJson(left: unknown, right: unknown): boolean {
  const normalize = (_key: string, value: unknown): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  };
  return JSON.stringify(left, normalize) === JSON.stringify(right, normalize);
}

function generationDimension(value: number): number {
  const safe = Math.min(2048, Math.max(256, value));
  return Math.max(256, Math.round(safe / 8) * 8);
}

function sourceFor(graph: WorkflowGraph | null, assetId: string): WorkflowNode | null {
  return graph?.nodes.find((node) => node.type === "candidate" && node.payload.assetId === assetId) ?? null;
}

function graphPalettes(graph: WorkflowGraph | null): Array<{ id: string; title: string; colors: GenerationPaletteColor[] }> {
  return (graph?.nodes ?? []).flatMap((node) => {
    if (node.type !== "swatch") return [];
    const colors = readSwatchColors(node.payload, node.title);
    return colors.length ? [{ id: node.id, title: node.title, colors }] : [];
  });
}

async function importRestoredAsset(
  projectId: string,
  sourceNodeId: string,
  restored: PendingRestore,
): Promise<WorkflowGraph> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workflow/import-asset`, {
    body: JSON.stringify({
      sourceNodeId,
      assetId: restored.asset.id,
      operation: "restore",
      mutationId: restored.mutationId,
    }),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "恢复版本已生成，但写入工作流失败");
  }
  return (await response.json()) as WorkflowGraph;
}

export function LegacyAssetTools(props: WorkflowAssetWorkspaceProps) {
  if (!props.open) return null;
  return <AssetWorkspaceContent key={props.assetId} {...props} />;
}

function AssetWorkspaceContent({ projectId, assetId, open, onClose, onGraphRefresh, onEnsureConversation, embedded, initialTab }: WorkflowAssetWorkspaceProps) {
  const [storedTab, setTab] = useState<Tab>("preview");
  const tab = initialTab === "erase" ? "inpaint" : initialTab ?? storedTab;
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const tabsId = useId();
  const exportTrigger = useRef<HTMLButtonElement>(null);
  const [actualSize, setActualSize] = useState(false);
  const [maskState, setMaskState] = useState<MaskCanvasState>({ coverage: 0, strokeCount: 0 });
  const [brushRatio, setBrushRatio] = useState(0.06);
  const [prompts, setPrompts] = useState({ inpaint: "", variation: "" });
  const editMode = tab === "variation" ? "variation" : "inpaint";
  const prompt = initialTab === "erase" ? "移除蒙版内的对象，自然补全背景，保留未涂抹区域的服装、纹理与光线。" : prompts[editMode];
  const setPrompt = (value: string) => setPrompts((previous) => ({ ...previous, [editMode]: value }));
  const [preserve, setPreserve] = useState("");
  const [paletteId, setPaletteId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submissionStage, setSubmissionStage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingToolId, setPendingToolId] = useState<string | null>(null);
  const [pendingPatch, setPendingPatch] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);
  const mask = useRef<MaskCanvasHandle>(null);
  const pendingEditPatch = useRef<PendingEditPatch | null>(null);
  const previewUrl = `/api/design-assets/${encodeURIComponent(assetId)}/content`;
  const source = sourceFor(graph, assetId);
  const palettes = useMemo(() => graphPalettes(graph), [graph]);
  const selectedPalette = palettes.find((entry) => entry.id === paletteId);
  const changeTab = (next: Tab) => {
    setTab(next);
  };
  const locked = submitting || Boolean(pendingToolId) || pendingPatch || Boolean(pendingRestore);
  useWorkspaceDraft("inpaint", { prompt: prompts.inpaint, paletteId, brushRatio, mask: maskState.draft, pendingPatch, pendingToolId }, Boolean(prompts.inpaint || paletteId || maskState.strokeCount || pendingPatch || pendingToolId), locked);
  useWorkspaceDraft("variation", { prompt: prompts.variation, preserve }, Boolean(prompts.variation || preserve), locked);

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
      (result) => { if (active) { setGraph(result); setGraphError(null); } },
      (error: unknown) => { if (active) setGraphError(message(error, "工作流读取失败")); },
    );
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      if (!image.naturalWidth || !image.naturalHeight) {
        setImageError("无法读取原图尺寸");
      } else if (image.naturalWidth > MAX_MASK_DIMENSION || image.naturalHeight > MAX_MASK_DIMENSION) {
        setImageError(`原图尺寸超过局部重绘上限 ${MAX_MASK_DIMENSION}×${MAX_MASK_DIMENSION}`);
        setDimensions({ width: image.naturalWidth, height: image.naturalHeight });
      } else {
        setDimensions({ width: image.naturalWidth, height: image.naturalHeight });
        setImageError(null);
      }
    };
    image.onerror = () => { if (active) setImageError("原图加载失败，请重试"); };
    image.src = previewUrl;
    return () => { active = false; image.onload = null; image.onerror = null; };
  }, [assetId, open, previewUrl, projectId]);

  const attachRestore = async (restored: PendingRestore) => {
    setSubmitting(true);
    setActionError(null);
    setPendingRestore(restored);
    setSubmissionStage("正在将恢复版本接入工作流…");
    try {
      const latest = await reloadGraph();
      const current = sourceFor(latest, assetId);
      if (!current) throw new Error("找不到原候选节点，无法建立恢复分支");
      const result = await importRestoredAsset(projectId, current.id, restored);
      setGraph(result);
      setPendingRestore(null);
      onGraphRefresh();
      onClose();
    } catch (error) {
      setActionError(message(error, "恢复版本写入工作流失败，请重试"));
      throw error;
    } finally {
      setSubmitting(false);
      setSubmissionStage(null);
    }
  };

  const executePending = async (toolNodeId: string) => {
    setSubmitting(true);
    setActionError(null);
    setSubmissionStage("正在创建修改任务…");
    try {
      const result = await executeWorkflowNode(projectId, toolNodeId, await onEnsureConversation?.());
      setGraph(result);
      setPendingToolId(null);
      setPrompts((previous) => ({ ...previous, [editMode]: "" }));
      if (editMode === "inpaint") { mask.current?.clear(); setPaletteId(""); }
      else setPreserve("");
      onGraphRefresh();
      onClose();
    } catch (error) {
      setActionError(message(error, "工具节点已创建，但执行失败；可重试当前节点"));
      onGraphRefresh();
    } finally {
      setSubmitting(false);
      setSubmissionStage(null);
    }
  };

  const saveAndExecuteEdit = async () => {
    let draft = pendingEditPatch.current;
    if (!draft) throw new Error("修改分支尚未准备好");
    setSubmissionStage("正在建立可追溯的修改分支…");
    const latest = await reloadGraph();
    const existing = latest.nodes.find((node) => node.id === draft?.toolId);
    const expectedNode = draft.operations.find((operation) => operation.type === "add_node");
    const expectedEdge = draft.operations.find((operation) => operation.type === "add_edge");
    if (existing && (!expectedNode || expectedNode.type !== "add_node" || existing.kind !== expectedNode.node.kind || existing.type !== expectedNode.node.type || !equalJson(existing.payload, expectedNode.node.payload) ||
      !expectedEdge || expectedEdge.type !== "add_edge" || !latest.edges.some((edge) => edge.sourceNodeId === expectedEdge.edge.sourceNodeId && edge.targetNodeId === draft?.toolId && edge.sourcePort === "out" && edge.targetPort === "source"))) {
      throw new Error("修改节点与待提交分支不一致，请检查工作流");
    }
    if (!existing && latest.revision !== draft.baseRevision) {
      draft = { ...draft, mutationId: crypto.randomUUID(), baseRevision: latest.revision };
      pendingEditPatch.current = draft;
    }
    const result = existing ? latest : await patchWorkflow(projectId, { mode: "semantic", mutationId: draft.mutationId, baseRevision: draft.baseRevision, operations: draft.operations });
    setGraph(result);
    setPendingToolId(draft.toolId);
    pendingEditPatch.current = null;
    setPendingPatch(false);
    onGraphRefresh();
    setSubmitting(false);
    await executePending(draft.toolId);
  };

  const submitVariation = async () => {
    if (pendingToolId) { await executePending(pendingToolId); return; }
    if (!pendingEditPatch.current && (!dimensions || imageError)) { setActionError(imageError ?? "原图尚未就绪"); return; }
    if (!pendingEditPatch.current && prompt.trim().length < 3) { setActionError("请描述变体需要如何修改"); return; }
    if (!pendingEditPatch.current && preserve.trim().length < 3) { setActionError("请明确需要保留的设计特征"); return; }
    setSubmitting(true);
    setActionError(null);
    try {
      if (!pendingEditPatch.current) {
        if (!dimensions) throw new Error("原图尚未就绪");
        const latest = await reloadGraph();
        const current = sourceFor(latest, assetId);
        if (!current) throw new Error("找不到当前候选节点，无法建立变体分支");
        const toolId = crypto.randomUUID();
        pendingEditPatch.current = {
          toolId,
          mutationId: crypto.randomUUID(),
          baseRevision: latest.revision,
          operations: [
            { type: "add_node", node: {
              id: toolId, kind: "tool", type: "edit_design", title: `变体 · ${prompt.trim().slice(0, 42)}`,
              payload: { toolKey: "edit_design", toolVersion: "1", params: {
                taskType: "i2i", prompt: `${prompt.trim()}\n保持不变：${preserve.trim()}`,
                width: generationDimension(dimensions.width), height: generationDimension(dimensions.height),
              } },
              x: current.x + 340, y: current.y + 160,
            } },
            { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: current.id, targetNodeId: toolId, sourcePort: "out", targetPort: "source" } },
          ],
        };
        setPendingPatch(true);
      }
      await saveAndExecuteEdit();
    } catch (error) {
      setActionError(message(error, "变体未提交，请重试"));
      setSubmitting(false);
      setSubmissionStage(null);
    }
  };

  const submitInpaint = async () => {
    if (pendingToolId) { await executePending(pendingToolId); return; }
    if (!pendingEditPatch.current && (!dimensions || dimensions.width > MAX_MASK_DIMENSION || dimensions.height > MAX_MASK_DIMENSION)) {
      setActionError(imageError ?? "原图尚未就绪");
      return;
    }
    if (!pendingEditPatch.current && (!mask.current || maskState.strokeCount === 0)) { setActionError("请先涂抹需要修改的区域"); return; }
    if (!pendingEditPatch.current && prompt.trim().length < 3) { setActionError("请描述局部区域需要如何修改"); return; }
    setSubmitting(true);
    setActionError(null);
    try {
      if (!pendingEditPatch.current) {
        if (!mask.current || !dimensions) throw new Error("原图与掩码尚未就绪");
        setSubmissionStage("正在准备掩码…");
        const blob = await mask.current.exportPng();
        setSubmissionStage("正在上传掩码…");
        const maskImageUrl = await uploadTemporaryMask(projectId, blob, dimensions.width, dimensions.height);
        const latest = await reloadGraph();
        const current = sourceFor(latest, assetId);
        if (!current) throw new Error("找不到当前候选节点，无法建立修改分支");
        const toolId = crypto.randomUUID();
        pendingEditPatch.current = {
          toolId,
          mutationId: crypto.randomUUID(),
          baseRevision: latest.revision,
          operations: [
            {
              type: "add_node",
              node: {
                id: toolId,
                kind: "tool",
                type: "edit_design",
                title: `局部修改 · ${prompt.trim().slice(0, 42)}`,
                payload: {
                  toolKey: "edit_design",
                  toolVersion: "1",
                  params: {
                    taskType: "inpaint",
                    ...(initialTab === "erase" ? { intent: "erase" } : {}),
                    maskImageUrl,
                    prompt: prompt.trim(),
                    width: generationDimension(dimensions.width),
                    height: generationDimension(dimensions.height),
                    ...(selectedPalette ? { palette: selectedPalette.colors } : {}),
                  },
                },
                x: current.x + 340,
                y: current.y + 160,
              },
            },
            {
              type: "add_edge",
              edge: { id: crypto.randomUUID(), sourceNodeId: current.id, targetNodeId: toolId, sourcePort: "out", targetPort: "source" },
            },
          ],
        };
        setPendingPatch(true);
      }
      await saveAndExecuteEdit();
    } catch (error) {
      setActionError(message(error, "局部修改未提交，请重试"));
      setSubmitting(false);
      setSubmissionStage(null);
    }
  };

  if (!open) return null;
  return (
    <EmbeddedEditor embedded={embedded} label={exportOpen ? "导出成果" : "候选资产工作台"} className={`${styles.assetDialog} ${controls.controlSurface}`} onClose={() => { if (!submitting && !pendingRestore) onClose(); }}>
        <section hidden={exportOpen}>
          <header className={styles.header}>
            <div><span>候选方案</span><h2>{source?.title ?? "候选设计"}</h2></div>
            <button aria-label="关闭候选工作台" disabled={submitting || Boolean(pendingRestore)} onClick={onClose} type="button">关闭</button>
          </header>
          <Tabs<Tab> id={tabsId} label="候选资产操作" value={tab} onChange={changeTab} options={[{ value: "preview", label: "大图预览" }, { value: "inpaint", label: "局部重绘" }, { value: "variation", label: "生成变体" }, { value: "history", label: "版本历史" }].map((item) => ({ ...item, value: item.value as Tab, disabled: submitting || Boolean(pendingToolId) || pendingPatch }))} />
          {graphError ? <p className={styles.notice} role="alert">{graphError} <button onClick={() => void reloadGraph().catch(() => undefined)} type="button">重试</button></p> : null}
          <TabPanel tabsId={tabsId} value="preview" activeValue={tab}>
            <div className={styles.previewLayout}>
              <figure className={styles.imageStage} data-actual-size={actualSize}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt={source?.title ?? "候选设计原图"} src={previewUrl} />
              </figure>
              <aside className={styles.previewAside}>
                <span>原图与设计分支</span>
                <div className={styles.previewTools}><Button size="small" onClick={() => setActualSize(false)} aria-pressed={!actualSize}>适合窗口</Button><Button size="small" onClick={() => setActualSize(true)} aria-pressed={actualSize}>原始比例</Button></div>
                <h3>沿这张候选继续设计</h3>
                <p>版本恢复和局部修改会创建新的分支；当前候选与它的来源会保留在画布中。</p>
                <a href={`/${encodeURIComponent(projectId)}/studio?tab=styles&assetId=${encodeURIComponent(assetId)}`}>比较并保存为款式</a>
                {dimensions ? <dl><div><dt>原图尺寸</dt><dd>{dimensions.width} × {dimensions.height}</dd></div></dl> : null}
                {imageError ? <p className={styles.error} role="alert">{imageError}</p> : null}
                <div className={styles.actionStack}>
                  <button className={styles.primary} onClick={() => changeTab("inpaint")} type="button">创建局部修改分支</button>
                  <button onClick={() => changeTab("variation")} type="button">创建变体分支</button>
                  <button onClick={() => changeTab("history")} type="button">查看与恢复版本</button>
                  <button ref={exportTrigger} onClick={() => setExportOpen(true)} type="button">单图高清导出</button>
                </div>
              </aside>
            </div>
          </TabPanel>
          <TabPanel keepMounted tabsId={tabsId} value="inpaint" activeValue={tab}>
            <div aria-busy={submitting} className={generationStyles.inpaintLayout}>
              <figure className={generationStyles.maskStage}>
                <div className={generationStyles.maskMedia} data-busy={submitting}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="局部重绘原图" src={previewUrl} />
                  {dimensions && dimensions.width <= MAX_MASK_DIMENSION && dimensions.height <= MAX_MASK_DIMENSION ? (
                    <MaskCanvas brushRatio={brushRatio} height={dimensions.height} onChange={setMaskState} ref={mask} width={dimensions.width} />
                  ) : null}
                </div>
                <figcaption>涂抹需要修改的区域</figcaption>
              </figure>
              <aside className={generationStyles.inpaintControls}>
                <div><span>局部修改分支</span><strong>选择并描述修改</strong></div>
                <label><span>修改说明</span><textarea aria-label="局部重绘说明" disabled={submitting || Boolean(pendingToolId) || pendingPatch} maxLength={1000} onChange={(event) => { setPrompt(event.target.value); setActionError(null); }} placeholder="例如：将领口改为窄驳领，保持面料与光线" value={prompt} /></label>
                {palettes.length ? <label><span>参考色卡 · 可选</span><select disabled={submitting || Boolean(pendingToolId) || pendingPatch} onChange={(event) => setPaletteId(event.target.value)} value={paletteId}><option value="">保持原图配色</option>{palettes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label> : null}
                <label><span>画笔尺寸 · {Math.round(brushRatio * 100)}%</span><input aria-label="掩码画笔尺寸" disabled={submitting || Boolean(pendingToolId) || pendingPatch} max={0.16} min={0.02} onChange={(event) => setBrushRatio(Number(event.target.value))} step={0.01} type="range" value={brushRatio} /></label>
                <div className={generationStyles.maskActions}><button disabled={submitting || Boolean(pendingToolId) || pendingPatch || !dimensions} onClick={() => mask.current?.addCenterRegion()} type="button">标记中央区域</button><button disabled={submitting || Boolean(pendingToolId) || pendingPatch || !maskState.strokeCount} onClick={() => mask.current?.undo()} type="button">撤销一笔</button><button disabled={submitting || Boolean(pendingToolId) || pendingPatch || !maskState.strokeCount} onClick={() => mask.current?.clear()} type="button">清空</button></div>
                {submissionStage ? <p role="status">{submissionStage}</p> : null}
                {imageError ? <p className={styles.error} role="alert">{imageError}</p> : null}
                {actionError ? <p className={styles.error} role="alert">{actionError}</p> : null}
                <button className={generationStyles.inpaintSubmit} disabled={submitting || (!pendingToolId && (!dimensions || Boolean(imageError)))} onClick={() => void submitInpaint()} type="button">{pendingToolId ? "重试执行当前修改节点" : submitting ? "正在处理…" : "提交局部重绘"}</button>
              </aside>
            </div>
          </TabPanel>
          <TabPanel tabsId={tabsId} value="variation" activeValue={tab}>
            <div className={styles.previewLayout}>
              <figure className={styles.imageStage}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="变体来源候选" src={previewUrl} />
              </figure>
              <aside className={generationStyles.inpaintControls}>
                <div><span>变体分支</span><strong>从当前候选生成变体</strong></div>
                <p>原候选会保留。确认后，新变体将沿当前候选的来源建立独立分支。</p>
                <label><span>修改方向</span><textarea aria-label="变体修改说明" disabled={submitting || Boolean(pendingToolId) || pendingPatch} maxLength={1000} onChange={(event) => { setPrompt(event.target.value); setActionError(null); }} placeholder="例如：探索两种更简洁的领型" value={prompt} /></label>
                <label><span>需要保留的特征</span><textarea aria-label="变体保留特征" disabled={submitting || Boolean(pendingToolId) || pendingPatch} maxLength={1000} onChange={(event) => { setPreserve(event.target.value); setActionError(null); }} placeholder="例如：保持宽松廓形、原有面料与配色" value={preserve} /></label>
                {submissionStage ? <p role="status">{submissionStage}</p> : null}
                {imageError ? <p className={styles.error} role="alert">{imageError}</p> : null}
                {actionError ? <p className={styles.error} role="alert">{actionError}</p> : null}
                <button className={generationStyles.inpaintSubmit} disabled={submitting || (!pendingToolId && (!dimensions || Boolean(imageError)))} onClick={() => void submitVariation()} type="button">{pendingToolId ? "重试执行当前变体节点" : submitting ? "正在处理…" : "确认生成变体"}</button>
              </aside>
            </div>
          </TabPanel>
          <TabPanel tabsId={tabsId} value="history" activeValue={tab}>
            <div className={styles.historyBody}>
              {pendingRestore ? <p className={styles.notice} role="alert">恢复版本已创建，正在等待加入画布。{actionError ? ` ${actionError}` : ""} <button disabled={submitting} onClick={() => void attachRestore(pendingRestore).catch(() => undefined)} type="button">重试加入画布</button></p> : null}
              {!pendingRestore ? (
                <VersionTimeline
                  assetId={assetId}
                  onRestore={(asset) => attachRestore({ asset, mutationId: crypto.randomUUID() })}
                  onRestoreEnd={() => setSubmitting(false)}
                  onRestoreStart={() => setSubmitting(true)}
                />
              ) : null}
            </div>
          </TabPanel>
        </section>
      {exportOpen ? <ExportModal embedded onBack={() => { setExportOpen(false); requestAnimationFrame(() => exportTrigger.current?.focus()); }} onClose={onClose} source={{ assetId, previewUrl, type: "asset" }} /> : null}
    </EmbeddedEditor>
  );
}
