"use client";

/* eslint-disable @next/next/no-img-element -- Private asset previews load with browser credentials and preserve original dimensions. */

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { createShapeId, useEditor, useValue, type Editor, type TLShapeId } from "tldraw";
import { canvasCreationDraftSchema, emptyCanvasCreationDraft, type CanvasCreation, type CanvasCreationDraft, type CanvasCreationModule, type CreationInputBinding, type CreateCanvasCreationInput, type CreationResultView } from "@fashion/shared";
import { useDraftScope } from "../../../components/drafts/use-persistent-draft";
import { Menu } from "../../../components/ui";
import { completeUpload, putOriginal, signImageUpload, validateImage, waitForThumbnail, imageMimeType } from "../file-upload-api";
import { importDesignAsset } from "../generation/collection-api";
import { runCanvasCommand } from "./canvas-api";
import { fetchWorkflow, type WorkflowGraph } from "./workflow-api";
import { nodeImageUrl } from "./workflow-graph";
import { CreationComposer, nodeInput, type CreationComposerHandle } from "./CreationComposer";
import { CreationShapeUtil, CREATION_SHAPE_TYPE, type CreationShape } from "./CreationShape";
import { useCanvasCreations } from "./use-canvas-creations";
import { creationOverlayLayout, connectionCurve, emptyCreationPosition, type ScreenRect } from "./creation-layout";
import { CreationWorkspaceContext } from "./creation-context";
import { creationCatalog } from "./creation-catalog";
import { CreationCatalogPanel } from "./CreationCatalogPanel";
import catalogStyles from "./creation-catalog-panel.module.css";
import { imageToolEntries, type ImageToolEntry } from "./image-tool-entry";
import type { CanvasToolActions } from "./CanvasTools";
import { WorkflowDialog } from "./WorkflowDialog";
import { CanvasModuleWorkspace } from "./CanvasModuleWorkspace";
import styles from "./creation-workspace.module.css";
import { creationStatusLabel } from "./creation-status";
import { CanvasAction } from "./CanvasAction";
import { WorkspaceIcon } from "./WorkspaceIcon";
import WarmTooltip, { WarmTooltipGroup } from "../../../components/WarmTooltip";
import { CanvasResourcePicker, type CanvasResourceChoice } from "./CanvasResourcePicker";
import { useCanvasResourceImport } from "./use-canvas-resource-import";
import { CanvasVideoPlayer } from "./CanvasVideoPlayer";
import nodeStyles from "./node-entry.module.css";
import { ManualTextEditor } from "./ManualTextEditor";
import { mergeAssistantConnectionDraft, syncAssistantCreationDraft, type AssistantCreationContext } from "./assistant-creation-context";

export { CreationShapeUtil };
const creationShapeId = (id: string) => createShapeId(`creation-${id}`);
function frameNewNode(editor: Editor, id: TLShapeId) {
  const bounds = editor.getShapePageBounds(id); if (!bounds) return;
  const viewport = editor.getViewportScreenBounds();
  if (viewport.w < 700 || viewport.h < 650) {
    editor.zoomToBounds(bounds, { targetZoom: Math.min(editor.getZoomLevel(), Math.max(120, viewport.w - 104) / bounds.w, Math.max(140, viewport.h - 480) / bounds.h), inset: 52 });
  } else editor.centerOnPoint(bounds.center);
}
const resultStatus = (item: CanvasCreation) => item.runs[0]?.status ?? "draft";
const creationSize = (module: CanvasCreationModule, draft: CanvasCreationDraft) => module === "text" ? { w: 420, h: 260 } : module === "video" ? { w: 540, h: 304 } : module === "image" ? draft.parameters.width >= draft.parameters.height ? { w: 540, h: 540 * draft.parameters.height / draft.parameters.width } : { w: 440 * draft.parameters.width / draft.parameters.height, h: 440 } : { w: 340, h: 440 };

export interface CreationWorkspaceHandle { prepareAssistantContext: () => Promise<AssistantCreationContext>; openAssistantPanel: (panel: string, actionId: string) => Promise<void>; checkAssistantConnection: (id: string, revision: number | undefined) => void; acceptAssistantCreation: (saved: CanvasCreation, baseline: CanvasCreationDraft) => Promise<void> }
interface Props {
  ref?: Ref<CreationWorkspaceHandle>;
  projectId: string;
  graph: WorkflowGraph;
  ready: boolean;
  canEdit: boolean;
  actions: CanvasToolActions;
  onGraph: (graph: WorkflowGraph) => void;
  onError: (message: string | null) => void;
  flush: () => Promise<void>;
  refreshCanvas: () => Promise<void>;
  onEnsureConversation?: () => Promise<string>;
  onVisitReference?: (nodeId: string) => boolean;
  children: ReactNode;
}

export function CreationWorkspace({ ref, projectId, graph, ready, canEdit, actions, onGraph, onError, flush, refreshCanvas, onEnsureConversation, onVisitReference, children }: Props) {
  const editor = useEditor();
  const scope = useDraftScope();
  const preferenceKey = scope ? `fashion:creative-canvas:${scope.accountId}` : "";
  const [initialPreferences] = useState(() => {
    try {
      const value: unknown = typeof window === "undefined" || !preferenceKey ? {} : JSON.parse(localStorage.getItem(preferenceKey) ?? "{}");
      const record = value && typeof value === "object" ? value as { connections?: boolean; recent?: unknown[] } : {};
      return { connections: record.connections !== false, recent: Array.isArray(record.recent) ? record.recent.filter((id): id is string => typeof id === "string").slice(0, 5) : [] };
    } catch { return { connections: true, recent: [] as string[] }; }
  });
  const controller = useCanvasCreations(projectId, ready);
  const onFunctionsReady = actions.onFunctionsReady;
  useEffect(() => {
    onFunctionsReady?.(ready && controller.loaded);
    return () => onFunctionsReady?.(false);
  }, [ready, controller.loaded, onFunctionsReady]);
  const [functionsOpen, setFunctionsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const creatingLock = useRef(false);
  const [resourceSession, setResourceSession] = useState<{ tab: "upload" | "existing"; kind: "all" | "video"; targetId?: string } | null>(null);
  const resourceTrigger = useRef<HTMLElement | null>(null);
  const locateResource = useRef<string | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);
  const publishFlights = useRef(new Map<string, Promise<void>>());
  const manualRevisions = useRef(new Map<string, number>());
  const objectsOpener = useRef<(() => void) | null>(null);
  const registerObjects = useCallback((open: () => void) => {
    objectsOpener.current = open;
    return () => { if (objectsOpener.current === open) objectsOpener.current = null; };
  }, []);
  const [search, setSearch] = useState("");
  const [recent, setRecent] = useState<string[]>(initialPreferences.recent);
  const [moduleSession, setModuleSession] = useState<{ entryId: string; sourceAssetId?: string; creationId?: string } | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [preview, setPreview] = useState<(CreationResultView & { referenceActions?: { insert: () => void; remove?: (() => void) | undefined } }) | null>(null);
  const [compare, setCompare] = useState<CreationResultView | null>(null);
  const [showConnections, setShowConnections] = useState(initialPreferences.connections);
  const [connection, setConnection] = useState<{ binding: CreationInputBinding; from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, CanvasCreationDraft>>({});
  const [draftState, setDraftState] = useState({ key: "", ready: false });
  const known = useRef(new Set<string>());
  const connectionFlight = useRef(false);
  const composer = useRef<CreationComposerHandle>(null);
  const assistantScope = useRef(true);
  useEffect(() => { assistantScope.current = true; return () => { assistantScope.current = false; }; }, []);
  const createPackets = useRef(new Map<string, CreateCanvasCreationInput>());
  const live = useRef({ graph, onGraph, onError, controller, drafts, flush });
  useLayoutEffect(() => { live.current = { graph, onGraph, onError, controller, drafts, flush }; }, [graph, onGraph, onError, controller, drafts, flush]);
  const refreshGraph = async () => { live.current.onGraph(await fetchWorkflow(projectId)); };
  const imports = useCanvasResourceImport(projectId, {
    onGraph,
    attach: async (targetId, nodeId) => {
      const owner = live.current.controller;
      if (owner.hasPendingSave(targetId)) await owner.retrySave(targetId);
      if (owner.get(targetId)?.currentResult?.sourceNodeId !== nodeId) await owner.update(targetId, { mediaNodeId: nodeId });
      window.dispatchEvent(new Event("fashion-workflow:refresh"));
    },
    placed: async nodeId => { locateResource.current = nodeId; await refreshCanvas(); },
  });
  const openResources = (tab: "upload" | "existing", targetId?: string) => {
    resourceTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setResourceSession({ tab, kind: targetId ? "video" : "all", ...(targetId ? { targetId } : {}) });
  };
  const closeResources = () => { setResourceSession(null); requestAnimationFrame(() => { const target = resourceTrigger.current; if (target?.isConnected) target.focus({ preventScroll: true }); else editor.getContainer().querySelector<HTMLElement>('[aria-label="添加节点"]')?.focus(); }); };
  const publishText = (id: string, value?: CanvasCreationDraft) => {
    const existing = publishFlights.current.get(id); if (existing) return existing;
    const work = (async () => {
      const item = live.current.controller.items.find(item => item.id === id); if (!item || item.module !== "text") throw new Error("文本节点不可用");
      if (composer.current?.targetKey === id) composer.current.captureAssistantDraft();
      const draft = structuredClone(value ?? live.current.drafts[id] ?? item.draft);
      setPublishing(id);
      if (composer.current?.targetKey === id) await composer.current.checkpoint(draft);
      const saved = await live.current.controller.update(id, { draft, ...(draft.textContent !== item.currentResult?.text ? { publishText: true } : {}) }, manualRevisions.current.get(id) ?? item.revision);
      manualRevisions.current.set(id, saved.revision);
      if (composer.current?.targetKey === id) composer.current.setRevision(saved.revision);
      setDrafts(current => { const latest = current[id]; return { ...current, [id]: latest && JSON.stringify(latest) !== JSON.stringify(draft) ? { ...latest, ...(saved.currentResult ? { textBaseNodeId: saved.currentResult.nodeId } : {}) } : saved.draft }; });
      try { await refreshGraph(); } catch { live.current.onError("文本已保存，画布资料暂未同步，请刷新记录。"); }
    })();
    publishFlights.current.set(id, work); void work.finally(() => { publishFlights.current.delete(id); setPublishing(null); }).catch(() => undefined); return work;
  };
  const confirmTextSave = async (id: string) => {
    setPublishing(id);
    try {
      await controller.retrySave(id);
      const saved = controller.get(id); if (!saved) return;
      manualRevisions.current.set(id, saved.revision);
      const retained = { ...(live.current.drafts[id] ?? saved.draft), ...(saved.currentResult ? { textBaseNodeId: saved.currentResult.nodeId } : {}) };
      setDrafts(current => ({ ...current, [id]: retained }));
      if (composer.current?.targetKey === id) { composer.current.setRevision(saved.revision); await composer.current.checkpoint(retained, JSON.stringify(saved.draft)); }
      window.dispatchEvent(new Event("fashion-workflow:refresh"));
    } finally { setPublishing(null); }
  };
  const setTextMode = async (id: string, mode: "manual" | "ai") => {
    const item = live.current.controller.items.find(item => item.id === id); if (!item || item.module !== "text") return;
    const current = live.current.drafts[id] ?? item.draft;
    if (mode === "ai" && current.textMode === "manual" && current.textContent?.trim() && current.textContent !== item.currentResult?.text) {
      await publishText(id, current);
      const saved = live.current.controller.get(id); if (!saved) return;
      setDrafts(values => ({ ...values, [id]: { ...saved.draft, textMode: "ai" } })); return;
    }
    if (!manualRevisions.current.has(id)) manualRevisions.current.set(id, item.revision);
    const content = current.textBaseNodeId === (item.currentResult?.nodeId ?? undefined) ? current.textContent ?? item.currentResult?.text ?? "" : item.currentResult?.text ?? current.textContent ?? "";
    setDrafts(values => ({ ...values, [id]: { ...current, textMode: mode, ...(mode === "manual" ? { textContent: content, ...(item.currentResult ? { textBaseNodeId: item.currentResult.nodeId } : {}) } : {}) } }));
  };
  const nodeActions = useRef<{ setTextMode: typeof setTextMode; openResources: typeof openResources } | null>(null);
  useLayoutEffect(() => { nodeActions.current = { setTextMode, openResources }; });
  useEffect(() => {
    const prepare = (event: Event) => {
      const detail = (event as CustomEvent<{ creationId?: string; action?: string }>).detail;
      if (!canEdit || editor.getIsReadonly() || !detail?.creationId) return;
      const shapeId = creationShapeId(detail.creationId);
      const shape = editor.getShape(shapeId);
      if (!shape || editor.isShapeOrAncestorLocked(shape)) return;
      editor.select(shapeId);
      if (detail.action === "manual" || detail.action === "ai") { void nodeActions.current?.setTextMode(detail.creationId, detail.action).catch((cause: unknown) => live.current.onError(cause instanceof Error ? cause.message : "模式切换失败")); return; }
      if (detail.action === "video-upload" || detail.action === "video-existing") { nodeActions.current?.openResources(detail.action === "video-upload" ? "upload" : "existing", detail.creationId); return; }
      requestAnimationFrame(() => {
        const current = composer.current;
        if (!current || current.targetKey !== detail.creationId) return;
        if (detail.action === "upload") current.openUpload();
        else if (detail.action === "reference") current.openReferences();
        else current.focusPrompt();
      });
    };
    const container = editor.getContainer(); container.addEventListener("fashion-creation:prepare", prepare);
    return () => container.removeEventListener("fashion-creation:prepare", prepare);
  }, [canEdit, editor]);
  const state = useValue("creation-screen-layout", () => {
    const viewport = editor.getViewportScreenBounds();
    const hovered = editor.getHoveredShapeId();
    const selected = editor.getOnlySelectedShapeId();
    const shapes = editor.getCurrentPageShapes().filter((shape) => !editor.isShapeHidden(shape)).flatMap((shape) => {
      if (!shape.meta.canvasNodeId && shape.type !== CREATION_SHAPE_TYPE) return [];
      const bounds = editor.getShapePageBounds(shape);
      if (!bounds) return [];
      const origin = editor.pageToScreen({ x: bounds.x, y: bounds.y });
      const rect: ScreenRect = { x: origin.x - viewport.x, y: origin.y - viewport.y, w: bounds.w * editor.getZoomLevel(), h: bounds.h * editor.getZoomLevel() };
      return [{ id: shape.id, nodeId: String(shape.meta.canvasNodeId ?? ""), creationId: shape.type === CREATION_SHAPE_TYPE ? shape.props.creationId : "", image: shape.type === "fashion-image" || shape.type === CREATION_SHAPE_TYPE, rect, locked: editor.isShapeOrAncestorLocked(shape), active: shape.id === selected || shape.id === hovered }];
    });
    return { shapes, selected, readOnly: editor.getIsReadonly(), viewport: { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h }, idle: editor.isIn("select.idle") };
  }, [editor]);
  const selected = state.shapes.find((shape) => shape.id === state.selected);
  const selectedCreation = controller.items.find((item) => item.id === selected?.creationId);
  const source = graph.nodes.find((node) => node.id === selected?.nodeId);
  const selectedKey = selectedCreation?.id ?? source?.id;
  const promptModule = !selectedCreation || ["image", "text", "analysis", "evaluation"].includes(selectedCreation.module);
  const textMode = selectedCreation?.module === "text" ? (drafts[selectedCreation.id] ?? selectedCreation.draft).textMode ?? "ai" : null;
  const bounds = selected ? creationOverlayLayout(selected.rect, state.viewport) : null;
  const editable = ready && canEdit && controller.canEdit;
  // Creation and image tools produce new versions without overwriting source payloads.
  const selectionEditable = editable && !state.readOnly && !selected?.locked && source?.status !== "proposed";
  const overlayOpen = functionsOpen || Boolean(moduleSession) || Boolean(resourceSession) || Boolean(history || preview) || Boolean(selected?.image && state.viewport.w < 700);
  const onOverlayChange = actions.onCreationPanelOpenChange;
  useEffect(() => { onOverlayChange?.(overlayOpen); return () => onOverlayChange?.(false); }, [onOverlayChange, overlayOpen]);
  const framedSelection = useRef<string | null>(null);
  useEffect(() => {
    if (!selected?.image || !state.idle || framedSelection.current === selected.id || state.viewport.w < 700 || state.viewport.h < 650) return;
    framedSelection.current = selected.id;
    const availableBottom = state.viewport.h - 340;
    const desiredY = Math.max(160, Math.min(selected.rect.y, availableBottom - selected.rect.h));
    const shift = desiredY - selected.rect.y;
    if (Math.abs(shift) > 8 && selected.rect.h < availableBottom - 70) {
      const camera = editor.getCamera(); editor.setCamera({ ...camera, y: camera.y + shift / camera.z });
    }
  }, [editor, selected, state.idle, state.viewport.h, state.viewport.w]);

  const preferences = (connections: boolean, entries = recent) => {
    setShowConnections(connections); setRecent(entries);
    if (preferenceKey) try { localStorage.setItem(preferenceKey, JSON.stringify({ connections, recent: entries })); } catch { /* View remains usable. */ }
  };

  useEffect(() => {
    if (!ready || !controller.loaded) return;
    let placed = false;
    editor.store.mergeRemoteChanges(() => editor.run(() => {
      for (const item of controller.items) {
        const id = creationShapeId(item.id);
        const existing = editor.getShape<CreationShape>(id);
        const first = !known.current.has(item.id);
        known.current.add(item.id);
        if (!existing && (item.removed || !first)) continue;
        const imageUrl = item.currentResult?.imageUrl ?? "";
        const sameImage = existing?.props.imageUrl === imageUrl;
        const props = { creationId: item.id, title: item.title, module: item.module, imageUrl, text: item.currentResult?.text ?? "", status: resultStatus(item),
          mediaUrl: item.currentResult?.media?.url ?? "", textMode: (drafts[item.id] ?? item.draft).textMode ?? "ai",
          pixelWidth: item.currentResult?.width ?? (sameImage ? existing?.props.pixelWidth ?? 0 : 0), pixelHeight: item.currentResult?.height ?? (sameImage ? existing?.props.pixelHeight ?? 0 : 0) };
        const meta = { canvasCreationId: item.id, canvasNodeId: item.currentResult?.nodeId ?? "" };
        if (!existing) {
          const center = editor.getViewportPageBounds().center;
          const size = creationSize(item.module, item.draft);
          editor.createShape<CreationShape>({ id, type: CREATION_SHAPE_TYPE, x: item.position?.x ?? center.x - size.w / 2, y: item.position?.y ?? center.y - size.h / 2, props: { ...size, ...props }, meta });
          placed = true;
        } else if (JSON.stringify({ ...existing.props, ...props }) !== JSON.stringify(existing.props) || existing.meta.canvasNodeId !== meta.canvasNodeId) {
          editor.updateShape<CreationShape>({ id, type: CREATION_SHAPE_TYPE, props, meta });
        }
      }
    }, { history: "ignore", ignoreShapeLock: true }));
    if (placed && canEdit) void live.current.flush().catch((cause: unknown) => live.current.onError(cause instanceof Error ? cause.message : "创作位置保存失败"));
  }, [controller.items, controller.loaded, editor, ready, canEdit, drafts]);


  const resultNodes = controller.items.flatMap((item) => item.runs.flatMap((run) => run.results.map((result) => result.nodeId))).join("|");
  useEffect(() => {
    if (!resultNodes || resultNodes.split("|").every((id) => live.current.graph.nodes.some((node) => node.id === id))) return;
    let active = true;
    void fetchWorkflow(projectId).then((next) => { if (active) live.current.onGraph(next); }).catch((cause: unknown) => { if (active) live.current.onError(cause instanceof Error ? cause.message : "成果素材同步失败"); });
    return () => { active = false; };
  }, [projectId, resultNodes]);
  const report = (work: Promise<unknown>) => { void work.catch((cause: unknown) => live.current.onError(cause instanceof Error ? cause.message : "操作未完成")); };
  const ensure = async (key: string, module: CanvasCreationModule, draft: CanvasCreationDraft, title: string, position?: { x: number; y: number }, stableId?: string) => {
    const center = editor.getViewportPageBounds().center;
    const occupied = editor.getCurrentPageShapes().flatMap((shape) => { const bounds = editor.getShapePageBounds(shape); return bounds ? [{ x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h }] : []; });
    const size = creationSize(module, draft);
    const available = emptyCreationPosition(occupied, position ?? { x: center.x - size.w / 2, y: center.y - size.h / 2 }, size);
    const packet = createPackets.current.get(key) ?? { mutationId: stableId ?? crypto.randomUUID(), id: stableId ?? crypto.randomUUID(), module, title, draft, position: available };
    createPackets.current.set(key, packet);
    const item = stableId && controller.get(stableId) || await controller.create(packet);
    createPackets.current.delete(key);
    const id = creationShapeId(item.id);
    if (!editor.getShape(id)) editor.createShape<CreationShape>({ id, type: CREATION_SHAPE_TYPE, x: item.position?.x ?? center.x - size.w / 2, y: item.position?.y ?? center.y - size.h / 2, props: { ...size, creationId: item.id, title: item.title, module, status: "draft" }, meta: { canvasCreationId: item.id } });
    known.current.add(item.id); editor.select(id);
    frameNewNode(editor, id);
    await flush();
    return item;
  };
  const saveDraft = async (draft: CanvasCreationDraft, revision?: number) => {
    if (!selectedKey) throw new Error("请先选择图片或创作节点");
    if (selectedCreation) {
      const item = await controller.update(selectedCreation.id, { draft }, revision);
      if (item.module === "text") manualRevisions.current.set(item.id, item.revision);
      setDrafts((current) => { const latest = current[item.id]; return { ...current, [item.id]: latest && JSON.stringify(latest) !== JSON.stringify(draft) ? latest : item.draft }; });
      return item;
    }
    const page = selected ? editor.getShapePageBounds(selected.id) : null;
    const item = await ensure(selectedKey, "image", draft, `${source?.title ?? "图片"}的创作`, page ? { x: page.maxX + 100, y: page.y } : undefined);
    setDrafts((current) => ({ ...current, [item.id]: current[item.id] ?? current[selectedKey] ?? item.draft }));
    return item;
  };
  const generate = async (draft: CanvasCreationDraft, revision?: number) => {
    try {
      for (const input of draft.inputs) {
        if (!input.creationId || input.nodeId) continue;
        const source = live.current.controller.get(input.creationId);
        const sourceDraft = live.current.drafts[input.creationId] ?? source?.draft;
        if (source?.module === "text" && sourceDraft?.textMode === "manual" && sourceDraft.textContent !== source.currentResult?.text) throw new Error(`请先保存「${source.title}」的文本，再执行下游创作`);
      }
      const pending = selectedCreation && controller.hasPending(selectedCreation.id);
      const item = pending ? selectedCreation : await saveDraft(draft, revision);
      if (!pending && JSON.stringify(item.draft) !== JSON.stringify(draft)) throw new Error("创作要求在提交前已变化，尚未生成；请核对当前输入。");
      const conversationId = onEnsureConversation ? await onEnsureConversation() : undefined;
      await controller.run(item.id, conversationId); await refreshGraph();
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) onError(cause instanceof Error ? cause.message : "创作未能提交，输入已保留");
      throw cause;
    }
  };
  const branch = async (result?: CreationResultView) => {
    const base = result ? graph.nodes.find((node) => node.id === result.nodeId) : source;
    if (!base) throw new Error("结果素材尚未就绪，请刷新后继续");
    const draft = emptyCanvasCreationDraft();
    const binding = { ...nodeInput(base), ...(selectedCreation ? { creationId: selectedCreation.id } : {}) };
    draft.inputs = [binding]; draft.basedOnInputId = nodeImageUrl(base) ? binding.id : null;
    const page = selected ? editor.getShapePageBounds(selected.id) : null;
    const targetModule = selectedCreation?.module === "text" || base.type === "reference_text" ? "text" : "image";
    if (targetModule === "text") draft.textMode = "ai";
    await ensure(`branch:${base.id}:${crypto.randomUUID()}`, targetModule, draft, "继续创作", page ? { x: page.maxX + 100, y: page.y } : undefined);
    setHistory(null);
  };
  const bindingFor = (shape: (typeof state.shapes)[number]): CreationInputBinding | null => {
    if (shape.creationId) {
      const item = controller.items.find((creation) => creation.id === shape.creationId);
      const local = item ? drafts[item.id] ?? item.draft : null;
      const unsaved = item?.module === "text" && local?.textMode === "manual" && local.textContent !== item.currentResult?.text;
      return item ? { id: crypto.randomUUID(), creationId: item.id, ...(item.currentResult && !unsaved ? { nodeId: item.currentResult.nodeId, ...(item.currentResult.assetId ? { assetId: item.currentResult.assetId } : {}) } : {}) } : null;
    }
    const node = graph.nodes.find((item) => item.id === shape.nodeId);
    return node ? nodeInput(node) : null;
  };
  const connect = async (binding: CreationInputBinding, creationId: string) => {
    if (connectionFlight.current) return;
    const target = live.current.controller.items.find((item) => item.id === creationId);
    if (!target) return;
    if (target.module === "video") throw new Error("视频节点目前只支持导入，请从已有资源中选择视频");
    const draft = live.current.drafts[creationId] ?? target.draft;
    if (draft.inputs.some((input) => binding.nodeId ? input.nodeId === binding.nodeId : Boolean(binding.creationId && input.creationId === binding.creationId))) { setConnection(null); return; }
    const next = { ...draft, inputs: [...draft.inputs, binding] };
    connectionFlight.current = true;
    setDrafts((current) => ({ ...current, [creationId]: next }));
    try {
      const item = await live.current.controller.update(creationId, { draft: next }, target.revision);
      if (manualRevisions.current.has(creationId)) manualRevisions.current.set(creationId, item.revision);
      if (composer.current?.targetKey === creationId) composer.current.setRevision(item.revision);
      setDrafts((current) => { const latest = current[creationId]; return { ...current, [creationId]: latest && JSON.stringify(latest) !== JSON.stringify(next) ? latest : item.draft }; });
      setConnection(null);
    } finally { connectionFlight.current = false; }
  };
  const connectionRef = useRef(connection);
  const geometryRef = useRef(state);
  useLayoutEffect(() => { connectionRef.current = connection; geometryRef.current = state; }, [connection, state]);
  useEffect(() => {
    if (!connection) return;
    const move = (event: PointerEvent) => { const view = geometryRef.current.viewport; setConnection((current) => current ? { ...current, to: { x: event.clientX - view.x, y: event.clientY - view.y } } : null); };
    const up = (event: PointerEvent) => {
      const current = connectionRef.current; if (!current) return;
      const view = geometryRef.current.viewport;
      const x = event.clientX - view.x, y = event.clientY - view.y;
      const target = geometryRef.current.shapes.find((shape) => shape.creationId && x >= shape.rect.x - 44 && x <= shape.rect.x + shape.rect.w && y >= shape.rect.y && y <= shape.rect.y + shape.rect.h);
      if (target) report(connect(current.binding, target.creationId));
    };
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") setConnection(null); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("keydown", cancel);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("keydown", cancel); };
    // Connections are read from refs so moving the pointer does not rebind listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(connection)]);

  const lines = useMemo(() => {
    const result: { id: string; from: ScreenRect; to: ScreenRect; draft: boolean }[] = [];
    for (const target of controller.items) {
      const to = state.shapes.find((shape) => shape.creationId === target.id);
      if (!to) continue;
      for (const binding of (drafts[target.id] ?? target.draft).inputs) {
        const from = state.shapes.find((shape) => binding.creationId ? shape.creationId === binding.creationId : shape.nodeId === binding.nodeId);
        if (from) result.push({ id: `${target.id}:${binding.id}`, from: from.rect, to: to.rect, draft: true });
      }
    }
    for (const target of state.shapes.filter((shape) => !shape.creationId && shape.nodeId)) {
      const tools = graph.edges.filter((edge) => edge.targetNodeId === target.nodeId).map((edge) => edge.sourceNodeId);
      const sourceIds = graph.edges.filter((edge) => tools.includes(edge.targetNodeId)).map((edge) => edge.sourceNodeId);
      for (const id of new Set(sourceIds)) {
        const from = state.shapes.find((shape) => shape.nodeId === id);
        if (from) result.push({ id: `legacy:${id}:${target.id}`, from: from.rect, to: target.rect, draft: false });
      }
    }
    return result;
  }, [controller.items, drafts, graph.edges, state.shapes]);
  async function openEntry(entryId: string, actionId?: string) {
    if (entryId === "project-planning") entryId = "collections";
    const projectEntry = actions.projectFunctions?.find((item) => item.id === entryId);
    if (projectEntry) {
      if (projectEntry.disabled) return;
      setFunctionsOpen(false);
      preferences(showConnections, [entryId, ...recent.filter((id) => id !== entryId)].slice(0, 5));
      await actions.onProjectFunction?.(entryId);
      return;
    }
    if (entryId === "collections") {
      setFunctionsOpen(false);
      preferences(showConnections, [entryId, ...recent.filter((id) => id !== entryId)].slice(0, 5));
      actions.onOpenCollections();
      return;
    }
    const entry = creationCatalog.find((item) => item.id === entryId); if (!entry) return;
    setFunctionsOpen(false); preferences(showConnections, [entryId, ...recent.filter((id) => id !== entryId)].slice(0, 5));
    if (!editable && entry.module === "trends") { setModuleSession({ entryId }); return; }
    if (entry.imageAction) {
      if (source && nodeImageUrl(source)) await openImageTool(entry.imageAction);
      else setModuleSession({ entryId });
    } else if (["image", "analysis", "evaluation"].includes(entry.module)) {
      const draft = emptyCanvasCreationDraft();
      if (entry.module === "image" && !source) draft.parameters = { ...draft.parameters, width: 1536, height: 864 };
      if (source) { const binding = nodeInput(source); draft.inputs = [binding]; if (entry.module === "image" && nodeImageUrl(source)) draft.basedOnInputId = binding.id; }
      await ensure(`module:${entryId}:${actionId ?? crypto.randomUUID()}`, entry.module, draft, entry.title, undefined, actionId);
    } else {
      const sourceAssetId = entry.module !== "trends" && source && nodeImageUrl(source) ? (await prepareImageAsset()).assetId : undefined;
      const draft = emptyCanvasCreationDraft();
      if (source && entry.module !== "trends") draft.inputs = [nodeInput(source)];
      const item = await ensure(`module:${entryId}:${actionId ?? crypto.randomUUID()}`, entry.module, draft, entry.title, undefined, actionId);
      setModuleSession({ entryId, creationId: item.id, ...(sourceAssetId ? { sourceAssetId } : {}) });
    }
  }
  const createNode = async (kind: "image" | "text" | "video") => {
    if (!editable || creatingLock.current) return;
    creatingLock.current = true;
    setCreating(true);
    try {
      const draft = emptyCanvasCreationDraft();
      draft.parameters = { ...draft.parameters, width: 1536, height: 864 };
      if (kind === "text") draft.textMode = "ai";
      if (connection && kind !== "video") draft.inputs = [connection.binding];
      const label = { image: "图片", text: "文本", video: "视频" }[kind];
      const item = await ensure(`add-${kind}`, kind, draft, `${label}节点 ${controller.items.filter(item => item.module === kind).length + 1}`);
      if (kind === "text") manualRevisions.current.set(item.id, item.revision);
      setConnection(null);
    } finally { creatingLock.current = false; setCreating(false); }
  };
  const importFile = async (file: File, signal: AbortSignal, progress: (percent: number) => void) => {
    if (imports.pending) throw new Error("请先确认上一次资源导入");
    const mime = imageMimeType(file), video = ["video/mp4", "video/webm"].includes(mime);
    if (resourceSession?.targetId && !video) throw new Error("请选择MP4或WebM视频");
    const error = video ? file.size > 100 * 1024 * 1024 ? "视频不能超过100MB" : null : validateImage(file);
    if (error || !file.size) throw new Error(error ?? "文件为空");
    await flush(); signal.throwIfAborted();
    const signed = await signImageUpload(projectId, file, signal);
    const completed = signed.upload ? await putOriginal(signed.upload, file, { signal, onProgress: event => { if (event.total > 0) progress(Math.round(event.loaded / event.total * 100)); } }).then(() => completeUpload(signed.file.id)) : signed.file;
    if (!video) await waitForThumbnail(signed.file.id, completed);
    signal.throwIfAborted();
    const existing = live.current.graph.nodes.find(node => node.payload.fileAssetId === signed.file.id && node.kind === "asset");
    const placement = existing && state.shapes.find(shape => shape.nodeId === existing.id);
    if (placement && !resourceSession?.targetId) { editor.select(placement.id); return; }
    const center = editor.getViewportPageBounds().center;
    const command = video ? { type: "import_reference_video" as const, mutationId: crypto.randomUUID(), fileId: signed.file.id, placement: resourceSession?.targetId ? "reference" as const : "canvas" as const, position: { x: center.x - 180, y: center.y - 150 } } : { type: "import_reference_image" as const, mutationId: crypto.randomUUID(), fileId: signed.file.id, placement: "canvas" as const, position: { x: center.x - 170, y: center.y - 220 } };
    await imports.execute(command, resourceSession?.targetId);
  };
  const chooseResource = async (choice: CanvasResourceChoice) => {
    if (imports.pending) throw new Error("请先确认上一次资源导入");
    await flush();
    const targetId = resourceSession?.targetId;
    const position = editor.getViewportPageBounds().center;
    if ("node" in choice) {
      const placed = state.shapes.find(shape => shape.nodeId === choice.node.id);
      if (placed && !targetId) { editor.select(placed.id); frameNewNode(editor, placed.id); return; }
      await imports.execute({ type: "place_canvas_material", mutationId: crypto.randomUUID(), nodeId: choice.node.id, expectedUpdatedAt: choice.node.updatedAt, placement: targetId ? "reference" : "canvas", position }, targetId);
    } else {
      const file = choice.file;
      if (file.domain === "runway" && file.kind === "video") await imports.execute({ type: "place_generated_media", mutationId: crypto.randomUUID(), mediaId: file.resourceId, placement: targetId ? "reference" : "canvas", position }, targetId);
      else if (file.domain === "asset" && file.kind === "image" && !targetId) await imports.execute({ type: "place_generated_asset", mutationId: crypto.randomUUID(), assetId: file.resourceId, archived: file.archived, position });
      else throw new Error("该资源暂不能加入此节点");
    }
  };
  const prepareImageAsset = async () => {
    if (!source || !selectionEditable) throw new Error("请先选择可编辑的图片");
    if (typeof source.payload.assetId === "string") return { assetId: source.payload.assetId, nodeId: source.id };
    const fileId = source.payload.fileAssetId;
    if (typeof fileId !== "string") throw new Error("图片尚未就绪，请等待上传完成");
    const imported = await importDesignAsset(projectId, fileId);
    const result = await runCanvasCommand(projectId, { type: "update_material", nodeId: source.id, mutationId: crypto.randomUUID(), ...(selected ? { shapeId: selected.id } : {}), payload: { ...source.payload, assetId: imported.id } });
    live.current.onGraph(result.graph);
    return { assetId: imported.id, nodeId: result.nodeId };
  };
  const openImageTool = async (action: ImageToolEntry) => {
    const node = source; if (!node) return;
    const prepared = await prepareImageAsset();
    actions.onOpenImageTool?.(prepared.nodeId, prepared.assetId, action);
  };
  const upload = async (files: readonly File[]) => {
    const inputs: CreationInputBinding[] = [];
    for (const file of files) {
      const error = validateImage(file); if (error) throw new Error(error);
      const signed = await signImageUpload(projectId, file);
      const uploaded = signed.upload ? await putOriginal(signed.upload, file).then(() => completeUpload(signed.file.id)) : signed.file;
      await waitForThumbnail(signed.file.id, uploaded);
      const result = await runCanvasCommand(projectId, { type: "import_reference_image", mutationId: crypto.randomUUID(), fileId: signed.file.id, placement: "canvas" });
      live.current.onGraph(result.graph); inputs.push({ id: crypto.randomUUID(), nodeId: result.nodeId });
    }
    return inputs;
  };
  const historyItem = controller.items.find((item) => item.id === history);
  const adoptResult = async (creationId: string, nodeId: string) => {
    const current = live.current.controller.get(creationId);
    const draft = live.current.drafts[creationId] ?? current?.draft;
    if (current?.module === "text" && draft?.textMode === "manual" && draft.textContent?.trim() && draft.textContent !== current.currentResult?.text) await publishText(creationId, draft);
    const conversationId = onEnsureConversation ? await onEnsureConversation() : undefined;
    const item = await controller.update(creationId, { currentResultNodeId: nodeId, ...(conversationId ? { conversationId } : {}) });
    if (item.module === "text") manualRevisions.current.set(item.id, item.revision);
    setDrafts((current) => ({ ...current, [item.id]: item.draft }));
    if (composer.current?.targetKey === item.id) { composer.current.setRevision(item.revision); await composer.current.checkpoint(item.draft, JSON.stringify(item.draft)); }
  };
  const assetId = selectedCreation?.currentResult?.assetId ?? (typeof source?.payload.assetId === "string" ? source.payload.assetId : null);
  const imageUrl = selectedCreation?.currentResult?.imageUrl ?? (source ? nodeImageUrl(source) : "");

  useImperativeHandle(ref, () => ({
    acceptAssistantCreation: async (saved, baseline) => {
      const owner = live.current.controller, target = owner.get(saved.id);
      if (target && target.revision > saved.revision) throw new Error("创作目标已有更新，原草稿保留，请重新核对。");
      const local = live.current.drafts[saved.id] ?? target?.draft ?? baseline;
      const merged = mergeAssistantConnectionDraft(local, baseline, saved.draft);
      owner.accept(saved);
      manualRevisions.current.set(saved.id, saved.revision);
      const field = composer.current?.targetKey === saved.id ? composer.current : null;
      field?.setRevision(saved.revision);
      setDrafts(current => ({ ...current, [saved.id]: mergeAssistantConnectionDraft(current[saved.id] ?? local, baseline, saved.draft) }));
      await field?.checkpoint(merged, JSON.stringify(saved.draft));
    },
    checkAssistantConnection: (id, revision) => {
      const target = live.current.controller.get(id);
      if (!target || target.removed || target.revision !== revision) throw new Error("创作目标已变化，请重新读取后连接。");
      const local = live.current.drafts[id];
      if (local && JSON.stringify(canvasCreationDraftSchema.parse(local)) !== JSON.stringify(canvasCreationDraftSchema.parse(target.draft)) || live.current.controller.hasPendingSave(id)) throw new Error("该目标有未保存或待确认的修改，请先保存要求再连接。");
    },
    openAssistantPanel: async (panel, actionId) => {
      if (panel === "functions") { setFunctionsOpen(true); return; }
      if (panel === "objects") { if (!objectsOpener.current) throw new Error("画布对象面板尚未就绪。"); setFunctionsOpen(false); objectsOpener.current(); return; }
      await openEntry(panel, actionId);
    },
    prepareAssistantContext: async () => {
    const shape = editor.getOnlySelectedShape();
    if (!shape || shape.type !== CREATION_SHAPE_TYPE) return { focusCreationId: null };
    const target = live.current.controller.get(shape.props.creationId);
    if (!ready || !live.current.controller.loaded || !target || target.removed) throw new Error("当前创作节点尚未就绪，请稍后再发送。");
    const field = composer.current?.targetKey === target.id ? composer.current : null;
    if (["image", "text", "analysis", "evaluation"].includes(target.module) && !field) throw new Error("当前创作输入尚未恢复，请稍后再发送给助手。");
    const captured = field?.captureAssistantDraft() ?? { draft: structuredClone(live.current.drafts[target.id] ?? target.draft), revision: manualRevisions.current.get(target.id) ?? target.revision };
    const assertCurrent = () => {
      if (!assistantScope.current || editor.getOnlySelectedShapeId() !== shape.id || !editor.getShape(shape.id)) throw new Error("当前创作节点或工作区已切换，尚未发送给助手。");
    };
    return syncAssistantCreationDraft({ target, ...captured, canEdit: editable && !editor.getIsReadonly() && !editor.isShapeOrAncestorLocked(shape), assertCurrent, flush,
      save: (draft, revision) => live.current.controller.update(target.id, { draft }, revision),
      accepted: async saved => {
        manualRevisions.current.set(target.id, saved.revision);
        if (composer.current?.targetKey === target.id) await composer.current.acknowledgeAssistantDraft(saved.draft, saved.revision);
      },
    });
  } }));
  useEffect(() => {
    if (!locateResource.current) return;
    const shape = state.shapes.find(shape => shape.nodeId === locateResource.current);
    if (shape) { editor.select(shape.id); frameNewNode(editor, shape.id); locateResource.current = null; }
  }, [state.shapes, editor]);
  return <WarmTooltipGroup><CreationWorkspaceContext.Provider value={{ openFunctions: () => setFunctionsOpen((value) => !value), functionsOpen, registerObjects, createNode: kind => report(createNode(kind)), openResources: tab => openResources(tab), creating }}>
    {children}
    {selectedCreation?.module === "text" && textMode === "manual" && selected && !resourceSession && !functionsOpen ? <ManualTextEditor key={selectedCreation.id} style={{ left: selected.rect.x + 2, top: selected.rect.y + 2, width: Math.max(0, selected.rect.w - 4), height: Math.max(0, selected.rect.h - 4) }} readonly={!selectionEditable || publishing === selectedCreation.id || draftState.key !== selectedCreation.id || !draftState.ready} value={(drafts[selectedCreation.id] ?? selectedCreation.draft).textContent ?? selectedCreation.currentResult?.text ?? ""}
      onChange={text => { const item = selectedCreation; if (!manualRevisions.current.has(item.id)) manualRevisions.current.set(item.id, item.revision); setDrafts(current => ({ ...current, [item.id]: { ...(current[item.id] ?? item.draft), textMode: "manual", textContent: text } })); }} onSave={() => report(publishText(selectedCreation.id))} /> : null}
    {ready ? <div className={styles.connectionToggle} onPointerDown={(event) => event.stopPropagation()}>
      <CanvasAction label="显示连接关系" icon="connections" data-guide="workspace-connections" role="switch" aria-checked={showConnections} onClick={() => { preferences(!showConnections); setConnection(null); }} />
      {selected?.image && state.viewport.w < 700 ? <CanvasAction label="项目助手" icon="comment" onClick={() => actions.onStartConversation?.(false)} /> : null}
      {connection ? <CanvasAction label="取消连接" icon="close" onClick={() => setConnection(null)} /> : null}
    </div> : null}
    {showConnections ? <div className={styles.connectionLayer} aria-label="创作输入连接">
      <svg aria-hidden="true" width="100%" height="100%">{lines.map((line) => <path key={line.id} d={connectionCurve({ x: line.from.x + line.from.w, y: line.from.y + line.from.h / 2 }, { x: line.to.x, y: line.to.y + line.to.h / 2 })} data-draft={line.draft} />)}{connection ? <path d={connectionCurve(connection.from, connection.to)} data-draft="true" /> : null}</svg>
      {editable ? state.shapes.filter((shape) => shape.active || connection && shape.creationId).map((shape) => <div key={shape.id}>
        {shape.creationId || shape.image ? <button type="button" className={styles.port} disabled={shape.locked || Boolean(connection && !shape.creationId)} style={{ left: shape.rect.x - 32, top: shape.rect.y + shape.rect.h / 2 - 11 }} aria-label={connection ? `连接到${controller.items.find((item) => item.id === shape.creationId)?.title ?? "创作节点"}` : "选择图片参考"} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => {
          event.stopPropagation();
          if (connection && shape.creationId) report(connect(connection.binding, shape.creationId));
          else if (shape.creationId && controller.items.find(item => item.id === shape.creationId)?.module === "video") openResources("existing", shape.creationId);
          else {
            editor.select(shape.id);
            if (shape.creationId && controller.items.find(item => item.id === shape.creationId)?.module === "text") report(setTextMode(shape.creationId, "ai"));
            requestAnimationFrame(() => { if (editor.getOnlySelectedShapeId() === shape.id && composer.current?.targetKey === (shape.creationId || shape.nodeId)) composer.current.openReferences(); });
          }
        }} /> : null}
        {bindingFor(shape) ? <button type="button" className={styles.port} data-connection-source={shape.creationId || shape.nodeId} disabled={shape.locked || controller.items.find(item => item.id === shape.creationId)?.module === "video" || graph.nodes.find(node => node.id === shape.nodeId)?.type === "media"} title={controller.items.find(item => item.id === shape.creationId)?.module === "video" || graph.nodes.find(node => node.id === shape.nodeId)?.type === "media" ? "当前模型尚不支持视频参考" : "连接到下游创作"} style={{ left: shape.rect.x + shape.rect.w + 10, top: shape.rect.y + shape.rect.h / 2 - 11 }} aria-label="从此素材连接" onPointerDown={(event) => {
          event.stopPropagation(); event.preventDefault(); const binding = bindingFor(shape); if (!binding) return;
          const from = { x: shape.rect.x + shape.rect.w, y: shape.rect.y + shape.rect.h / 2 }; setConnection({ binding, from, to: from });
        }} onClick={(event) => { if (event.detail !== 0) return; const binding = bindingFor(shape); if (binding) { const from = { x: shape.rect.x + shape.rect.w, y: shape.rect.y + shape.rect.h / 2 }; setConnection({ binding, from, to: from }); } }} /> : null}
      </div>) : null}
    </div> : null}
    {selected?.image && selectedKey && bounds && state.idle && !functionsOpen && !moduleSession && promptModule ? <>
      {selectedCreation && !selectedCreation.runs.length && (selectedCreation.module === "image" || selectedCreation.module === "text" && textMode !== "manual") ? null :
      <div className={styles.imageToolbar} data-compact={bounds.compact} data-narrow={state.viewport.w < 380} data-creation-image-tools style={{ left: bounds.toolbarX, top: bounds.toolbarY, width: bounds.toolbarWidth }} role="toolbar" aria-label={selectedCreation && selectedCreation.module !== "image" ? "创作操作" : "常用图片工具"} onPointerDown={(event) => event.stopPropagation()}>
        {!selectedCreation || selectedCreation.module === "image" ? <>
        <div className={styles.toolbarMain}>
        {imageToolEntries.slice(0, 3).map((entry) => <CanvasAction key={entry.action} data-image-action={entry.action} label={entry.label} icon={entry.action as "inpaint" | "erase" | "remove_background"} text={entry.label} disabled={!selectionEditable || !source || !imageUrl} onClick={() => report(openImageTool(entry.action))} />)}
        <span className={styles.secondaryTool}><CanvasAction label="换色" text="换色" icon="palette" disabled={!selectionEditable} onClick={() => report(openEntry("color"))} /></span>
        <span className={styles.secondaryTool}><CanvasAction label="换面料" text="换面料" icon="fabric" disabled={!selectionEditable} onClick={() => report(openEntry("material"))} /></span>
        <WarmTooltip content="更多图片操作" triggerSelector="summary"><Menu nativeTitle={false} key={`${selectedKey}:${assetId ?? "empty"}`} className={styles.toolbarMore} label="更多图片操作" trigger={<><span data-action-label>更多</span><WorkspaceIcon name="chevron" /></>} align="end">{imageToolEntries.slice(3).map((entry) => <button key={entry.action} disabled={!selectionEditable || !source || !imageUrl} onClick={() => report(openImageTool(entry.action))}>{entry.label}</button>)}
          <button disabled={!selectionEditable} onClick={() => report(openEntry("color"))}>换色</button><button disabled={!selectionEditable} onClick={() => report(openEntry("material"))}>换面料</button>
          <button disabled={!editable || !source} onClick={() => report(branch(selectedCreation?.currentResult ?? undefined))}>基于此图继续</button>
          {bounds.compact && actions.onReference ? <button type="button" disabled={actions.referencesPreparing || !source && !selectedCreation?.currentResult?.nodeId} onClick={actions.onReference}>{actions.referencesPreparing ? "正在准备引用…" : "引用到助手"}</button> : null}
          <button disabled={!imageUrl} onClick={() => setPreview(selectedCreation?.currentResult ?? { nodeId: source?.id ?? "", assetId, title: source?.title ?? "图片", imageUrl: imageUrl || null, text: null, width: null, height: null })}>预览图片</button>
          {imageUrl ? <a href={imageUrl} download={selectedCreation?.title ?? source?.title ?? "设计图片"}>下载图片</a> : null}
          {selectedCreation ? <button type="button" disabled={!selectedCreation.runs.length} onClick={() => { setHistory(selectedCreation.id); setCompare(null); }}>查看历史</button> : source && assetId ? <button type="button" onClick={() => actions.onOpenAssetHistory?.(source.id, assetId)}>查看历史</button> : null}
        </Menu></WarmTooltip></div></> : selectedCreation.module === "text" ? <div className={nodeStyles.textToolbar}>
          <CanvasAction label="自己编写内容" icon="text_edit" text="编写" aria-pressed={textMode === "manual"} disabled={!selectionEditable || Boolean(publishing)} onClick={() => report(setTextMode(selectedCreation.id, "manual"))} />
          <CanvasAction label="AI 起草" icon="annotate" text="AI 起草" aria-pressed={textMode === "ai"} disabled={!selectionEditable || Boolean(publishing)} onClick={() => report(setTextMode(selectedCreation.id, "ai"))} />
          {textMode === "manual" ? controller.hasPendingSave(selectedCreation.id) ? <CanvasAction label="确认上次文本保存" icon="reset" text="确认保存" disabled={Boolean(publishing)} onClick={() => report(confirmTextSave(selectedCreation.id))} /> : <CanvasAction label="保存文本" icon="save" text={publishing === selectedCreation.id ? "保存中" : "保存"} shortcut="Ctrl ↵" disabled={!selectionEditable || Boolean(publishing) || !(drafts[selectedCreation.id] ?? selectedCreation.draft).textContent?.trim()} onClick={() => report(publishText(selectedCreation.id))} /> : null}
          {textMode === "manual" ? <span className={nodeStyles.textStatus} role="status">{controller.hasPendingSave(selectedCreation.id) ? "待确认" : (drafts[selectedCreation.id] ?? selectedCreation.draft).textContent === selectedCreation.currentResult?.text ? "已保存" : "未保存"}</span> : null}
        </div> : <strong className={styles.functionName}>{selectedCreation.title}</strong>}
        <div className={styles.toolbarUtilities}>
          {selectedCreation ? <CanvasAction label="历史" icon="history" disabled={!selectedCreation.runs.length} onClick={() => { setHistory(selectedCreation.id); setCompare(null); }} /> : source && assetId ? <CanvasAction label="历史" icon="history" onClick={() => actions.onOpenAssetHistory?.(source.id, assetId)} /> : null}
          {imageUrl ? <span className={styles.secondaryUtility}><WarmTooltip content="下载图片"><a className={styles.downloadAction} aria-label="下载图片" href={imageUrl} download={selectedCreation?.title ?? source?.title ?? "设计图片"}><WorkspaceIcon name="download" /></a></WarmTooltip></span> : null}
          {(!selectedCreation || selectedCreation.module === "image") ? <span className={styles.previewUtility}><CanvasAction label="预览图片" icon="expand" disabled={!imageUrl} onClick={() => setPreview(selectedCreation?.currentResult ?? { nodeId: source?.id ?? "", assetId, title: source?.title ?? "图片", imageUrl: imageUrl || null, text: null, width: null, height: null })} /></span> : null}
          {actions.onReference ? <span className={styles.secondaryUtility}><CanvasAction label={actions.referencesPreparing ? "正在准备引用…" : "引用到助手"} icon="comment" disabled={actions.referencesPreparing || !source && !selectedCreation?.currentResult?.nodeId} onClick={actions.onReference} /></span> : null}
          <CanvasAction label="取消选择" icon="close" onClick={() => editor.selectNone()} />
        </div>
      </div>}
      <CreationComposer ref={composer} onDraftState={setDraftState} creations={controller.items} onVisitReference={onVisitReference} onPreviewReference={(view, referenceActions) => setPreview({ ...view, referenceActions })} key={selectedKey} creation={selectedCreation} source={source} value={drafts[selectedKey]} graph={graph} canEdit={selectionEditable && !["analysis", "evaluation"].includes(selectedCreation?.module ?? "")} pending={Boolean(selectedCreation && controller.hasPending(selectedCreation.id))}
        submitting={Boolean(selectedCreation && controller.isSubmitting(selectedCreation.id))}
        pendingSave={Boolean(selectedCreation && controller.hasPendingSave(selectedCreation.id))} onRetrySave={() => selectedCreation ? controller.retrySave(selectedCreation.id) : Promise.resolve()}
        style={{ left: bounds.x, top: bounds.composerY, width: bounds.width, ...(textMode === "manual" ? { display: "none" } : {}) }} onChange={(draft) => setDrafts((current) => ({ ...current, [selectedKey]: draft }))}
        onSave={async (draft, revision) => { await saveDraft(draft, revision); }} onGenerate={generate} onUpload={upload} />
    </> : null}
    {selectedCreation?.module === "video" && bounds && !resourceSession ? <div className={`${styles.imageToolbar} ${nodeStyles.videoPanel}`} data-compact={bounds.compact} style={{ left: bounds.x, top: bounds.composerY, width: bounds.width }} role="toolbar" aria-label="视频操作" onPointerDown={event => event.stopPropagation()}>
      <CanvasAction label={selectedCreation.currentResult ? "更换视频" : "上传视频"} text={selectedCreation.currentResult ? "更换视频" : "上传视频"} icon="add" disabled={!selectionEditable} onClick={() => openResources("upload", selectedCreation.id)} />
      <CanvasAction label="选择已有视频" text="已有视频" icon="video" disabled={!selectionEditable} onClick={() => openResources("existing", selectedCreation.id)} />
      <CanvasAction label="视频历史" icon="history" disabled={!selectedCreation.runs.length} onClick={() => setHistory(selectedCreation.id)} />
      <CanvasAction label="放大播放" icon="expand" disabled={!selectedCreation.currentResult?.media} onClick={() => { if (selectedCreation.currentResult) setPreview(selectedCreation.currentResult); }} />
      <CanvasAction label="取消选择" icon="close" onClick={() => editor.selectNone()} />
    </div> : null}
    {selectedCreation && selectedCreation.module !== "video" && selected && bounds && !promptModule && !functionsOpen && !moduleSession ? <div className={styles.imageToolbar} style={{ left: bounds.x, top: bounds.toolbarY, width: bounds.width }} onPointerDown={(event) => event.stopPropagation()}>
      <strong>{selectedCreation.title}</strong><CanvasAction label="打开工作界面" icon="expand" onClick={() => {
        const entry = creationCatalog.find((item) => item.title === selectedCreation.title) ?? creationCatalog.find((item) => item.module === selectedCreation.module);
        const sourceAssetId = selectedCreation.draft.inputs.find((input) => input.id === selectedCreation.draft.basedOnInputId)?.assetId ?? selectedCreation.draft.inputs[0]?.assetId;
        if (entry) setModuleSession({ entryId: entry.id, creationId: selectedCreation.id, ...(sourceAssetId ? { sourceAssetId } : {}) });
      }} />
      <CanvasAction label="查看成果" icon="history" disabled={!selectedCreation.runs.length} onClick={() => setHistory(selectedCreation.id)} />
    </div> : null}
    {controller.error ? <div className={styles.loadError} role="alert">{controller.error}<button type="button" onClick={() => report(controller.refresh())}>重新载入创作记录</button></div> : null}
    {imports.pending ? <div className={styles.loadError} role="status">资源导入尚未确认<button onClick={() => report(imports.execute())}>确认上次导入</button></div> : null}
    {resourceSession ? <CanvasResourcePicker key={`${projectId}:${resourceSession.targetId ?? "canvas"}:${resourceSession.tab}`} projectId={projectId} graph={graph} creations={controller.items} pending={Boolean(imports.pending)} onRetry={() => imports.execute()} kind={resourceSession.kind} initialTab={resourceSession.tab} onClose={closeResources} onChoose={chooseResource} onUpload={importFile} /> : null}
    {functionsOpen ? <WorkflowDialog label="全部功能模块" className={catalogStyles.dialog} onClose={() => setFunctionsOpen(false)}>
      <CreationCatalogPanel search={search} onSearch={setSearch} recent={recent} editable={editable} projectFunctions={actions.projectFunctions ?? []} onClose={() => setFunctionsOpen(false)} onOpen={entryId => report(openEntry(entryId))}
        onOpenObjects={() => { setFunctionsOpen(false); preferences(showConnections, ["canvas-objects", ...recent.filter(id => id !== "canvas-objects")].slice(0, 5)); objectsOpener.current?.(); }} />
    </WorkflowDialog> : null}
    {historyItem ? <WorkflowDialog label="创作历史" onClose={() => setHistory(null)}><div className={styles.history}>
      <header><h2>{historyItem.title}的历史</h2><button type="button" onClick={() => setHistory(null)}>关闭</button></header>
      {historyItem.runs.map((run, index) => <section key={run.id}><h3>{run.moduleRecord ? run.moduleRecord.title : `第${historyItem.runs.length - index}轮`} <small>{new Date(run.createdAt).toLocaleString("zh-CN")}</small></h3>
        {run.moduleRecord ? <><p>{creationStatusLabel(run.status)}</p>{run.moduleRecord.requirements.map((requirement, index) => <p key={index}>{requirement}</p>)}<dl>{run.moduleRecord.values.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl></> : <><p>{run.draft.prompt}</p><p>{historyItem.module === "video" ? "视频导入" : historyItem.module === "text" ? run.draft.textMode === "manual" ? "手动保存" : "AI 起草" : `${run.draft.parameters.width} × ${run.draft.parameters.height}`}　{creationStatusLabel(run.status)}</p>{run.draft.operation?.toolKey === "transform_image" ? <p>{typeof run.draft.operation.parameters.rotate === "number" ? `旋转 ${run.draft.operation.parameters.rotate}°` : ""}{run.draft.operation.parameters.flipHorizontal ? " 水平翻转" : ""}{run.draft.operation.parameters.flipVertical ? " 垂直翻转" : ""}</p> : null}</>}
        {run.error ? <p role="alert">{run.error}</p> : null}<div className={styles.results}>{run.results.map((result) => <article key={result.nodeId}>
        <button type="button" onClick={() => setPreview(result)}>{result.imageUrl ? <img src={result.imageUrl} alt={result.title} /> : <p>{result.media ? "查看视频" : result.text}</p>}</button><div>
          <button type="button" disabled={!editable || historyItem.currentResultNodeId === result.nodeId} onClick={() => report(adoptResult(historyItem.id, result.nodeId))}>{historyItem.currentResultNodeId === result.nodeId ? "当前结果" : "采用此结果"}</button>
          {historyItem.module !== "video" ? <button type="button" disabled={!editable} onClick={() => report(branch(result))}>继续创作</button> : null}
          {historyItem.module !== "video" ? <button type="button" onClick={() => setCompare(result)}>比较</button> : null}
        </div>
      </article>)}</div></section>)}
      {compare ? <div className={styles.comparison}><div><strong>当前结果</strong>{historyItem.currentResult?.imageUrl ? <img src={historyItem.currentResult.imageUrl} alt="当前结果" /> : <p>{historyItem.currentResult?.text}</p>}</div><div><strong>所选历史</strong>{compare.imageUrl ? <img src={compare.imageUrl} alt="所选历史" /> : <p>{compare.text}</p>}</div></div> : null}
    </div></WorkflowDialog> : null}
    {preview ? <WorkflowDialog label={preview.media ? "视频预览" : preview.imageUrl ? "图片预览" : "文本预览"} onClose={() => setPreview(null)}><div className={styles.preview}><button type="button" onClick={() => setPreview(null)}>关闭预览</button>{preview.media ? <div className={nodeStyles.previewMedia}><CanvasVideoPlayer inOverlay id={`preview:${preview.nodeId}`} url={preview.media.url} title={preview.title} /></div> : preview.imageUrl ? <img src={preview.imageUrl} alt={preview.title} /> : <p>{preview.text}</p>}<div className={styles.previewActions}>{preview.referenceActions ? <><button type="button" onClick={() => { preview.referenceActions?.insert(); setPreview(null); }}>插入图片引用</button>{preview.referenceActions.remove ? <button type="button" onClick={() => { preview.referenceActions?.remove?.(); setPreview(null); }}>移除引用</button> : null}</> : null}</div></div></WorkflowDialog> : null}
    {moduleSession ? <CanvasModuleWorkspace projectId={projectId} entryId={moduleSession.entryId} sourceAssetId={moduleSession.sourceAssetId} creation={controller.items.find((item) => item.id === moduleSession.creationId)} canEdit={editable} onClose={() => setModuleSession(null)} onGraphChange={refreshGraph} onRecord={async (resource) => {
      if (!moduleSession.creationId) return;
      await controller.update(moduleSession.creationId, { resource });
      await refreshGraph();
    }} onContinue={async (nodeIds) => { await refreshGraph(); setModuleSession(null); actions.onReferenceNodeIds?.(nodeIds); }} onChooseImage={async (assetId, action) => {
      let nodeId = live.current.graph.nodes.find((node) => node.kind === "asset" && node.payload.assetId === assetId)?.id;
      if (!nodeId) {
        const result = await runCanvasCommand(projectId, { type: "create_material", mutationId: crypto.randomUUID(), materialType: "candidate", title: "图片素材", payload: { assetId, imageUrl: `/api/design-assets/${encodeURIComponent(assetId)}/content` } });
        live.current.onGraph(result.graph); nodeId = result.nodeId;
      }
      setModuleSession(null); actions.onOpenImageTool?.(nodeId, assetId, action);
    }} /> : null}
  </CreationWorkspaceContext.Provider></WarmTooltipGroup>;
}
