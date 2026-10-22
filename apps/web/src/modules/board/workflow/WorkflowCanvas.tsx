"use client";

import Link from "next/link";
import { Button, Dialog, SegmentedControl, Tooltip } from "../../../components/ui";
import { STUDIO_LAYOUT, motionOptions } from "../../../components/ui-config";
import controls from "../../../components/ui.module.css";
import type { CSSProperties } from "react";
import type { AgentRunView } from "@fashion/shared";
import { getWorkflowToolCatalog, getWorkflowToolContract, type WorkflowToolKey } from "@fashion/shared";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  createShapeId,
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  Tldraw,
  type Editor,
  type TLAnyShapeUtilConstructor,
  type TLShapeId,
  type TLUiOverrides,
  useEditor,
  useValue,
} from "tldraw";

import { fetchProject } from "../../projects/projects-api";
import {
  fetchAgentRun,
  listAgentRuns,
  createAgentConversation,
} from "../agent/agent-api";
import { BoardProjectContext } from "../board-context";
import { CollectionDrawer } from "../generation/CollectionDrawer";
import { createCollection } from "../generation/collection-api";
import { GenerationWorkspace } from "../generation/GenerationWorkspace";
import { userFacingError } from "../../../components/user-facing-error";
import { BoardSkeleton } from "../BoardSkeleton";
import {
  completeUpload,
  putOriginal,
  signImageUpload,
  validateImage,
  waitForThumbnail,
} from "../file-upload-api";
import { LegacyBoardHistory, type LegacyBoardImport } from "./LegacyBoardHistory";
import { WorkflowAssetWorkspace } from "./WorkflowAssetWorkspace";
import { WorkflowSketchEditor } from "./WorkflowSketchEditor";
import {
  type WorkflowAssetType,
  type WorkflowGraph,
  type WorkflowInputPort,
  type WorkflowNode,
  type WorkflowOperation,
  type WorkflowProposal,
  type WorkflowToolType,
  WorkflowApiError,
  fetchWorkflow,
  inferWorkflowNodeRole,
  patchWorkflow,
} from "./workflow-api";
import {
  displayNodeTitle,
  lineageOf,
  nodeImageUrl,
  nodeSize,
  nodeSummary,
  projectWorkflowProposal,
} from "./workflow-graph";
import {
  WORKFLOW_NODE_SHAPE_TYPE,
  WorkflowNodeShapeUtil,
  type WorkflowNodeShape,
} from "./WorkflowNodeShape";
import styles from "./workflow-canvas.module.css";
import { WORKFLOW_EDGE_SHAPE_TYPE, WorkflowEdgeShapeUtil, type WorkflowEdgeShape } from "./WorkflowEdgeShape";
import { WorkflowInteractionProvider, WorkflowConnectionOverlay } from "./WorkflowInteractions";
import { planInputEdit, type InputEdit, type PlannedInputEdit } from "./workflow-editing";
import { WorkflowAssistantPanel } from "./WorkflowAssistantPanel";
import { useWorkflowLayoutSave } from "./use-workflow-layout-save";
import type { WorkflowLayoutSave } from "./workflow-layout-save";
import { NodeDetails } from "./WorkflowNodeDetails";
import { WorkflowMaterialEntry, WorkflowLibraryDialog } from "./WorkflowMaterialDialogs";
import { useSerialPolling } from "../../use-serial-polling";

const tldrawLicenseKey = process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY;
const cameraActionIds = new Set([
  "zoom-in", "zoom-in-on-cursor", "zoom-out", "zoom-out-on-cursor",
  "zoom-to-100", "zoom-to-fit", "zoom-to-selection",
]);
const workflowUiOverrides: TLUiOverrides = {
  actions: (_editor, actions) => {
    for (const [id, action] of Object.entries(actions)) {
      if (!cameraActionIds.has(id)) action.onSelect = () => undefined;
    }
    return actions;
  },
  tools: (_editor, tools) => {
    const select = tools.select;
    const hand = tools.hand;
    return select && hand ? { select, hand } : {};
  },
};

interface WorkflowCanvasProps {
  readonly projectId: string;
}

type AddKind = WorkflowAssetType | WorkflowToolType;
type MenuTab = "assets" | "tools";
type LibraryKind = "fabric" | "trend";

const ASSET_OPTIONS: readonly { type: WorkflowAssetType; title: string; hint: string }[] = [
  { type: "brief", title: "设计需求", hint: "目标、场景、必需条件" },
  { type: "reference_text", title: "文字参考", hint: "风格、细节与设计备注" },
  { type: "reference_image", title: "上传图片", hint: "廓形、服装或灵感图" },
  { type: "swatch", title: "色彩参考", hint: "色号与配色说明" },
  { type: "sketch", title: "廓形草图", hint: "上传已绘制的草图" },
  { type: "trend", title: "趋势档案", hint: "引用趋势库的原始条目" },
  { type: "fabric", title: "面料库", hint: "引用现有面料记录" },
];

const toolInputHints = { analyze_brief: "需求与参考", generate_design: "约束与参考", evaluate_design: "候选与约束", edit_design: "候选" };
const TOOL_OPTIONS = getWorkflowToolCatalog().map((tool) => ({ type: tool.key, title: tool.name, hint: `${toolInputHints[tool.key]} → ${tool.output.type === "constraint" ? "设计约束" : tool.output.type === "evaluation" ? "评估报告" : "新的设计方案"}` }));

const PORT_LABELS: Readonly<Record<WorkflowInputPort, string>> = { candidate: "候选方案", constraint: "设计约束", goal: "设计目标", reference: "参考素材", source: "原图" };

function nodeShapeId(id: string): TLShapeId {
  return createShapeId(`workflow-node-${id}`);
}

function edgeShapeId(id: string): TLShapeId {
  return createShapeId(`workflow-edge-${id}`);
}

function graphNodePosition(editor: Editor, node: WorkflowNode) {
  const projected = editor.getShape<WorkflowNodeShape>(nodeShapeId(node.id));
  return projected && projected.type === WORKFLOW_NODE_SHAPE_TYPE
    ? { x: projected.x, y: projected.y }
    : { x: node.x, y: node.y };
}

function graphNodeSize(editor: Editor, node: WorkflowNode) {
  const projected = editor.getShape<WorkflowNodeShape>(nodeShapeId(node.id));
  return projected?.type === WORKFLOW_NODE_SHAPE_TYPE
    ? { w: projected.props.w, h: projected.props.h }
    : nodeSize(node);
}

function projectEdge(
  editor: Editor,
  graph: WorkflowGraph,
  edge: WorkflowGraph["edges"][number],
  highlighted: ReadonlySet<string> | null,
  proposed = false,
): void {
  const source = graph.nodes.find((node) => node.id === edge.sourceNodeId);
  const target = graph.nodes.find((node) => node.id === edge.targetNodeId);
  if (!source || !target) return;
  const sourcePosition = graphNodePosition(editor, source);
  const targetPosition = graphNodePosition(editor, target);
  const sourceSize = graphNodeSize(editor, source);
  const targetSize = graphNodeSize(editor, target);
  const x = sourcePosition.x + sourceSize.w;
  const y = sourcePosition.y + sourceSize.h / 2;
  const endX = targetPosition.x;
  const endY = targetPosition.y + targetSize.h / 2;
  const props = {
    edgeId: edge.id,
    endX: endX - x,
    endY: endY - y,
    detourY: endX < x ? Math.max(sourcePosition.y + sourceSize.h, targetPosition.y + targetSize.h) + 48 - y : 0,
    highlighted: highlighted?.has(edge.id) ?? false,
    proposed,
    editable: source.kind === "asset" && target.type !== "restore_version",
    label: source.kind === "tool" ? "结果来源" : PORT_LABELS[edge.targetPort],
  };
  const id = edgeShapeId(edge.id);
  const existing = editor.getShape<WorkflowEdgeShape>(id);
  if (existing?.type === WORKFLOW_EDGE_SHAPE_TYPE) {
    editor.updateShape<WorkflowEdgeShape>({ id, type: WORKFLOW_EDGE_SHAPE_TYPE, x, y, props });
  } else {
    editor.createShape<WorkflowEdgeShape>({ id, type: WORKFLOW_EDGE_SHAPE_TYPE, x, y, props });
  }
}

function WorkflowProjection({
  graph,
  onEditor,
  onLayout,
  onSelected,
  proposal,
  selectedId,
}: {
  readonly graph: WorkflowGraph;
  readonly onEditor: (editor: Editor) => void;
  readonly onLayout: (positions: readonly { nodeId: string; x: number; y: number }[]) => void;
  readonly onSelected: (id: string | null) => void;
  readonly proposal: WorkflowProposal | null;
  readonly selectedId: string | null;
}) {
  const editor = useEditor();
  const initialFit = useRef(false);
  const projectedPositions = useRef(new Map<string, { x: number; y: number }>());
  const selectedShapeId = useValue(
    "workflow-selected-shape",
    () => editor.getOnlySelectedShapeId(),
    [editor],
  );
  const lineage = selectedId ? lineageOf(graph, selectedId) : null;
  const proposedEdges = useMemo(() => (proposal?.operations ?? []).flatMap((operation) =>
    operation.type === "add_edge" ? [operation.edge] : [],
  ), [proposal]);
  const projectedGraph = useMemo(() => projectWorkflowProposal(graph, proposal), [graph, proposal]);

  useEffect(() => onEditor(editor), [editor, onEditor]);
  useEffect(() => { editor.user.updateUserPreferences({ colorScheme: "light" }); }, [editor]);
  useEffect(() => {
    const container = editor.getContainer();
    // Ancestor animations can move the viewport without triggering ResizeObserver.
    // Refresh before tldraw captures the drag origin, rather than during the gesture.
    const syncViewport = () => { editor.updateViewportScreenBounds(container); };
    container.addEventListener("pointerdown", syncViewport, true);
    return () => container.removeEventListener("pointerdown", syncViewport, true);
  }, [editor]);

  useEffect(() => {
    const shape = selectedShapeId ? editor.getShape(selectedShapeId) : undefined;
    onSelected(shape?.type === WORKFLOW_NODE_SHAPE_TYPE ? shape.props.nodeId : null);
  }, [editor, onSelected, selectedShapeId]);

  useEffect(() => {
    editor.store.mergeRemoteChanges(() => {
      const active = new Set<TLShapeId>();
      for (const node of projectedGraph.nodes) {
        const id = nodeShapeId(node.id);
        active.add(id);
        const existing = editor.getShape<WorkflowNodeShape>(id);
        const imageUrl = nodeImageUrl(node);
        const loadedImage = existing?.type === WORKFLOW_NODE_SHAPE_TYPE && existing.props.imageUrl === imageUrl
          ? { width: existing.props.imageWidth, height: existing.props.imageHeight }
          : { width: 0, height: 0 };
        const size = nodeSize(node, loadedImage);
        const props = {
          h: size.h,
          highlighted: node.status === "proposed" || (lineage?.nodeIds.has(node.id) ?? false),
          imageUrl,
          imageWidth: loadedImage.width,
          imageHeight: loadedImage.height,
          color: typeof node.payload.color === "string" ? node.payload.color : "",
          kind: node.kind,
          muted: node.status !== "proposed" && Boolean(lineage && !lineage.nodeIds.has(node.id)),
          nodeId: node.id,
          nodeType: node.type,
          status: node.status,
          summary: nodeSummary(node),
          title: displayNodeTitle(node),
          w: size.w,
        };
        if (existing?.type === WORKFLOW_NODE_SHAPE_TYPE) {
          const previous = projectedPositions.current.get(node.id);
          const positionChanged = !previous || previous.x !== node.x || previous.y !== node.y;
          editor.updateShape<WorkflowNodeShape>({
            id,
            props,
            type: WORKFLOW_NODE_SHAPE_TYPE,
            x: positionChanged ? node.x : existing.x,
            y: positionChanged ? node.y : existing.y,
          });
        } else {
          editor.createShape<WorkflowNodeShape>({
            id,
            props,
            type: WORKFLOW_NODE_SHAPE_TYPE,
            x: node.x,
            y: node.y,
          });
        }
        projectedPositions.current.set(node.id, { x: node.x, y: node.y });
      }
      for (const edge of projectedGraph.edges) {
        active.add(edgeShapeId(edge.id));
        projectEdge(editor, projectedGraph, edge, lineage?.edgeIds ?? null, proposedEdges.some((item) => item.id === edge.id));
      }
      const stale = editor.getCurrentPageShapes()
        .filter((shape) =>
          (shape.type === WORKFLOW_NODE_SHAPE_TYPE ||
            shape.type === WORKFLOW_EDGE_SHAPE_TYPE) &&
          !active.has(shape.id),
        )
        .map((shape) => shape.id);
      if (stale.length > 0) editor.deleteShapes(stale);
      editor.sendToBack(projectedGraph.edges.map((edge) => edgeShapeId(edge.id)));
    });
    if (!initialFit.current && graph.nodes.length > 0) {
      initialFit.current = true;
        const focus = graph.nodes.find((node) => node.id === selectedId)
          ?? graph.nodes.find((node) => node.type === "brief") ?? graph.nodes[0];
        if (!focus) return;
        const size = graphNodeSize(editor, focus);
        const zoom = 0.95;
        const viewport = editor.getViewportScreenBounds();
        editor.setCamera({ x: viewport.w / (2 * zoom) - focus.x - size.w / 2,
          y: viewport.h / (2 * zoom) - focus.y - size.h / 2, z: zoom });
    }
  }, [editor, graph, lineage, projectedGraph, proposedEdges, selectedId]);

  useEffect(() => editor.store.listen((entry) => {
    const resized = new Set(Object.values(entry.changes.updated).flatMap(([before, after]) =>
      before.typeName === "shape" && after.typeName === "shape" &&
      before.type === WORKFLOW_NODE_SHAPE_TYPE && after.type === WORKFLOW_NODE_SHAPE_TYPE &&
      (before.props.w !== after.props.w || before.props.h !== after.props.h)
        ? [after.props.nodeId] : [],
    ));
    if (resized.size === 0) return;
    // Image loading changes presentation only; keep wires aligned without saving layout.
    editor.store.mergeRemoteChanges(() => {
      for (const edge of projectedGraph.edges) {
        if (resized.has(edge.sourceNodeId) || resized.has(edge.targetNodeId))
          projectEdge(editor, projectedGraph, edge, lineage?.edgeIds ?? null, proposedEdges.some((item) => item.id === edge.id));
      }
    });
  }, { scope: "document" }), [editor, projectedGraph, lineage, proposedEdges]);

  useEffect(() =>
    editor.store.listen((entry) => {
      const authoritativeIds = new Set<TLShapeId>([
        ...projectedGraph.nodes.map((node) => nodeShapeId(node.id)),
        ...projectedGraph.edges.map((edge) => edgeShapeId(edge.id)),
      ]);
      const extraShapeIds = Object.values(entry.changes.added)
        .filter((record) => record.typeName === "shape" && !authoritativeIds.has(record.id as TLShapeId))
        .map((record) => record.id as TLShapeId);
      if (extraShapeIds.length > 0) {
        editor.store.mergeRemoteChanges(() => editor.deleteShapes(extraShapeIds));
      }
      const moved: { nodeId: string; x: number; y: number }[] = [];
      for (const [before, after] of Object.values(entry.changes.updated)) {
        if (
          before.typeName !== "shape" ||
          after.typeName !== "shape" ||
          after.type !== WORKFLOW_NODE_SHAPE_TYPE ||
          (before.x === after.x && before.y === after.y)
        ) continue;
        if (graph.nodes.some((node) => node.id === after.props.nodeId)) {
          moved.push({ nodeId: after.props.nodeId, x: after.x, y: after.y });
        }
      }
      if (moved.length === 0) return;
      editor.store.mergeRemoteChanges(() => {
        for (const edge of projectedGraph.edges) projectEdge(editor, projectedGraph, edge, lineage?.edgeIds ?? null, proposedEdges.some((item) => item.id === edge.id));
      });
      onLayout(moved);
    }, { scope: "document", source: "user" }),
  [editor, graph.nodes, projectedGraph, lineage, onLayout, proposedEdges]);

  return null;
}

export default function WorkflowCanvas({ projectId }: WorkflowCanvasProps) {
  const store = useMemo(() => createTLStore({
    bindingUtils: defaultBindingUtils,
    shapeUtils: [
      ...defaultShapeUtils,
      WorkflowNodeShapeUtil,
      WorkflowEdgeShapeUtil,
    ] as unknown as readonly TLAnyShapeUtilConstructor[],
  }), []);
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [proposal, setProposal] = useState<WorkflowProposal | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const executionConversation = useRef<Promise<string> | null>(null);
  const graphRef = useRef<WorkflowGraph | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const [projectName, setProjectName] = useState("设计项目");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuTab, setMenuTab] = useState<MenuTab | null>(null);
  const [draftType, setDraftType] = useState<WorkflowAssetType | null>(null);
  const [libraryKind, setLibraryKind] = useState<LibraryKind | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sketchOpen, setSketchOpen] = useState(false);
  const [workspaceAssetId, setWorkspaceAssetId] = useState<string | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"assistant" | "details">("assistant");
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"canvas" | "nodes" | "assistant">("canvas");
  const [sidebarWidth, setSidebarWidth] = useState<number>(STUDIO_LAYOUT.sidebarDefault);
  useEffect(() => {
    const resize = () => setSidebarWidth((width) => Math.max(STUDIO_LAYOUT.sidebarMin, Math.min(width, window.innerWidth - STUDIO_LAYOUT.canvasMin)));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const detailDirty = useRef(false);
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const discardReply = useRef<((accepted: boolean) => void) | null>(null);
  const beforeLeave = useCallback(() => {
    if (!detailDirty.current) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      discardReply.current = (accepted) => { if (accepted) { detailDirty.current = false; resolve(); } else reject(new Error("保留未保存的参数")); };
      setDiscardAction(() => () => undefined);
    });
  }, []);
  const resizeSidebar = (width: number) => setSidebarWidth(Math.max(STUDIO_LAYOUT.sidebarMin, Math.min(STUDIO_LAYOUT.sidebarMax, window.innerWidth - STUDIO_LAYOUT.canvasMin, width)));
  const cancelDiscard = () => {
    discardReply.current?.(false); discardReply.current = null; setDiscardAction(null);
    setActiveTab("details"); setSidebarOpen(true); setMobileView("assistant");
    if (inspectedId) { setSelectedId(inspectedId); editorRef.current?.select(nodeShapeId(inspectedId)); }
  };
  const hasUnsavedDetails = useCallback(() => detailDirty.current, []);
  const updateDetailDirty = useCallback((dirty: boolean) => { detailDirty.current = dirty; }, []);
  const selectNode = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);
  const openDetails = useCallback((id: string) => {
    const show = () => {
      detailDirty.current = false;
      setSelectedId(id); setInspectedId(id); setActiveTab("details"); setSidebarOpen(true); setMobileView("assistant");
      editorRef.current?.select(nodeShapeId(id));
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-label="设计助手与节点详情"] h2')?.focus());
    };
    if (id !== inspectedId && detailDirty.current) setDiscardAction(() => show);
    else { setSelectedId(id); setInspectedId(id); setActiveTab("details"); setSidebarOpen(true); setMobileView("assistant"); }
  }, [inspectedId]);
  const pendingInputEdits = useRef(new Map<string, { planned: PlannedInputEdit; mutationId: string; baseRevision: number }>());
  const uploadRef = useRef<HTMLInputElement>(null);
  const mutationQueue = useRef<Promise<unknown>>(Promise.resolve());
  const layoutQueueRef = useRef<WorkflowLayoutSave | null>(null);
  const ensureConversation = async (): Promise<string> => {
    if (activeConversationId) return activeConversationId;
    if (!executionConversation.current) executionConversation.current = createAgentConversation(projectId, { mode: "workflow" }).then((created) => {
      setActiveConversationId(created.id);
      window.dispatchEvent(new CustomEvent("fashion-workflow:conversation", { detail: { id: created.id } }));
      return created.id;
    }).finally(() => { executionConversation.current = null; });
    return executionConversation.current;
  };

  const commitGraph = useCallback((next: WorkflowGraph) => {
    const previous = graphRef.current;
    if (previous && (next.revision < previous.revision ||
      (next.revision === previous.revision && next.layoutRevision < previous.layoutRevision))) return;
    if (previous && next.layoutRevision < previous.layoutRevision) {
      const priorPositions = new Map(previous.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
      next = {
        ...next,
        layoutRevision: previous.layoutRevision,
        nodes: next.nodes.map((node) => ({ ...node, ...(priorPositions.get(node.id) ?? {}) })),
      };
    }
    const previousRevision = previous?.revision;
    graphRef.current = next;
    const optimistic = new Map(layoutQueueRef.current?.getPositions().map((position) => [position.nodeId, position]) ?? []);
    setGraph(optimistic.size ? { ...next, nodes: next.nodes.map((node) => ({ ...node, ...(optimistic.get(node.id) ?? {}) })) } : next);
    if (next.proposals) {
      const pending = next.proposals;
      setProposal((current) => current ? pending.find((item) => item.id === current.id && item.status === "pending") ?? null : null);
    }
    else if (previousRevision !== next.revision) setProposal(null);
  }, []);

  const graphFlight = useRef<{ projectId: string; promise: Promise<WorkflowGraph>; signal: AbortSignal | null } | null>(null);
  const loadGraph = useCallback((signal?: AbortSignal) => {
    if (graphFlight.current?.projectId === projectId && !graphFlight.current.signal?.aborted) return graphFlight.current.promise;
    const promise = fetchWorkflow(projectId, signal).finally(() => { if (graphFlight.current?.promise === promise) graphFlight.current = null; });
    graphFlight.current = { projectId, promise, signal: signal ?? null };
    return promise;
  }, [projectId]);
  const reload = useCallback(async () => {
    const next = await loadGraph();
    commitGraph(next);
    return next;
  }, [commitGraph, loadGraph]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void Promise.all([loadGraph(controller.signal), fetchProject(projectId)]).then(
      ([next, project]) => {
        if (!active) return;
        commitGraph(next);
        setProjectName(project.name);
        setLoading(false);
      },
      (cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "工作流加载失败");
        setLoading(false);
      },
    );
    return () => { active = false; controller.abort(); };
  }, [commitGraph, projectId, loadGraph]);

  const sync = useSerialPolling(projectId, Boolean(graph?.nodes.some((node) => node.status === "running" || node.status === "pending" ||
    ((node.type === "reference_image" || node.type === "sketch") && node.payload.roleInferenceState === "pending" && node.payload.roleSource !== "manual"))), 3000, async (signal) => {
    const next = await loadGraph(signal);
    signal.throwIfAborted(); commitGraph(next);
  });

  useEffect(() => {
    const refresh = () => { void reload().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "工作流刷新失败")); };
    window.addEventListener("fashion-workflow:refresh", refresh);
    return () => window.removeEventListener("fashion-workflow:refresh", refresh);
  }, [reload]);

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const queued = mutationQueue.current.catch(() => undefined).then(task);
    mutationQueue.current = queued.catch(() => undefined);
    return queued;
  }, []);

  const mutate = useCallback((operations: readonly WorkflowOperation[]) =>
    enqueue(async () => {
      const current = graphRef.current;
      if (!current) throw new Error("工作流仍在加载");
      try {
        const next = await patchWorkflow(projectId, {
          baseRevision: current.revision,
          mode: "semantic",
          mutationId: crypto.randomUUID(),
          operations,
        });
        commitGraph(next);
        setNotice("设计路径已保存");
        setError(null);
        return next;
      } catch (cause) {
        if (cause instanceof WorkflowApiError && cause.status === 409) await reload();
        throw cause;
      }
    }), [commitGraph, enqueue, projectId, reload]);

  const layoutSave = useWorkflowLayoutSave(async (batch) => enqueue(async () => {
    const current = graphRef.current;
    if (!current) throw new Error("工作流仍在加载");
    const request = batch.request ??= { mutationId: batch.mutationId, baseLayoutRevision: current.layoutRevision, positions: batch.positions };
    try {
      commitGraph(await patchWorkflow(projectId, {
        ...request, mode: "layout",
      }));
    } catch (cause) {
      if (!(cause instanceof WorkflowApiError) || cause.status !== 409) throw cause;
      const fresh = await reload();
      const ids = new Set(fresh.nodes.map((node) => node.id));
      const positions = batch.positions.filter((position) => ids.has(position.nodeId));
      if (positions.length) {
        batch.request = { baseLayoutRevision: fresh.layoutRevision, mutationId: crypto.randomUUID(), positions };
        commitGraph(await patchWorkflow(projectId, { ...batch.request, mode: "layout" }));
      }
    }
    setError(null);
  }), (cause) => setError(cause instanceof Error ? cause.message : "节点位置保存失败"), beforeLeave, hasUnsavedDetails);
  useLayoutEffect(() => { layoutQueueRef.current = layoutSave.queue; }, [layoutSave.queue]);
  const saveLayout = useCallback((positions: readonly { nodeId: string; x: number; y: number }[]) => {
    layoutSave.queue.stage(positions);
  }, [layoutSave.queue]);

  const editInput = useCallback((edit: InputEdit) => enqueue(async () => {
    const current = graphRef.current;
    if (!current) throw new Error("工作流仍在加载");
    const key = JSON.stringify(edit);
    const packet = pendingInputEdits.current.get(key) ?? {
      planned: planInputEdit(current, edit), mutationId: crypto.randomUUID(), baseRevision: current.revision,
    };
    pendingInputEdits.current.set(key, packet);
    try {
      const next = await patchWorkflow(projectId, { mode: "semantic", baseRevision: packet.baseRevision, mutationId: packet.mutationId, operations: packet.planned.operations });
      commitGraph(next);
      pendingInputEdits.current.delete(key);
      setSelectedId(packet.planned.targetId);
      requestAnimationFrame(() => {
        editorRef.current?.select(nodeShapeId(packet.planned.targetId));
        if (packet.planned.branched) editorRef.current?.zoomToSelection(motionOptions());
      });
      setNotice(packet.planned.maskCleared ? `${packet.planned.branched ? "已建立新分支；" : ""}更换原图后，请重新框选局部区域` : packet.planned.branched ? "已建立新分支" : "连接已保存");
      setError(null);
    } catch (cause) {
      if (cause instanceof WorkflowApiError && cause.status === 409) { pendingInputEdits.current.delete(key); await reload(); }
      throw cause;
    }
  }), [commitGraph, enqueue, projectId, reload]);

  const selected = graph?.nodes.find((node) => node.id === selectedId) ?? null;
  const inspected = graph?.nodes.find((node) => node.id === inspectedId) ?? null;
  const path = graph && inspected ? lineageOf(graph, inspected.id) : null;

  const addNode = useCallback(async (
    kind: "asset" | "tool",
    type: AddKind,
    title: string,
    payload: Readonly<Record<string, unknown>>,
  ) => {
    const current = graphRef.current;
    if (!current) throw new Error("工作流尚未加载完成，请稍后再试");
    const selectedNode = current.nodes.find((node) => node.id === selectedId);
    const viewport = editorRef.current?.getViewportPageBounds();
    const x = selectedNode
      ? selectedNode.x + (editorRef.current ? graphNodeSize(editorRef.current, selectedNode).w : nodeSize(selectedNode).w) + 130
      : (viewport?.center.x ?? 320) - 130;
    const y = selectedNode ? selectedNode.y + (selectedNode.kind === kind ? 240 : 0) : (viewport?.center.y ?? 240) - 105;
    const id = crypto.randomUUID();
    const operations: WorkflowOperation[] = [{
      node: { id, kind, type, title: title.trim(), payload, x, y },
      type: "add_node",
    }];
    setBusy(true);
    try {
      await mutate(operations);
      setSelectedId(id);
      setMenuTab(null);
      setDraftType(null);
      requestAnimationFrame(() => {
        editorRef.current?.select(nodeShapeId(id));
        editorRef.current?.zoomToSelection(motionOptions());
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "节点添加失败");
      throw cause;
    } finally {
      setBusy(false);
    }
    return id;
  }, [mutate, selectedId]);

  const handleAssetOption = (type: WorkflowAssetType) => {
    if (type === "sketch") {
      setSketchOpen(true);
      setMenuTab(null);
      return;
    }
    if (type === "reference_image") {
      setDraftType(type);
      uploadRef.current?.click();
      return;
    }
    if (type === "trend" || type === "fabric") {
      setLibraryKind(type);
      setMenuTab(null);
      return;
    }
    setDraftType(type);
    setMenuTab(null);
  };

  const handleUpload = async (file: File) => {
    const validation = validateImage(file);
    if (validation) { setError(validation); return; }
    setBusy(true);
    setError(null);
    try {
      const signed = await signImageUpload(projectId, file);
      const processing = signed.upload
        ? await putOriginal(signed.upload, file).then(() => completeUpload(signed.file.id))
        : signed.file;
      const ready = await waitForThumbnail(signed.file.id, processing);
      const nodeId = await addNode("asset", "reference_image", file.name, {
        fileAssetId: ready.id,
        width: ready.width,
        height: ready.height,
        imageUrl: ready.thumbnail1024Url ?? ready.thumbnail256Url ?? "",
        sourceName: file.name,
        role: "style_ref",
        roleSource: "default",
        roleInferenceState: "pending",
      });
      try {
        commitGraph(await inferWorkflowNodeRole(projectId, nodeId));
      } catch (cause) {
        setError(`图片已加入工作流；角色识别暂不可用，可在节点详情重试或手动选择。${cause instanceof Error ? ` ${cause.message}` : ""}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "素材上传失败");
    } finally {
      setBusy(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };


  const importLegacy = async (item: LegacyBoardImport) => {
    const payload = item.payload;
    const type: WorkflowAssetType = item.type === "image" ? "reference_image" : item.type === "swatch" ? "swatch" : "reference_text";
    await addNode("asset", type, item.title, {
      boardElementId: item.shapeId,
      ...(typeof payload.assetId === "string" ? { assetId: payload.assetId } : {}),
      ...(typeof payload.fileId === "string" ? { fileAssetId: payload.fileId } : {}),
      ...(typeof payload.url === "string" ? { imageUrl: payload.url } : {}),
      ...(typeof payload.text === "string" ? { text: payload.text } : {}),
      ...(typeof payload.color === "string" ? { color: payload.color } : {}),
      legacyBoard: payload.legacyBoard,
    });
  };

  const exportCanvas = async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const shapeIds = editor.getCurrentPageShapes().map((shape) => shape.id);
    if (shapeIds.length === 0) { setError("画布为空，请先添加节点"); return; }
    setExporting(true);
    try {
      const rendered = await editor.toImage(shapeIds, { background: true, format: "png", padding: 64, pixelRatio: 2 });
      const url = URL.createObjectURL(rendered.blob);
      const link = document.createElement("a");
      link.download = `fashion-workflow-${projectId}.png`;
      link.href = url;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "工作流导出失败");
    } finally { setExporting(false); }
  };

  if (loading) return <BoardSkeleton />;
  if (!graph) return (
    <main className={styles.loadError}>
      <h1>设计工作流暂时无法打开</h1>
      <p role="alert">{userFacingError(error, "设计画布暂时无法加载，请重试")}</p>
      <button onClick={() => { setLoading(true); void reload().then(() => setLoading(false), () => setLoading(false)); }} type="button">重新加载</button>
    </main>
  );

  return (
    <main className={styles.shell} style={{ "--studio-sidebar-width": `${sidebarWidth}px` } as CSSProperties} onKeyDownCapture={(event) => { if (event.key === "Tab" && !(event.target instanceof Element && event.target.closest("dialog[open]"))) event.stopPropagation(); }}>
      <header className={styles.topbar}>
        <div className={styles.brandGroup}>
          <Link aria-label="返回项目库" className={styles.brandIcon} href="/">◆</Link>
          <strong className={styles.brand}>Atelier 设计工作室</strong>
          <span className={styles.topDivider} />
          <span className={styles.projectName}>{projectName}</span>
          <span className={styles.workflowBadge}>设计工作流</span>
        </div>
        <div className={`${styles.topActions} ${controls.controlSurface}`}>
          <details className={styles.syncStatus} open={sync.error || layoutSave.state === "error" ? true : undefined}>
            <summary className={styles.saved} data-save-state={sync.error ? "error" : layoutSave.state}><span aria-hidden="true" />{sync.error ? "同步异常" : layoutSave.state === "error" ? "画布未保存" : layoutSave.state === "dirty" ? "有未保存的位置" : layoutSave.state === "saving" ? "正在保存画布…" : busy ? "正在处理" : "画布已保存"}</summary>
            <div>{layoutSave.pendingCount > 0 ? <p aria-label="待保存节点数">{layoutSave.pendingCount} 个节点待保存</p> : <p>所有节点位置已保存</p>}{sync.lastSuccess ? <p>最近同步 {new Date(sync.lastSuccess).toLocaleTimeString("zh-CN")}</p> : null}{sync.error ? <p role="status">画布同步异常：{sync.error}<Button onClick={sync.retry}>重试同步</Button></p> : null}{layoutSave.state === "error" ? <Button onClick={() => void layoutSave.queue.flush().catch(() => undefined)}>重试保存</Button> : null}</div>
          </details>
          <Link href={`/${encodeURIComponent(projectId)}/studio`}>款式与交付</Link>
          <Link href={`/trends?from=board&boardId=${encodeURIComponent(projectId)}`}>趋势</Link>
          <Link href={`/fabrics?from=board&boardId=${encodeURIComponent(projectId)}`}>面料</Link>
          {graph.legacyAvailable ? <button onClick={() => setHistoryOpen(true)} type="button">历史白板</button> : null}
          <button data-export disabled={exporting} onClick={() => void exportCanvas()} type="button">{exporting ? "导出中…" : "导出画布 PNG"}</button>
          {!sidebarOpen ? <button aria-label="展开设计助手" onClick={() => { setSidebarOpen(true); setActiveTab("assistant"); setMobileView("assistant"); }} type="button">设计助手</button> : null}
        </div>
      </header>

      <div className={styles.mobileViews}><SegmentedControl label="工作视图" value={mobileView} options={[{ value: "canvas", label: "画布" }, { value: "nodes", label: "节点列表" }, { value: "assistant", label: "助手" }]} onChange={(view) => { setMobileView(view); setMobileListOpen(view === "nodes"); if (view === "assistant") setSidebarOpen(true); }} /></div>
      <div className={styles.workspace} data-mobile-view={mobileView} data-sidebar-open={sidebarOpen ? "true" : "false"}>
        <section aria-label="设计工作流画布" className={styles.canvasSection} data-mobile-list-open={mobileListOpen ? "true" : "false"}>
          <div className={styles.canvasHeading}>
            <div>
              <span className={styles.overline}>设计轨迹</span>
              <h1>从需求到方案的完整设计路径</h1>
              <p>素材、工具和结果逐步连接；修改会形成可回溯的分支。</p>
            </div>
            <button className={styles.mobileListToggle} onClick={() => setMobileListOpen((current) => !current)} type="button">
              {mobileListOpen ? "查看画布" : "节点列表"}
            </button>
          </div>

          <div className={styles.canvas} data-mobile-list-open={mobileListOpen ? "true" : "false"} onPasteCapture={(event) => { event.preventDefault(); event.stopPropagation(); }}>
            <WorkflowInteractionProvider graph={graph} editorRef={editorRef} onEdit={editInput} onDetails={openDetails}>
            <Tldraw hideUi locale="zh-cn" options={{ createTextOnCanvasDoubleClick: false }} overrides={workflowUiOverrides} shapeUtils={[WorkflowNodeShapeUtil, WorkflowEdgeShapeUtil]} store={store} {...(tldrawLicenseKey ? { licenseKey: tldrawLicenseKey } : {})}>
              <WorkflowProjection
                graph={graph}
                onEditor={(editor) => { editorRef.current = editor; }}
                onLayout={saveLayout}
                onSelected={selectNode}
                proposal={proposal}
                selectedId={selectedId}
              />
              <WorkflowConnectionOverlay graph={graph} />
            </Tldraw>
            </WorkflowInteractionProvider>
            {graph.nodes.length === 0 ? (
              <div className={styles.emptyState}>
                <span>开始创作</span>
                <h2>从一条设计需求开始</h2>
                <p>记录场景和目标，再把参考、工具与生成结果连成完整路径。</p>
                <button onClick={() => handleAssetOption("brief")} type="button">添加设计需求</button>
              </div>
            ) : null}
          </div>

          {mobileListOpen ? (
            <div className={styles.mobileNodeList} role="list">
              {graph.nodes.map((node) => (
                <button key={node.id} onClick={() => openDetails(node.id)} role="listitem" type="button">
                  <small>{node.kind === "asset" ? "素材" : "工具"}</small>
                  <strong>{node.title}</strong>
                  <span>{nodeSummary(node)}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className={`${styles.zoomControls} ${controls.controlSurface}`}>
            <button aria-label="缩小画布" onClick={() => editorRef.current?.zoomOut()} type="button">−</button>
            <button aria-label="适合画布" onClick={() => editorRef.current?.zoomToFit(motionOptions())} type="button">查看全图</button>
            <button aria-label="画布原始比例" onClick={() => editorRef.current?.resetZoom()} type="button">100%</button>
            <button aria-label="放大画布" onClick={() => editorRef.current?.zoomIn()} type="button">＋</button>
          </div>

          <div className={`${styles.bottomMenu} ${controls.controlSurface}`}>
            <button data-material-trigger aria-expanded={menuTab === "assets"} onClick={() => setMenuTab(menuTab === "assets" ? null : "assets")} type="button">＋ 添加素材</button>
            <span className={styles.menuDivider} />
            <button aria-expanded={menuTab === "tools"} onClick={() => setMenuTab(menuTab === "tools" ? null : "tools")} type="button">＋ 添加工具</button>
            <Tooltip content="查看素材、连线、保存与导出操作说明"><Button aria-label="工作室帮助" variant="ghost" onClick={() => setHelpOpen(true)}>?</Button></Tooltip>
            {menuTab ? (
              <div className={styles.addPopover}>
                <header><strong>{menuTab === "assets" ? "添加设计素材" : "添加设计工具"}</strong><button aria-label="关闭菜单" onClick={() => setMenuTab(null)} type="button">×</button></header>
                {(menuTab === "assets" ? ASSET_OPTIONS : TOOL_OPTIONS).map((option) => (
                  <button key={option.type} onClick={() => {
                    if (menuTab === "assets") handleAssetOption(option.type as WorkflowAssetType);
                    else { const tool = getWorkflowToolContract(option.type as WorkflowToolKey); void addNode("tool", option.type, option.title, { toolKey: tool.key, toolVersion: tool.version, params: { ...tool.defaults, prompt: "" } }).catch(() => undefined); }
                  }} type="button">
                    <strong>{option.title}</strong><span>{option.hint}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {!sidebarOpen && (error || notice) ? <div aria-live="polite" className={`${error ? styles.errorNotice : styles.successNotice} ${styles.canvasNotice}`} role={error ? "alert" : "status"}>{error ? userFacingError(error) : notice}<button aria-label="关闭提示" onClick={() => { setError(null); setNotice(null); }} type="button">×</button></div> : null}
        </section>

        {sidebarOpen ? <div aria-label="调整侧栏宽度" aria-orientation="vertical" aria-valuemin={STUDIO_LAYOUT.sidebarMin} aria-valuemax={STUDIO_LAYOUT.sidebarMax} aria-valuenow={sidebarWidth} className={styles.sidebarResizer} role="separator" tabIndex={0} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); resizeSidebar(sidebarWidth + (event.key === "ArrowLeft" ? STUDIO_LAYOUT.resizeStep : -STUDIO_LAYOUT.resizeStep)); } }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeSidebar(window.innerWidth - event.clientX); }} onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); }} /> : null}
        <aside aria-label="设计助手与节点详情" className={`${styles.sidebar} ${controls.controlSurface}`} hidden={!sidebarOpen}>
          <div className={styles.sidebarHeader}>
            <h2 tabIndex={-1}>{activeTab === "details" ? "节点详情" : "设计助手"}</h2>
            <div className={styles.sidebarActions}>
              {activeTab === "details" ? <button className={styles.sidebarNavigation} onClick={() => setActiveTab("assistant")} type="button">返回对话</button> : selected ? <button className={styles.sidebarNavigation} onClick={() => openDetails(selected.id)} type="button">节点详情</button> : null}
              <button aria-label="收起设计助手" className={styles.sidebarCollapse} onClick={() => { setSidebarOpen(false); setMobileView("canvas"); }} type="button">收起</button>
            </div>
          </div>
          <div className={styles.detailsMount} hidden={activeTab !== "details"}>
            <NodeDetails
              graph={graph}
              key={inspected?.id ?? "none"}
              onDirtyChange={updateDetailDirty}
              node={inspected}
              onCreateCollection={async (nodeId, assetId) => {
                setBusy(true);
                try {
                  const linked = graphRef.current?.nodes.find((item) => item.id === nodeId)?.payload.collectionId;
                  if (typeof linked === "string" && linked) { setCollectionId(linked); return; }
                  const collection = await createCollection(assetId);
                  await mutate([{ type: "link_collection", nodeId, collectionId: collection.id }]);
                  setCollectionId(collection.id);
                }
                catch (cause) { setError(cause instanceof Error ? cause.message : "系列创建失败"); }
                finally { setBusy(false); }
              }}
              onOpenAsset={setWorkspaceAssetId}
              onDelete={async (nodeId) => {
                await mutate([{ type: "remove_node", nodeId }]); setSelectedId(null);
              }}
              path={path}
              projectId={projectId}
              onEnsureConversation={ensureConversation}
              onGraphChange={commitGraph}
              onSavePayload={async (nodeId, payload) => { await mutate([{ type: "update_node", nodeId, payload }]); }}
              onInferRole={async (nodeId) => {
                try { commitGraph(await inferWorkflowNodeRole(projectId, nodeId)); setNotice("参考图角色已更新"); }
                catch (cause) { setError(cause instanceof Error ? cause.message : "参考图角色识别失败"); }
              }}
              setError={setError}
            />
          </div>
          <div className={styles.assistantMount} hidden={activeTab !== "assistant"}>
            <WorkflowAssistantPanel graph={graph} onConversationChange={setActiveConversationId} onGraphChange={commitGraph} onNotice={setNotice} onError={setError} onProposal={setProposal} projectId={projectId} selected={selected} onLocate={(nodeId) => { setSelectedId(nodeId); editorRef.current?.select(nodeShapeId(nodeId)); editorRef.current?.zoomToSelection(motionOptions()); }} renderLegacyRuns={(conversationId) => <LegacyRunHistory conversationId={conversationId} onError={setError} />} />
          </div>
          {sidebarOpen && (error || notice) ? <div aria-live="polite" className={error ? styles.errorNotice : styles.successNotice} role={error ? "alert" : "status"}>{error ? userFacingError(error) : notice}<button aria-label="关闭提示" onClick={() => { setError(null); setNotice(null); }} type="button">×</button></div> : null}
        </aside>
      </div>

      {discardAction ? <Dialog label="保留未保存的参数" onClose={cancelDiscard}><div className={styles.entryDialog}><h2>参数尚未保存</h2><p>继续会放弃当前节点的修改。也可以返回，先保存参数。</p><div className={styles.dialogActions}><Button onClick={cancelDiscard}>返回编辑</Button><Button variant="danger" onClick={() => { discardReply.current?.(true); discardReply.current = null; discardAction(); setDiscardAction(null); }}>放弃修改并继续</Button></div></div></Dialog> : null}
      <input accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleUpload(file); }} ref={uploadRef} type="file" />
      {draftType && draftType !== "reference_image" && draftType !== "sketch" ? (
        <WorkflowMaterialEntry key={draftType} type={draftType} initialTitle={ASSET_OPTIONS.find((item) => item.type === draftType)?.title ?? "参考素材"} busy={busy} onClose={() => setDraftType(null)}
          onAdd={async (title, payload) => { await addNode("asset", draftType, title, payload); }} />
      ) : null}
      {libraryKind ? <WorkflowLibraryDialog kind={libraryKind} onClose={() => setLibraryKind(null)} onAdd={async (item) => {
        await addNode("asset", libraryKind, item.label.slice(0, 200), {
          [libraryKind === "trend" ? "trendItemId" : "fabricId"]: item.id,
          imageUrl: item.imageUrl, text: item.summary, ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
        });
        setLibraryKind(null);
      }} /> : null}
      {historyOpen ? <LegacyBoardHistory onClose={() => setHistoryOpen(false)} onImport={importLegacy} projectId={projectId} /> : null}
      {helpOpen ? <Dialog label="工作室使用帮助" onClose={() => setHelpOpen(false)}><div className={styles.entryDialog}><h2>开始你的设计</h2><ol><li>通过“添加素材”上传参考图、绘制草图，或选择面料与趋势素材。</li><li>添加工具，将素材右侧连接点拖到工具的输入位置。</li><li>单击选择节点，打开“节点详情”设置参数，保存后确认执行。</li><li>在助手输入框描述目标，或用 @ 引用画布内容；提案需确认后才会加入画布。</li><li>画布位置会自动保存。顶部保存状态可查看同步时间并重试失败操作。</li><li>“导出画布 PNG”保存设计路径。候选图与系列在各自工作区导出交付文件，关闭窗口不会取消任务。</li></ol><Button variant="primary" onClick={() => setHelpOpen(false)}>知道了</Button></div></Dialog> : null}
      {workspaceAssetId ? <BoardProjectContext.Provider value={projectId}><WorkflowAssetWorkspace assetId={workspaceAssetId} onEnsureConversation={ensureConversation} onClose={() => setWorkspaceAssetId(null)} onGraphRefresh={() => { void reload().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "工作流刷新失败")); }} open projectId={projectId} /></BoardProjectContext.Provider> : null}
      <WorkflowSketchEditor onClose={() => setSketchOpen(false)} onCreated={async ({ fileAssetId, title, imageUrl }) => {
        const nodeId = await addNode("asset", "sketch", title, {
          fileAssetId,
          ...(imageUrl ? { imageUrl } : {}),
          source: "designer_sketch",
          role: "silhouette_ref",
          roleSource: "default",
          roleInferenceState: "pending",
        });
        try { commitGraph(await inferWorkflowNodeRole(projectId, nodeId)); }
        catch (cause) { setError(`草图已保存；角色识别暂不可用，可在节点详情重试。${cause instanceof Error ? ` ${cause.message}` : ""}`); }
      }} open={sketchOpen} projectId={projectId} />
      {collectionId ? <BoardProjectContext.Provider value={projectId}><GenerationWorkspace><CollectionDrawer collectionId={collectionId} onClose={() => setCollectionId(null)} /></GenerationWorkspace></BoardProjectContext.Provider> : null}
    </main>
  );
}

function LegacyRunHistory({ conversationId, onError }: {
  readonly conversationId: string;
  readonly onError: (message: string | null) => void;
}) {
  const [runs, setRuns] = useState<readonly AgentRunView[]>([]);
  const [selected, setSelected] = useState<AgentRunView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void listAgentRuns(conversationId).then((page) => {
      if (active) { setRuns(page.items); setLoading(false); }
    }).catch((cause: unknown) => {
      if (active) { setLoading(false); onError(cause instanceof Error ? cause.message : "旧设计运行读取失败"); }
    });
    return () => { active = false; };
  }, [conversationId, onError]);

  const open = async (runId: string) => {
    setLoading(true);
    try {
      setSelected(await fetchAgentRun(runId));
    } catch (cause) { onError(cause instanceof Error ? cause.message : "旧设计运行详情读取失败"); }
    finally { setLoading(false); }
  };

  return <section aria-label="旧设计运行历史" className={styles.legacyRuns}>
    <h3>旧设计运行 · 只读</h3>
    <p>这些记录保留原来的目标、步骤、尝试与人工选择。后续设计请在主画布创建新分支。</p>
    {loading && runs.length === 0 ? <p>正在读取旧运行…</p> : null}
    {!loading && runs.length === 0 ? <p>当前会话没有旧设计运行。</p> : null}
    <div className={styles.legacyRunList}>{runs.map((run) => <button aria-pressed={selected?.id === run.id} key={run.id} onClick={() => void open(run.id)} type="button"><strong>{run.intent || "未命名设计目标"}</strong><span>{run.status} · {new Date(run.createdAt).toLocaleString("zh-CN")}</span></button>)}</div>
    {selected ? <div aria-label="旧运行详情" className={styles.legacyRunDetail} role="region">
      <h4>{selected.intent || "未命名设计目标"}</h4>
      <p>运行状态：{selected.status}</p>
      {selected.intelligence?.brief ? <section><h5>设计简报</h5><p>{selected.intelligence.brief.summary}</p>{selected.intelligence.brief.constraints.map((constraint) => <p key={constraint.id}>{constraint.priority === "must" ? "必须" : "偏好"} · {constraint.requirement}</p>)}</section> : null}
      <section><h5>节点与尝试</h5><ol>{selected.steps.map((step) => <li key={step.id}>
        <strong>{step.ordinal + 1}. {step.title} · {step.status}</strong>
        <p>{step.instruction}</p>
        {step.prompt ? <p>提示词：{step.prompt}</p> : null}
        {step.sourceAssetId ? <p>来源资产：{step.sourceAssetId}</p> : null}
        {step.selectedAssetId ? <p>人工选定：{step.selectedAssetId}</p> : null}
        {step.attempts?.map((attempt) => <div className={styles.legacyAttempt} key={attempt.id}><strong>尝试 {attempt.ordinal} · {attempt.status}</strong><p>提示词：{attempt.prompt}</p>{attempt.parentAssetId ? <p>母图：{attempt.parentAssetId}</p> : null}{attempt.candidates.length ? <p>候选：{attempt.candidates.map((candidate) => candidate.assetId).join("、")}</p> : null}{attempt.error ? <p>{attempt.status === "rejected" ? "否决理由" : "错误"}：{attempt.error}</p> : null}</div>)}
      </li>)}</ol></section>
      {selected.intelligence?.actions.length ? <section><h5>领域评价与修订</h5>{selected.intelligence.actions.map((action) => <div className={styles.legacyAttempt} key={action.id}><strong>{action.kind === "evaluate_candidate" ? "候选评价" : "修订建议"} · {action.status}</strong>{action.evaluation ? <p>{action.evaluation.summary}</p> : null}{action.refinement ? <><p>{action.refinement.summary}</p><p>建议提示词：{action.refinement.prompt}</p></> : null}{action.error ? <p>{action.error}</p> : null}</div>)}</section> : null}
    </div> : null}
  </section>;
}
