"use client";
import { useSidebarResize } from "./use-sidebar-resize";
import { useWorkspaceLayout } from "./use-workspace-layout";
import { WorkflowProjectPanels } from "./WorkflowProjectPanels";
import { DesignWorkbench } from "./DesignWorkbench";
import { markResultArrival } from "./result-arrivals";
import { ImageResultArrivals } from "./image-result-arrivals";
import { markMotion } from "../../../components/motion/events";
import { MotionReceipt } from "../../../components/motion/MotionReceipt";
import { useAuth } from "../../auth/AuthProvider";
import { readSwatchColors } from "@fashion/shared";
import { WorkflowImageInputs } from "./WorkflowImageInputs";
import { WorkflowDetailWorkspace, type DetailOrigin } from "./WorkflowDetailWorkspace";
import { WorkspaceDraftProvider, WorkspaceDraftStore, useWorkspaceDraftRevision } from "./workspace-drafts";
import detailStyles from "./workflow-detail-workspace.module.css";

import Link from "next/link";
import { AppHeader } from "../../../components/AppHeader";
import {
  Button,
  Dialog,
  Menu,
  SegmentedControl,
  Tooltip,
  TooltipGroup,
} from "../../../components/ui";
import { STUDIO_LAYOUT, motionOptions } from "../../../components/ui-config";
import controls from "../../../components/ui.module.css";
import type { CSSProperties } from "react";
import type { AgentRunView } from "@fashion/shared";
import {
  getWorkflowToolCatalog,
  getWorkflowToolContract,
  type WorkflowToolKey,
} from "@fashion/shared";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  LegacyBoardHistory,
  type LegacyBoardImport,
} from "./LegacyBoardHistory";
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
  edgeRelation,
  focusPathOf,
  lineageOf,
  nodeDepths,
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
import {
  WORKFLOW_EDGE_SHAPE_TYPE,
  WorkflowEdgeShapeUtil,
  type WorkflowEdgeShape,
} from "./WorkflowEdgeShape";
import {
  WorkflowInteractionProvider,
  WorkflowConnectionOverlay,
} from "./WorkflowInteractions";
import {
  planInputEdit,
  type InputEdit,
  type PlannedInputEdit,
} from "./workflow-editing";
import { WorkflowAssistantPanel } from "./WorkflowAssistantPanel";
import { useWorkflowLayoutSave } from "./use-workflow-layout-save";
import type { WorkflowLayoutSave } from "./workflow-layout-save";
import { NodeDetails } from "./WorkflowNodeDetails";
import {
  WorkflowMaterialEntry,
  WorkflowLibraryDialog,
} from "./WorkflowMaterialDialogs";
import { useSerialPolling } from "../../use-serial-polling";

const tldrawLicenseKey = process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY;
const cameraActionIds = new Set([
  "zoom-in",
  "zoom-in-on-cursor",
  "zoom-out",
  "zoom-out-on-cursor",
  "zoom-to-100",
  "zoom-to-fit",
  "zoom-to-selection",
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

const ASSET_OPTIONS: readonly {
  type: WorkflowAssetType;
  title: string;
  hint: string;
}[] = [
  { type: "brief", title: "设计需求", hint: "目标、场景、必需条件" },
  { type: "reference_text", title: "文字参考", hint: "风格、细节与设计备注" },
  { type: "reference_image", title: "上传图片", hint: "廓形、服装或灵感图" },
  { type: "swatch", title: "色彩参考", hint: "色号与配色说明" },
  { type: "sketch", title: "廓形草图", hint: "上传已绘制的草图" },
  { type: "trend", title: "趋势档案", hint: "引用趋势库的原始条目" },
  { type: "fabric", title: "面料库", hint: "引用现有面料记录" },
];

const toolInputHints = {
  analyze_brief: "需求与参考",
  generate_design: "约束与参考",
  evaluate_design: "候选与约束",
  edit_design: "候选",
  transform_image: "候选图片",
};
const TOOL_OPTIONS = getWorkflowToolCatalog().map((tool) => ({
  type: tool.key,
  title: tool.name,
  hint: `${toolInputHints[tool.key]} → ${tool.output.type === "constraint" ? "设计约束" : tool.output.type === "evaluation" ? "评估报告" : "新的设计方案"}`,
}));

const PORT_LABELS: Readonly<Record<WorkflowInputPort, string>> = {
  candidate: "候选方案",
  constraint: "设计约束",
  goal: "设计目标",
  reference: "参考素材",
  source: "原图",
};

const EDGE_LEGEND_ITEMS = [
  { label: "主输入", color: "var(--color-workflow-edge-input)" },
  { label: "参考素材", color: "var(--color-workflow-edge-reference)" },
  { label: "生成结果", color: "var(--color-workflow-edge-result)" },
] as const;

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
  proposed: boolean,
  depths: ReadonlyMap<string, number>,
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
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    endX: endX - x,
    endY: endY - y,
    detourY:
      endX < x
        ? Math.max(
            sourcePosition.y + sourceSize.h,
            targetPosition.y + targetSize.h,
          ) +
          48 -
          y
        : 0,
    enterIndex: Math.min(depths.get(edge.targetNodeId) ?? 0, 6),
    highlighted: highlighted?.has(edge.id) ?? false,
    muted: Boolean(highlighted && !highlighted.has(edge.id)),
    relation: edgeRelation(source, edge),
    proposed,
    running: source.status === "running",
    editable: source.kind === "asset" && target.type !== "restore_version",
    label: source.kind === "tool" ? "结果来源" : PORT_LABELS[edge.targetPort],
  };
  const id = edgeShapeId(edge.id);
  const existing = editor.getShape<WorkflowEdgeShape>(id);
  if (existing?.type === WORKFLOW_EDGE_SHAPE_TYPE) {
    editor.updateShape<WorkflowEdgeShape>({
      id,
      type: WORKFLOW_EDGE_SHAPE_TYPE,
      x,
      y,
      props,
    });
  } else {
    editor.createShape<WorkflowEdgeShape>({
      id,
      type: WORKFLOW_EDGE_SHAPE_TYPE,
      x,
      y,
      props,
    });
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
  readonly onEditor: (editor: Editor | null) => void;
  readonly onLayout: (
    positions: readonly { nodeId: string; x: number; y: number }[],
  ) => void;
  readonly onSelected: (id: string | null) => void;
  readonly proposal: WorkflowProposal | null;
  readonly selectedId: string | null;
}) {
  const editor = useEditor();
  const initialFit = useRef(false);
  const { session } = useAuth();
  const viewKey = session
    ? `fashion:creative-view:${session.user.id}:${graph.projectId}`
    : null;
  useEffect(() => {
    if (!viewKey) return;
    const save = () => {
      try {
        localStorage.setItem(
          viewKey,
          JSON.stringify({
            camera: editor.getCamera(),
            selected: editor.getOnlySelectedShapeId(),
          }),
        );
      } catch {
        /* The design remains usable without browser storage. */
      }
    };
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", save);
    return () => {
      save();
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", save);
    };
  }, [editor, viewKey]);
  const projectedPositions = useRef(
    new Map<string, { x: number; y: number }>(),
  );
  const selectedShapeId = useValue(
    "workflow-selected-shape",
    () => editor.getOnlySelectedShapeId(),
    [editor],
  );
  const proposedEdges = useMemo(
    () =>
      (proposal?.operations ?? []).flatMap((operation) =>
        operation.type === "add_edge" ? [operation.edge] : [],
      ),
    [proposal],
  );
  const projectedGraph = useMemo(
    () => projectWorkflowProposal(graph, proposal),
    [graph, proposal],
  );
  const lineage = useMemo(
    () => selectedId ? focusPathOf(projectedGraph, selectedId) : null,
    [projectedGraph, selectedId],
  );

  useEffect(() => { onEditor(editor); return () => onEditor(null); }, [editor, onEditor]);
  useEffect(() => {
    editor.user.updateUserPreferences({ colorScheme: "light" });
  }, [editor]);
  useEffect(() => {
    const container = editor.getContainer();
    // Ancestor animations can move the viewport without triggering ResizeObserver.
    // Refresh before tldraw captures the drag origin, rather than during the gesture.
    const syncViewport = () => {
      editor.updateViewportScreenBounds(container);
    };
    container.addEventListener("pointerdown", syncViewport, true);
    return () =>
      container.removeEventListener("pointerdown", syncViewport, true);
  }, [editor]);

  useEffect(() => {
    const shape = selectedShapeId
      ? editor.getShape(selectedShapeId)
      : undefined;
    onSelected(
      shape?.type === WORKFLOW_NODE_SHAPE_TYPE ? shape.props.nodeId : null,
    );
  }, [editor, onSelected, selectedShapeId]);

  useEffect(() => {
    editor.store.mergeRemoteChanges(() => {
      const active = new Set<TLShapeId>();
      // 入场错峰按图的 BFS 深度排：上游先落、下游后落，读图顺序与视觉顺序一致。
      const depths = nodeDepths(projectedGraph);
      for (const node of projectedGraph.nodes) {
        const id = nodeShapeId(node.id);
        active.add(id);
        const existing = editor.getShape<WorkflowNodeShape>(id);
        const imageUrl = nodeImageUrl(node);
        const loadedImage =
          existing?.type === WORKFLOW_NODE_SHAPE_TYPE &&
          existing.props.imageUrl === imageUrl
            ? {
                width: existing.props.imageWidth,
                height: existing.props.imageHeight,
              }
            : { width: 0, height: 0 };
        const size = nodeSize(node, loadedImage);
        const props = {
          enterIndex: Math.min(depths.get(node.id) ?? 0, 6),
          h: size.h,
          highlighted:
            node.status === "proposed" ||
            (lineage?.nodeIds.has(node.id) ?? false),
          imageUrl,
          imageWidth: loadedImage.width,
          imageHeight: loadedImage.height,
          color:
            node.type === "swatch" &&
            readSwatchColors(node.payload, node.title).length > 1
              ? `linear-gradient(90deg, ${readSwatchColors(
                  node.payload,
                  node.title,
                )
                  .map(
                    (c, i, all) =>
                      `${c.hex} ${(i * 100) / all.length}% ${((i + 1) * 100) / all.length}%`,
                  )
                  .join(", ")})`
              : typeof node.payload.color === "string"
                ? node.payload.color
                : "",
          kind: node.kind,
          muted:
            node.status !== "proposed" &&
            Boolean(lineage && !lineage.nodeIds.has(node.id)),
          nodeId: node.id,
          nodeType: node.type,
          status: node.status,
          summary: nodeSummary(node),
          title: displayNodeTitle(node),
          w: size.w,
        };
        if (existing?.type === WORKFLOW_NODE_SHAPE_TYPE) {
          const previous = projectedPositions.current.get(node.id);
          const positionChanged =
            !previous || previous.x !== node.x || previous.y !== node.y;
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
        projectEdge(
          editor,
          projectedGraph,
          edge,
          lineage?.edgeIds ?? null,
          proposedEdges.some((item) => item.id === edge.id),
          depths,
        );
      }
      const stale = editor
        .getCurrentPageShapes()
        .filter(
          (shape) =>
            (shape.type === WORKFLOW_NODE_SHAPE_TYPE ||
              shape.type === WORKFLOW_EDGE_SHAPE_TYPE) &&
            !active.has(shape.id),
        )
        .map((shape) => shape.id);
      if (stale.length > 0) editor.deleteShapes(stale);
      editor.sendToBack(
        projectedGraph.edges.map((edge) => edgeShapeId(edge.id)),
      );
    });
    if (!initialFit.current && graph.nodes.length > 0) {
      initialFit.current = true;
      if (viewKey) {
        try {
          const saved = JSON.parse(localStorage.getItem(viewKey) ?? "null") as {
            camera?: { x: number; y: number; z: number };
            selected?: TLShapeId;
          } | null;
          const camera = saved?.camera;
          if (
            camera &&
            [camera.x, camera.y, camera.z].every(Number.isFinite) &&
            camera.z >= 0.1 &&
            camera.z <= 8 &&
            (!saved?.selected || editor.getShape(saved.selected))
          ) {
            editor.setCamera(camera);
            if (saved?.selected && editor.getShape(saved.selected))
              editor.select(saved.selected);
            return;
          }
        } catch {
          /* Invalid saved views fall back to the project overview. */
        }
      }
      const focus =
        graph.nodes.find((node) => node.id === selectedId) ??
        graph.nodes.find((node) => node.type === "brief") ??
        graph.nodes[0];
      if (!focus) return;
      const size = graphNodeSize(editor, focus);
      const zoom = 0.95;
      const viewport = editor.getViewportScreenBounds();
      editor.setCamera({
        x: viewport.w / (2 * zoom) - focus.x - size.w / 2,
        y: viewport.h / (2 * zoom) - focus.y - size.h / 2,
        z: zoom,
      });
    }
  }, [
    editor,
    graph,
    lineage,
    projectedGraph,
    proposedEdges,
    selectedId,
    viewKey,
  ]);

  useEffect(
    () =>
      editor.store.listen(
        (entry) => {
          const resized = new Set(
            Object.values(entry.changes.updated).flatMap(([before, after]) =>
              before.typeName === "shape" &&
              after.typeName === "shape" &&
              before.type === WORKFLOW_NODE_SHAPE_TYPE &&
              after.type === WORKFLOW_NODE_SHAPE_TYPE &&
              (before.props.w !== after.props.w ||
                before.props.h !== after.props.h)
                ? [after.props.nodeId]
                : [],
            ),
          );
          if (resized.size === 0) return;
          // Image loading changes presentation only; keep wires aligned without saving layout.
          editor.store.mergeRemoteChanges(() => {
            for (const edge of projectedGraph.edges) {
              if (
                resized.has(edge.sourceNodeId) ||
                resized.has(edge.targetNodeId)
              )
                projectEdge(
                  editor,
                  projectedGraph,
                  edge,
                  lineage?.edgeIds ?? null,
                  proposedEdges.some((item) => item.id === edge.id),
                  nodeDepths(projectedGraph),
                );
            }
          });
        },
        { scope: "document" },
      ),
    [editor, projectedGraph, lineage, proposedEdges],
  );

  useEffect(
    () =>
      editor.store.listen(
        (entry) => {
          const authoritativeIds = new Set<TLShapeId>([
            ...projectedGraph.nodes.map((node) => nodeShapeId(node.id)),
            ...projectedGraph.edges.map((edge) => edgeShapeId(edge.id)),
          ]);
          const extraShapeIds = Object.values(entry.changes.added)
            .filter(
              (record) =>
                record.typeName === "shape" &&
                !authoritativeIds.has(record.id as TLShapeId),
            )
            .map((record) => record.id as TLShapeId);
          if (extraShapeIds.length > 0) {
            editor.store.mergeRemoteChanges(() =>
              editor.deleteShapes(extraShapeIds),
            );
          }
          const moved: { nodeId: string; x: number; y: number }[] = [];
          for (const [before, after] of Object.values(entry.changes.updated)) {
            if (
              before.typeName !== "shape" ||
              after.typeName !== "shape" ||
              after.type !== WORKFLOW_NODE_SHAPE_TYPE ||
              (before.x === after.x && before.y === after.y)
            )
              continue;
            if (graph.nodes.some((node) => node.id === after.props.nodeId)) {
              moved.push({
                nodeId: after.props.nodeId,
                x: after.x,
                y: after.y,
              });
            }
          }
          if (moved.length === 0) return;
          editor.store.mergeRemoteChanges(() => {
            for (const edge of projectedGraph.edges)
              projectEdge(
                editor,
                projectedGraph,
                edge,
                lineage?.edgeIds ?? null,
                proposedEdges.some((item) => item.id === edge.id),
                nodeDepths(projectedGraph),
              );
          });
          onLayout(moved);
        },
        { scope: "document", source: "user" },
      ),
    [editor, graph.nodes, projectedGraph, lineage, onLayout, proposedEdges],
  );

  return null;
}

export default function WorkflowCanvas({ projectId }: WorkflowCanvasProps) {
  return <WorkflowCanvasSession key={projectId} projectId={projectId} />;
}

function WorkflowCanvasSession({ projectId }: WorkflowCanvasProps) {
  const store = useMemo(
    () =>
      createTLStore({
        bindingUtils: defaultBindingUtils,
        shapeUtils: [
          ...defaultShapeUtils,
          WorkflowNodeShapeUtil,
          WorkflowEdgeShapeUtil,
        ] as unknown as readonly TLAnyShapeUtilConstructor[],
      }),
    [],
  );
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [proposal, setProposal] = useState<WorkflowProposal | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [assistantFocusRequest, setAssistantFocusRequest] = useState(0);
  const [referenceRequest, setReferenceRequest] = useState<{ nodeId: string; nonce: number } | null>(null);
  const [canvasView, setCanvasView] = useState<"workbench" | "workflow">(() => {
    try { if (typeof window !== "undefined" && sessionStorage.getItem("fashion:canvas-view") === "workflow") return "workflow"; } catch { /* Optional view preference. */ }
    return "workbench";
  });
  const pendingExport = useRef(false);
  const executionConversation = useRef<Promise<string> | null>(null);
  const graphRef = useRef<WorkflowGraph | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const [projectName, setProjectName] = useState("设计项目");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [arrivals, setArrivals] = useState<string[]>([]);
  const [menuTab, setMenuTab] = useState<MenuTab | null>(null);
  const [draftType, setDraftType] = useState<WorkflowAssetType | null>(null);
  const [libraryKind, setLibraryKind] = useState<LibraryKind | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sketchOpen, setSketchOpen] = useState(false);
  const [editingSketch, setEditingSketch] = useState<WorkflowNode | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailOrigin, setDetailOrigin] = useState<DetailOrigin | null>(null);
  const [detailSessions, setDetailSessions] = useState<string[]>([]);
  const [detailEpochs, setDetailEpochs] = useState<Record<string, number>>({});
  const [draftStore] = useState(() => new WorkspaceDraftStore());
  useWorkspaceDraftRevision(draftStore);
  const detailBaseline = (node: WorkflowNode) => node.type === "candidate"
    ? JSON.stringify([node.payload.assetId, node.canEditPayload, node.canForkPayload])
    : JSON.stringify([node.title, node.payload, node.canEditPayload, node.canForkPayload, node.status]);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const inspectedRef = useRef<string | null>(null);
  const detailReturnFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { inspectedRef.current = inspectedId; }, [inspectedId]);
  const { mode: layoutMode, sidebarOpen, setSidebarOpen, mobileView, setMobileView } = useWorkspaceLayout();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const changeCanvasView = (view: "workbench" | "workflow") => {
    setCanvasView(view);
    setMobileListOpen(false);
    setMobileView("canvas");
    setMenuTab(null);
    try { sessionStorage.setItem("fashion:canvas-view", view); } catch { /* The view still works without storage. */ }
  };
  const { workspaceRef, width: sidebarWidth, maximum: sidebarMaximum, resizerProps } = useSidebarResize(layoutMode === "docked" && sidebarOpen);
  useEffect(() => {
    const update = () => { document.documentElement.dataset.pageHidden = String(document.hidden); };
    update();
    document.addEventListener("visibilitychange", update);
    return () => { document.removeEventListener("visibilitychange", update); delete document.documentElement.dataset.pageHidden; };
  }, []);
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const discardReply = useRef<((accepted: boolean) => void) | null>(null);
  const beforeLeave = useCallback(() => {
    if (!draftStore.hasDirty()) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      discardReply.current = (accepted) => {
        if (accepted) {
          draftStore.clear();
          setDetailSessions([]);
          setDetailOpen(false);
          resolve();
        } else reject(new Error("保留未保存的参数"));
      };
      setDiscardAction(() => () => undefined);
    });
  }, [draftStore]);
  const cancelDiscard = () => {
    discardReply.current?.(false);
    discardReply.current = null;
    setDiscardAction(null);
    setDetailOpen(Boolean(inspectedId));
    setMobileView("canvas");
    if (inspectedId) {
      setSelectedId(inspectedId);
      editorRef.current?.select(nodeShapeId(inspectedId));
    }
  };
  const hasUnsavedDetails = draftStore.hasDirty;
  const closeDetails = useCallback(() => {
    setDetailOpen(false);
    requestAnimationFrame(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>("[data-node-id]")).find((element) => element.dataset.nodeId === inspectedId && element.getAttribute("role") === "group");
      const focus = target ?? detailReturnFocus.current;
      if (focus?.isConnected && focus.checkVisibility()) focus.focus({ preventScroll: true });
    });
  }, [inspectedId]);
  const selectNode = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);
  const openDetails = useCallback((id: string) => {
    const target = graphRef.current?.nodes.find((node) => node.id === id);
    if (!target || target.status === "proposed") return;
    const element = Array.from(document.querySelectorAll<HTMLElement>("[data-node-id]")).find((item) => item.dataset.nodeId === id && item.getAttribute("role") === "group");
    const trigger = element ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    detailReturnFocus.current = trigger;
    const bounds = element?.getBoundingClientRect();
    const keyboard = document.activeElement?.matches(":focus-visible") ?? false;
    setDetailOrigin(bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, keyboard } : null);
    setDetailSessions((sessions) => sessions.includes(id) ? sessions : [...sessions, id]);
    setSelectedId(id);
    setInspectedId(id);
    setDetailOpen(true);
    setMobileView("canvas");
    setMobileListOpen(false);
    editorRef.current?.select(nodeShapeId(id));
  }, [setMobileView]);
  useEffect(() => {
    const ids = new Set(graph?.nodes.map((node) => node.id));
    for (const id of detailSessions) if (!ids.has(id)) {
      draftStore.removeOwner(id);
    }
  }, [draftStore, graph, detailSessions, inspectedId]);
  const setWorkspaceAssetId = (assetId: string) => {
    const node = graphRef.current?.nodes.find((item) => item.payload.assetId === assetId);
    if (node) openDetails(node.id);
  };
  const [imageArrivals] = useState(() => new ImageResultArrivals());
  useEffect(() => {
    if (!graph) return;
    const result = imageArrivals.observe(graph);
    if (!result.first) return;
    const active = document.activeElement;
    const typing = active instanceof HTMLElement && (active.matches("input, textarea, [contenteditable=true]") || Boolean(active.closest("[contenteditable=true]")));
    const editingImage = () => [...document.querySelectorAll<HTMLElement>('[data-image-editing="true"]')].some((element) => element.checkVisibility());
    const otherDialog = () => [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"][aria-modal="true"]:not([aria-label="图片工作区"])')].some((element) => element.checkVisibility());
    if (draftStore.hasDirty() || editingImage() || typing || otherDialog() || document.hidden || (detailOpen && graph.nodes.find((n) => n.id === inspectedId)?.type !== "candidate")) return;
    const nodeId = result.first.id;
    requestAnimationFrame(() => {
      if (graphRef.current?.projectId !== graph.projectId || draftStore.hasDirty() || editingImage() || otherDialog()) return;
      openDetails(nodeId);
      setArrivals((ids) => ids.filter((id) => !result.fresh.some((node) => node.id === id)));
    });
  }, [graph, imageArrivals, draftStore, detailOpen, inspectedId, openDetails]);
  const pendingInputEdits = useRef(
    new Map<
      string,
      { planned: PlannedInputEdit; mutationId: string; baseRevision: number }
    >(),
  );
  const pendingCreates = useRef(
    new Map<string, { id: string; operations: WorkflowOperation[] }>(),
  );
  const mutationQueue = useRef<Promise<unknown>>(Promise.resolve());
  const layoutQueueRef = useRef<WorkflowLayoutSave | null>(null);
  const ensureConversation = async (): Promise<string> => {
    if (activeConversationId) return activeConversationId;
    if (!executionConversation.current)
      executionConversation.current = createAgentConversation(projectId, {
        mode: "workflow",
      })
        .then((created) => {
          setActiveConversationId(created.id);
          window.dispatchEvent(
            new CustomEvent("fashion-workflow:conversation", {
              detail: { id: created.id },
            }),
          );
          return created.id;
        })
        .finally(() => {
          executionConversation.current = null;
        });
    return executionConversation.current;
  };

  const commitGraph = useCallback((next: WorkflowGraph) => {
    const previous = graphRef.current;
    if (
      previous &&
      (next.revision < previous.revision ||
        (next.revision === previous.revision &&
          next.layoutRevision < previous.layoutRevision))
    )
      return;
    if (previous && next.layoutRevision < previous.layoutRevision) {
      const priorPositions = new Map(
        previous.nodes.map((node) => [node.id, { x: node.x, y: node.y }]),
      );
      next = {
        ...next,
        layoutRevision: previous.layoutRevision,
        nodes: next.nodes.map((node) => ({
          ...node,
          ...(priorPositions.get(node.id) ?? {}),
        })),
      };
    }
    const previousRevision = previous?.revision;
    if (previous) {
      const known = new Set(previous.nodes.map((node) => node.id));
      for (const node of next.nodes) {
        if (node.type === "fabric" && !known.has(node.id)) markMotion(`node:${node.id}`, "material");
        const prior = previous.nodes.find((item) => item.id === node.id);
        if (node.kind === "tool" && ["queued", "pending", "running", "processing"].includes(node.status) && prior && !["queued", "pending", "running", "processing"].includes(prior.status)) {
          markMotion(`node:${node.id}`, "needle", `node:${node.id}:${next.revision}`);
        }
      }
      const fresh = next.nodes.filter(
        (node) => node.type === "candidate" && !known.has(node.id),
      );
      fresh.forEach((node) => markResultArrival(node.id));
      if (fresh.length)
        setArrivals((current) =>
          [...new Set([...current, ...fresh.map((node) => node.id)])].slice(
            -100,
          ),
        );
    }
    graphRef.current = next;
    const optimistic = new Map(
      layoutQueueRef.current
        ?.getPositions()
        .map((position) => [position.nodeId, position]) ?? [],
    );
    setGraph(
      optimistic.size
        ? {
            ...next,
            nodes: next.nodes.map((node) => ({
              ...node,
              ...(optimistic.get(node.id) ?? {}),
            })),
          }
        : next,
    );
    if (next.proposals) {
      const pending = next.proposals;
      setProposal((current) =>
        current
          ? (pending.find(
              (item) => item.id === current.id && item.status === "pending",
            ) ?? null)
          : null,
      );
    } else if (previousRevision !== next.revision) setProposal(null);
  }, []);

  const graphFlight = useRef<{
    projectId: string;
    promise: Promise<WorkflowGraph>;
    signal: AbortSignal | null;
  } | null>(null);
  const loadGraph = useCallback(
    (signal?: AbortSignal) => {
      if (
        graphFlight.current?.projectId === projectId &&
        !graphFlight.current.signal?.aborted
      )
        return graphFlight.current.promise;
      const promise = fetchWorkflow(projectId, signal).finally(() => {
        if (graphFlight.current?.promise === promise)
          graphFlight.current = null;
      });
      graphFlight.current = { projectId, promise, signal: signal ?? null };
      return promise;
    },
    [projectId],
  );
  const reload = useCallback(async () => {
    const next = await loadGraph();
    commitGraph(next);
    return next;
  }, [commitGraph, loadGraph]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void Promise.all([
      loadGraph(controller.signal),
      fetchProject(projectId),
    ]).then(
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
    return () => {
      active = false;
      controller.abort();
    };
  }, [commitGraph, projectId, loadGraph]);

  const sync = useSerialPolling(
    projectId,
    Boolean(
      graph?.nodes.some(
        (node) =>
          node.status === "running" ||
          node.status === "pending" ||
          ((node.type === "reference_image" || node.type === "sketch") &&
            node.payload.roleInferenceState === "pending" &&
            node.payload.roleSource !== "manual"),
      ),
    ),
    3000,
    async (signal) => {
      const next = await loadGraph(signal);
      signal.throwIfAborted();
      commitGraph(next);
    },
  );

  useEffect(() => {
    const refresh = () => {
      void reload().catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "工作流刷新失败"),
      );
    };
    window.addEventListener("fashion-workflow:refresh", refresh);
    return () =>
      window.removeEventListener("fashion-workflow:refresh", refresh);
  }, [reload]);

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const queued = mutationQueue.current.catch(() => undefined).then(task);
    mutationQueue.current = queued.catch(() => undefined);
    return queued;
  }, []);

  const mutationPackets = useRef(
    new Map<string, { mutationId: string; baseRevision: number }>(),
  );
  const mutate = useCallback(
    (operations: readonly WorkflowOperation[]) =>
      enqueue(async () => {
        const current = graphRef.current;
        if (!current) throw new Error("工作流仍在加载");
        const key = JSON.stringify(operations);
        const packet = mutationPackets.current.get(key) ?? {
          mutationId: crypto.randomUUID(),
          baseRevision: current.revision,
        };
        mutationPackets.current.set(key, packet);
        try {
          const next = await patchWorkflow(projectId, {
            baseRevision: packet.baseRevision,
            mode: "semantic",
            mutationId: packet.mutationId,
            operations,
          });
          commitGraph(next);
          mutationPackets.current.delete(key);
          setNotice("设计路径已保存");
          setError(null);
          return next;
        } catch (cause) {
          if (cause instanceof WorkflowApiError && cause.status === 409) {
            mutationPackets.current.delete(key);
            await reload();
          }
          throw cause;
        }
      }),
    [commitGraph, enqueue, projectId, reload],
  );

  const layoutSave = useWorkflowLayoutSave(
    async (batch) =>
      enqueue(async () => {
        const current = graphRef.current;
        if (!current) throw new Error("工作流仍在加载");
        const request = (batch.request ??= {
          mutationId: batch.mutationId,
          baseLayoutRevision: current.layoutRevision,
          positions: batch.positions,
        });
        try {
          commitGraph(
            await patchWorkflow(projectId, {
              ...request,
              mode: "layout",
            }),
          );
        } catch (cause) {
          if (!(cause instanceof WorkflowApiError) || cause.status !== 409)
            throw cause;
          const fresh = await reload();
          const ids = new Set(fresh.nodes.map((node) => node.id));
          const positions = batch.positions.filter((position) =>
            ids.has(position.nodeId),
          );
          if (positions.length) {
            batch.request = {
              baseLayoutRevision: fresh.layoutRevision,
              mutationId: crypto.randomUUID(),
              positions,
            };
            commitGraph(
              await patchWorkflow(projectId, {
                ...batch.request,
                mode: "layout",
              }),
            );
          }
        }
        setError(null);
      }),
    (cause) =>
      setError(cause instanceof Error ? cause.message : "节点位置保存失败"),
    beforeLeave,
    hasUnsavedDetails,
  );
  useLayoutEffect(() => {
    layoutQueueRef.current = layoutSave.queue;
  }, [layoutSave.queue]);
  const saveLayout = useCallback(
    (positions: readonly { nodeId: string; x: number; y: number }[]) => {
      layoutSave.queue.stage(positions);
    },
    [layoutSave.queue],
  );

  const editInput = useCallback(
    (edit: InputEdit) =>
      enqueue(async () => {
        const current = graphRef.current;
        if (!current) throw new Error("工作流仍在加载");
        const key = JSON.stringify(edit);
        const packet = pendingInputEdits.current.get(key) ?? {
          planned: planInputEdit(current, edit),
          mutationId: crypto.randomUUID(),
          baseRevision: current.revision,
        };
        pendingInputEdits.current.set(key, packet);
        try {
          const next = await patchWorkflow(projectId, {
            mode: "semantic",
            baseRevision: packet.baseRevision,
            mutationId: packet.mutationId,
            operations: packet.planned.operations,
          });
          commitGraph(next);
          pendingInputEdits.current.delete(key);
          setSelectedId(packet.planned.targetId);
          requestAnimationFrame(() => {
            editorRef.current?.select(nodeShapeId(packet.planned.targetId));
            if (packet.planned.branched)
              editorRef.current?.zoomToSelection(motionOptions());
          });
          setNotice(
            packet.planned.maskCleared
              ? `${packet.planned.branched ? "已建立新分支；" : ""}更换原图后，请重新框选局部区域`
              : packet.planned.branched
                ? "已建立新分支"
                : "连接已保存",
          );
          setError(null);
        } catch (cause) {
          if (cause instanceof WorkflowApiError && cause.status === 409) {
            pendingInputEdits.current.delete(key);
            await reload();
          }
          throw cause;
        }
      }),
    [commitGraph, enqueue, projectId, reload],
  );

  const selected = graph?.nodes.find((node) => node.id === selectedId) ?? null;
  const inspected =
    graph?.nodes.find((node) => node.id === inspectedId) ?? null;

  const addNode = useCallback(
    async (
      kind: "asset" | "tool",
      type: AddKind,
      title: string,
      payload: Readonly<Record<string, unknown>>,
      point?: { x: number; y: number },
    ) => {
      const current = graphRef.current;
      if (!current) throw new Error("工作流尚未加载完成，请稍后再试");
      const selectedNode = current.nodes.find((node) => node.id === selectedId);
      const viewport = editorRef.current?.getViewportPageBounds();
      const x = point
        ? point.x
        : selectedNode
          ? selectedNode.x +
            (editorRef.current
              ? graphNodeSize(editorRef.current, selectedNode).w
              : nodeSize(selectedNode).w) +
            130
          : (viewport?.center.x ?? 320) - 130;
      const y = point
        ? point.y
        : selectedNode
          ? selectedNode.y + (selectedNode.kind === kind ? 240 : 0)
          : (viewport?.center.y ?? 240) - 105;
      const createKey = JSON.stringify({ kind, type, payload, title });
      const previous = pendingCreates.current.get(createKey);
      const id = previous?.id ?? crypto.randomUUID();
      const operations: WorkflowOperation[] = previous?.operations ?? [
        {
          node: { id, kind, type, title: title.trim(), payload, x, y },
          type: "add_node",
        },
      ];
      pendingCreates.current.set(createKey, { id, operations });
      setBusy(true);
      try {
        await mutate(operations);
        pendingCreates.current.delete(createKey);
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
    },
    [mutate, selectedId],
  );

  const handleAssetOption = (type: WorkflowAssetType) => {
    if (type === "sketch") {
      setEditingSketch(null);
      setSketchOpen(true);
      setMenuTab(null);
      return;
    }
    if (type === "reference_image") {
      setDraftType(type);
      window.dispatchEvent(new Event("fashion:upload-images"));
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

  const importLegacy = async (item: LegacyBoardImport) => {
    const payload = item.payload;
    const type: WorkflowAssetType =
      item.type === "image"
        ? "reference_image"
        : item.type === "swatch"
          ? "swatch"
          : "reference_text";
    await addNode("asset", type, item.title, {
      boardElementId: item.shapeId,
      ...(typeof payload.assetId === "string"
        ? { assetId: payload.assetId }
        : {}),
      ...(typeof payload.fileId === "string"
        ? { fileAssetId: payload.fileId }
        : {}),
      ...(typeof payload.url === "string" ? { imageUrl: payload.url } : {}),
      ...(typeof payload.text === "string" ? { text: payload.text } : {}),
      ...(typeof payload.color === "string" ? { color: payload.color } : {}),
      legacyBoard: payload.legacyBoard,
    });
  };

  const exportCanvas = async () => {
    const editor = editorRef.current;
    if (!editor) { pendingExport.current = true; changeCanvasView("workflow"); return; }
    const shapeIds = editor.getCurrentPageShapes().map((shape) => shape.id);
    if (shapeIds.length === 0) {
      setError("画布为空，请先添加节点");
      return;
    }
    setExporting(true);
    try {
      const rendered = await editor.toImage(shapeIds, {
        background: true,
        format: "png",
        padding: 64,
        pixelRatio: 2,
      });
      const url = URL.createObjectURL(rendered.blob);
      const link = document.createElement("a");
      link.download = `fashion-workflow-${projectId}.png`;
      link.href = url;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "工作流导出失败");
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <BoardSkeleton />;
  if (!graph)
    return (
      <main className={styles.loadError}>
        <h1>设计工作流暂时无法打开</h1>
        <p role="alert">
          {userFacingError(error, "设计画布暂时无法加载，请重试")}
        </p>
        <button
          onClick={() => {
            setLoading(true);
            void reload().then(
              () => setLoading(false),
              () => setLoading(false),
            );
          }}
          type="button"
        >
          重新加载
        </button>
      </main>
    );

  const renderDetails = (sessionNode: WorkflowNode) => (
    <NodeDetails embedded
      graph={graph}
      key={sessionNode.id}
      node={sessionNode}
      onCreateCollection={async (nodeId, assetId) => {
        setBusy(true);
        try {
          const linked = graphRef.current?.nodes.find(
            (item) => item.id === nodeId,
          )?.payload.collectionId;
          if (typeof linked === "string" && linked) {
            setCollectionId(linked);
            return;
          }
          const collection = await createCollection(assetId);
          await mutate([
            {
              type: "link_collection",
              nodeId,
              collectionId: collection.id,
            },
          ]);
          setCollectionId(collection.id);
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : "系列创建失败",
          );
        } finally {
          setBusy(false);
        }
      }}
      onOpenAsset={() => document.querySelector<HTMLElement>('[aria-label="候选资产操作"] button')?.focus()}
      onDelete={async (nodeId) => {
        await mutate([{ type: "remove_node", nodeId }]);
        setSelectedId(null);
      }}
      path={lineageOf(graph, sessionNode.id)}
      projectId={projectId}
      onEnsureConversation={ensureConversation}
      onGraphChange={commitGraph}
      onSavePayload={async (nodeId, payload) => {
        await mutate([{ type: "update_node", nodeId, payload }]);
      }}
      onInferRole={async (nodeId) => {
        try {
          commitGraph(await inferWorkflowNodeRole(projectId, nodeId));
          setNotice("参考图角色已更新");
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : "参考图角色识别失败",
          );
        }
      }}
      setError={setError}
    />
  );

  return (
    <>
    <AppHeader current="design" projectId={projectId} projectName={projectName} hideProjectReturn />
    <main
      className={styles.shell}
      data-layout-save-state={layoutSave.state}
      data-layout-pending-count={layoutSave.pendingCount}
      onKeyDownCapture={(event) => {
        if (
          event.key === "Tab" &&
          !(
            event.target instanceof Element &&
            event.target.closest("dialog[open]")
          )
        )
          event.stopPropagation();
      }}
    >
      <header className={styles.topbar}>
        <div className={styles.brandGroup}>
          <span className={styles.projectName}><MotionReceipt receiptKey={`project:${projectId}`}>{projectName}</MotionReceipt></span>
        </div>
        <div className={`${styles.topActions} ${controls.controlSurface}`}>
          {sync.error || layoutSave.state === "error" ? <details
            className={styles.syncStatus}
            open
          >
            <summary
              className={styles.saved}
              data-save-state={sync.error ? "error" : layoutSave.state}
            >
              <span aria-hidden="true" />
              {sync.error ? "同步异常" : "画布未保存"}
            </summary>
            <div>
              {layoutSave.pendingCount > 0 ? (
                <p aria-label="待保存节点数">
                  {layoutSave.pendingCount} 个节点待保存
                </p>
              ) : null}
              {sync.error ? (
                <p role="status">
                  画布同步异常：{sync.error}
                  <Button onClick={sync.retry}>重试同步</Button>
                </p>
              ) : null}
              {layoutSave.state === "error" ? (
                <Button
                  onClick={() =>
                    void layoutSave.queue.flush().catch(() => undefined)
                  }
                >
                  重试保存
                </Button>
              ) : null}
            </div>
          </details> : <span className={`${styles.saved} ${styles.saveFeedback}`} data-save-state={layoutSave.state} role="status" aria-label="画布保存状态"><span aria-hidden="true" />{layoutSave.state === "saving" ? "保存中…" : layoutSave.state === "dirty" ? "等待保存" : "已保存"}</span>}
          <WorkflowProjectPanels
            projectId={projectId}
            graph={graph}
            onGraph={commitGraph}
            onLocate={openDetails}
            onCollection={setCollectionId}
          />
          <Link href={`/${encodeURIComponent(projectId)}/studio`}>
            款式与交付
          </Link>
          <Menu label="资料与更多" className={styles.resourceMenu}>
            <Link
              href={`/trends?from=board&boardId=${encodeURIComponent(projectId)}`}
            >
              趋势档案
            </Link>
            <Link
              href={`/fabrics?from=board&boardId=${encodeURIComponent(projectId)}`}
            >
              面料库
            </Link>
            {graph.legacyAvailable ? (
              <button onClick={() => setHistoryOpen(true)} type="button">
                历史白板
              </button>
            ) : null}
            <button
              data-export
              disabled={exporting}
              onClick={() => void exportCanvas()}
              type="button"
            >
              {exporting ? "导出中…" : "导出画布 PNG"}
            </button>
          </Menu>
          {!sidebarOpen ? (
            <button
              aria-label="展开设计助手"
              onClick={() => {
                setSidebarOpen(true);

                setMobileView("assistant");
              }}
              type="button"
            >
              设计助手
            </button>
          ) : null}
        </div>
      </header>

      <div className={styles.mobileViews}>
        <SegmentedControl
          label="工作视图"
          value={mobileView}
          options={[
            { value: "canvas", label: "画布" },
            ...(canvasView === "workflow" ? [{ value: "nodes" as const, label: "节点列表" }] : []),
            { value: "assistant", label: "助手" },
          ]}
          onChange={(view) => {
            setMobileView(view);
            setMobileListOpen(view === "nodes");
            if (view === "assistant") setSidebarOpen(true);
          }}
        />
      </div>
      <div
        className={styles.workspace}
        ref={workspaceRef}
        style={{ "--studio-sidebar-width": `${sidebarWidth}px` } as CSSProperties}
        data-mobile-view={mobileView}
        data-sidebar-open={sidebarOpen ? "true" : "false"}
      >
        <section
          aria-label="设计工作流画布"
          className={styles.canvasSection}
          data-canvas-view={canvasView}
          data-mobile-list-open={mobileListOpen ? "true" : "false"}
        >
          <div className={styles.canvasBackdrop} inert={detailOpen && Boolean(inspected)} data-detail-open={detailOpen && Boolean(inspected)}>
          <div className={styles.viewSwitch}>
            <SegmentedControl label="画布呈现" value={canvasView} options={[{ value: "workbench", label: "设计工作台" }, { value: "workflow", label: "流程画布" }]} onChange={changeCanvasView} />
          </div>
          <div className={styles.canvasHeading}>
            <div>
              {/* 画布不需要一个标签告诉用户"这是画布"。标题保留给辅助技术。 */}
              <h1>从需求到方案的完整设计路径</h1>
              <p>素材、工具和结果逐步连接；修改会形成可回溯的分支。</p>
            </div>
            <button
              className={styles.mobileListToggle}
              onClick={() => setMobileListOpen((current) => !current)}
              type="button"
            >
              {mobileListOpen ? "查看画布" : "节点列表"}
            </button>
          </div>

          <div
            className={styles.canvas}
            data-mobile-list-open={mobileListOpen ? "true" : "false"}
          >
            {canvasView === "workflow" && graph.edges.length > 0 ? (
              <ul className={styles.edgeLegend} aria-label="连线颜色图例" role="list">
                {EDGE_LEGEND_ITEMS.map(({ label, color }) => (
                  <li key={label}>
                    <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true" style={{ color }}>
                      <path d="M 1 5 H 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M 18 1 L 24 5 L 18 9 Z" fill="currentColor" />
                    </svg>
                    {label}
                  </li>
                ))}
              </ul>
            ) : null}
            {arrivals.some((id) =>
              graph.nodes.some((node) => node.id === id),
            ) ? (
              <div className={styles.arrivalNotice} role="status" style={detailOpen ? { position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", zIndex: 150 } : undefined}>
                <span>新的设计方案已到达</span>
                <button
                  type="button"
                  onClick={() => {
                    const id = arrivals.find((value) =>
                      graph.nodes.some((node) => node.id === value),
                    );
                    if (id) {
                      setSelectedId(id);
                      openDetails(id);
                      editorRef.current?.select(nodeShapeId(id));
                      editorRef.current?.zoomToSelection(motionOptions());
                      setMobileView("canvas");
                    }
                    setArrivals([]);
                  }}
                >
                  查看新方案 ↗
                </button>
                <button
                  type="button"
                  aria-label="稍后查看新方案"
                  onClick={() => setArrivals([])}
                >
                  稍后
                </button>
              </div>
            ) : null}
            <WorkflowImageInputs
              projectId={projectId}
              editor={() => editorRef.current}
              onAdd={async (type, title, payload, point) => {
                const id = await addNode("asset", type, title, payload, point);
                if (type === "reference_image") {
                  try {
                    commitGraph(await inferWorkflowNodeRole(projectId, id));
                  } catch {
                    setError(
                      "图片已加入工作流；角色识别暂不可用，可在节点详情重试或手动选择。",
                    );
                  }
                }
              }}
            >
              {canvasView === "workbench" ? <DesignWorkbench
                graph={graph}
                assistantOpen={sidebarOpen}
                pendingProposal={proposal?.status === "pending"}
                onOpen={openDetails}
                onAdd={() => setMenuTab("assets")}
                onStart={() => { setSidebarOpen(true); setMobileView("assistant"); setAssistantFocusRequest((value) => value + 1); }}
                onReference={(nodeId) => { setSelectedId(nodeId); setReferenceRequest({ nodeId, nonce: Date.now() }); setSidebarOpen(true); setMobileView("assistant"); }}
              /> : <WorkflowInteractionProvider
                graph={graph}
                editorRef={editorRef}
                onEdit={editInput}
                onDetails={openDetails}
              >
                <Tldraw
                  hideUi
                  locale="zh-cn"
                  options={{ createTextOnCanvasDoubleClick: false }}
                  overrides={workflowUiOverrides}
                  shapeUtils={[WorkflowNodeShapeUtil, WorkflowEdgeShapeUtil]}
                  store={store}
                  {...(tldrawLicenseKey
                    ? { licenseKey: tldrawLicenseKey }
                    : {})}
                >
                  <WorkflowProjection
                    graph={graph}
                    onEditor={(editor) => {
                      editorRef.current = editor;
                      if (editor && pendingExport.current) { pendingExport.current = false; requestAnimationFrame(() => void exportCanvas()); }
                    }}
                    onLayout={saveLayout}
                    onSelected={selectNode}
                    proposal={proposal}
                    selectedId={selectedId}
                  />
                  <WorkflowConnectionOverlay graph={graph} />
                </Tldraw>
              </WorkflowInteractionProvider>}
            </WorkflowImageInputs>
            {canvasView === "workflow" && graph.nodes.length === 0 ? (
              <div className={styles.emptyState}>
                <h2>让想法成为设计方案</h2>
                <p>在助手里描述需求，确认后生成。素材与结果会自动保存在画布上。</p>
                <button
                  onClick={() => {
                    setSidebarOpen(true);
                    setMobileView("assistant");
                    setAssistantFocusRequest((current) => current + 1);
                  }}
                  type="button"
                >
                  开始设计
                </button>
              </div>
            ) : null}
          </div>

          {canvasView === "workflow" && mobileListOpen ? (
            <div className={styles.mobileNodeList} role="list">
              {graph.nodes.map((node) => (
                <button
                  key={node.id}
                  onClick={() => openDetails(node.id)}
                  role="listitem"
                  type="button"
                >
                  <small>{node.kind === "asset" ? "素材" : "工具"}</small>
                  <strong>{node.title}</strong>
                  <span>{nodeSummary(node)}</span>
                </button>
              ))}
            </div>
          ) : null}

          {canvasView === "workflow" || menuTab ? <div className={`${styles.bottomMenu} ${controls.controlSurface}`}>
            <button
              data-material-trigger
              aria-expanded={menuTab === "assets"}
              onClick={() => setMenuTab(menuTab === "assets" ? null : "assets")}
              type="button"
            >
              ＋ 添加素材
            </button>
            {canvasView === "workflow" ? <>
            <span className={styles.menuDivider} />
            <button
              aria-expanded={menuTab === "tools"}
              onClick={() => setMenuTab(menuTab === "tools" ? null : "tools")}
              type="button"
            >
              ＋ 添加工具
            </button>
            <Tooltip content="查看素材、连线、保存与导出操作说明">
              <Button
                aria-label="工作室帮助"
                variant="ghost"
                onClick={() => setHelpOpen(true)}
              >
                ?
              </Button>
            </Tooltip>
            {/* 缩放并入主控制条：一个低频操作不该和主操作平分视觉权重。 */}
            <div className={styles.zoomControls}>
              <TooltipGroup>
              <Tooltip content="缩小画布，查看更多节点">
              <button
                aria-label="缩小画布"
                onClick={() => editorRef.current?.zoomOut()}
                type="button"
              >
                −
              </button>
              </Tooltip>
              <Tooltip content="将全部节点放入当前视口">
              <button
                aria-label="适合画布"
                onClick={() => editorRef.current?.zoomToFit(motionOptions())}
                type="button"
              >
                查看全图
              </button>
              </Tooltip>
              <Tooltip content="回到原始比例">
              <button
                aria-label="画布原始比例"
                onClick={() => editorRef.current?.resetZoom()}
                type="button"
              >
                100%
              </button>
              </Tooltip>
              <Tooltip content="放大画布，查看节点细节">
              <button
                aria-label="放大画布"
                onClick={() => editorRef.current?.zoomIn()}
                type="button"
              >
                ＋
              </button>
              </Tooltip>
              </TooltipGroup>
            </div>
            </> : null}
            {menuTab ? (
              <div className={styles.addPopover} data-workflow-add-menu>
                <header>
                  <strong>
                    {menuTab === "assets" ? "添加设计素材" : "添加设计工具"}
                  </strong>
                  <button
                    aria-label="关闭菜单"
                    onClick={() => setMenuTab(null)}
                    type="button"
                  >
                    ×
                  </button>
                </header>
                {(menuTab === "assets" ? ASSET_OPTIONS : TOOL_OPTIONS).map(
                  (option) => (
                    <button
                      key={option.type}
                      onClick={() => {
                        if (menuTab === "assets")
                          handleAssetOption(option.type as WorkflowAssetType);
                        else {
                          const tool = getWorkflowToolContract(
                            option.type as WorkflowToolKey,
                          );
                          void addNode("tool", option.type, option.title, {
                            toolKey: tool.key,
                            toolVersion: tool.version,
                            params: { ...tool.defaults, prompt: "" },
                          }).catch(() => undefined);
                        }
                      }}
                      type="button"
                    >
                      <strong>{option.title}</strong>
                      <span>{option.hint}</span>
                    </button>
                  ),
                )}
              </div>
            ) : null}
          </div> : null}
          {!sidebarOpen && (error || notice) ? (
            <div
              aria-live="polite"
              className={`${error ? styles.errorNotice : styles.successNotice} ${styles.canvasNotice}`}
              role={error ? "alert" : "status"}
            >
              {error ? userFacingError(error) : notice}
              <button
                aria-label="关闭提示"
                onClick={() => {
                  setError(null);
                  setNotice(null);
                }}
                type="button"
              >
                ×
              </button>
            </div>
          ) : null}

          </div>
          <WorkflowDetailWorkspace
            fullScreen={inspected?.type === "candidate"}
            open={detailOpen && Boolean(inspected)}
            title={inspected ? displayNodeTitle(inspected) : "节点详情"}
            status={inspected?.status ?? "ready"}
            origin={detailOrigin}
            dirty={Boolean(inspectedId && draftStore.ownerDirty(inspectedId))}
            onClose={closeDetails}
          >
            {detailSessions.map((id) => {
              const sessionNode = graph.nodes.find((node) => node.id === id);
              if (!sessionNode) return null;
              const baseline = detailBaseline(sessionNode);
              const dirty = draftStore.ownerDirty(id);
              const conflict = draftStore.ownerConflict(id);
              const discard = () => {
                draftStore.removeOwner(id);
                setDetailEpochs((epochs) => ({ ...epochs, [id]: (epochs[id] ?? 0) + 1 }));
              };
              const editable = sessionNode.canEditPayload === true || sessionNode.canForkPayload !== false;
              const closeSession = () => { if (inspectedRef.current === id) closeDetails(); };
              return <div key={id} hidden={id !== inspectedId} className={detailStyles.session}>
                {dirty ? <div className={detailStyles.draftWarning}>
                  {conflict ? "节点内容或权限已更新，草稿仍保留。请载入最新内容后重新编辑。" : "修改已暂存于本次工作区，尚未保存。"}
                  <button type="button" disabled={draftStore.ownerLocked(id)} onClick={discard}>{conflict ? "载入最新内容并放弃草稿" : "放弃修改"}</button>
                </div> : null}
                <WorkspaceDraftProvider store={draftStore} owner={id} baseline={baseline} key={`${id}:${detailEpochs[id] ?? 0}:${draftStore.ownerEpoch(id)}`}>
                  <fieldset className={detailStyles.editorFieldset} disabled={conflict}>
                    {sessionNode.type === "swatch" && (editable || dirty) ? (
                      <WorkflowMaterialEntry embedded type="swatch" initialTitle={sessionNode.title} initialPayload={sessionNode.payload} busy={busy} onClose={closeSession} onAdd={async (title, payload) => {
                        if (sessionNode.canEditPayload === true) await mutate([{ type: "update_node", nodeId: id, title, payload: { ...sessionNode.payload, ...payload } }]);
                        else await addNode("asset", "swatch", title, { ...payload, sourceNodeId: id });
                      }} />
                    ) : sessionNode.type === "sketch" && (editable || dirty) ? (
                      <WorkflowSketchEditor embedded ignoreStoredDraft={(detailEpochs[id] ?? 0) > 0} node={sessionNode} open projectId={projectId} onClose={closeSession} onCreated={async ({ title, ...asset }) => {
                        if (sessionNode.canEditPayload === true) await mutate([{ type: "update_node", nodeId: id, title, payload: { ...sessionNode.payload, ...asset } }]);
                        else await addNode("asset", "sketch", title, { ...asset, sourceNodeId: id, source: "designer_sketch", role: "silhouette_ref", roleSource: "default", roleInferenceState: "pending" });
                      }} />
                    ) : sessionNode.type === "candidate" && typeof sessionNode.payload.assetId === "string" ? (
                      <>
                        <BoardProjectContext.Provider value={projectId}>
                          <WorkflowAssetWorkspace embedded assetId={sessionNode.payload.assetId} open projectId={projectId} details={renderDetails(sessionNode)} tasks={graph.nodes.filter((node) => node.kind === "tool" && graph.edges.some((edge) => edge.sourceNodeId === sessionNode.id && edge.targetNodeId === node.id && edge.targetPort === "source"))} candidates={graph.nodes.filter((node) => node.type === "candidate")} onSelectAsset={setWorkspaceAssetId} onClose={closeSession} onEnsureConversation={ensureConversation} onGraphRefresh={() => { void reload().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "工作流刷新失败")); }} />
                        </BoardProjectContext.Provider>
                      </>
                    ) : renderDetails(sessionNode)}
                    {(sessionNode.type === "sketch" || sessionNode.type === "swatch") && (editable || dirty) ? (
                      <details className={detailStyles.metadata}>
                        <summary>素材详情与用途</summary>
                        {renderDetails(sessionNode)}
                      </details>
                    ) : null}
                  </fieldset>
                </WorkspaceDraftProvider>
              </div>;
            })}
          </WorkflowDetailWorkspace>
        </section>

        {sidebarOpen && layoutMode === "docked" ? (
          <div
            aria-label="调整侧栏宽度"
            aria-orientation="vertical"
            aria-valuemin={STUDIO_LAYOUT.sidebarMin}
            aria-valuemax={sidebarMaximum}
            aria-valuenow={sidebarWidth}
            className={styles.sidebarResizer}
            role="separator"
            tabIndex={0}
            {...resizerProps}
          />
        ) : null}
        <aside
          aria-label="设计助手"
          className={`${styles.sidebar} ${controls.controlSurface}`}
          hidden={!sidebarOpen}
        >
          <div className={styles.sidebarHeader}>
            <h2 tabIndex={-1}>设计助手</h2>
            <div className={styles.sidebarActions}>
              <button
                aria-label="收起设计助手"
                className={styles.sidebarCollapse}
                onClick={() => {
                  setSidebarOpen(false);
                  setMobileView("canvas");
                }}
                type="button"
              >
                收起
              </button>
            </div>
          </div>
          <div
            className={styles.assistantMount}
          >
            <WorkflowAssistantPanel
              graph={graph}
              referenceRequest={referenceRequest}
              focusRequest={assistantFocusRequest}
              onOpenResult={(nodeId) => {
                const node = graphRef.current?.nodes.find((item) => item.id === nodeId);
                if (typeof node?.payload.assetId === "string") setWorkspaceAssetId(node.payload.assetId);
                else openDetails(nodeId);
              }}
              onConversationChange={setActiveConversationId}
              onAddMaterial={() => {
                setMobileView("canvas");
                if (layoutMode !== "docked") setSidebarOpen(false);
                setMenuTab("assets");
                requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-workflow-add-menu] > button")?.focus());
              }}
              onGraphChange={commitGraph}
              onNotice={setNotice}
              onError={setError}
              onProposal={setProposal}
              projectId={projectId}
              selected={selected}
              onLocate={(nodeId) => {
                if (canvasView === "workbench") { openDetails(nodeId); return; }
                setSelectedId(nodeId);
                editorRef.current?.select(nodeShapeId(nodeId));
                editorRef.current?.zoomToSelection(motionOptions());
              }}
              renderLegacyRuns={(conversationId) => (
                <LegacyRunHistory
                  conversationId={conversationId}
                  onError={setError}
                />
              )}
            />
          </div>
          {sidebarOpen && (error || notice) ? (
            <div
              aria-live="polite"
              className={error ? styles.errorNotice : styles.successNotice}
              role={error ? "alert" : "status"}
            >
              {error ? userFacingError(error) : notice}
              <button
                aria-label="关闭提示"
                onClick={() => {
                  setError(null);
                  setNotice(null);
                }}
                type="button"
              >
                ×
              </button>
            </div>
          ) : null}
        </aside>
      </div>

      {discardAction ? (
        <Dialog label="保留未保存的参数" onClose={cancelDiscard}>
          <div className={styles.entryDialog}>
            <h2>参数尚未保存</h2>
            <p>继续会放弃当前节点的修改。也可以返回，先保存参数。</p>
            <div className={styles.dialogActions}>
              <Button onClick={cancelDiscard}>返回编辑</Button>
              <Button
                variant="danger"
                onClick={() => {
                  discardReply.current?.(true);
                  discardReply.current = null;
                  discardAction();
                  setDiscardAction(null);
                }}
              >
                放弃修改并继续
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
      {draftType &&
      draftType !== "reference_image" &&
      draftType !== "sketch" ? (
        <WorkflowMaterialEntry
          key={draftType}
          type={draftType}
          initialTitle={
            ASSET_OPTIONS.find((item) => item.type === draftType)?.title ??
            "参考素材"
          }
          busy={busy}
          onClose={() => setDraftType(null)}
          onAdd={async (title, payload) => {
            await addNode("asset", draftType, title, payload);
          }}
        />
      ) : null}
      {libraryKind ? (
        <WorkflowLibraryDialog
          kind={libraryKind}
          onClose={() => setLibraryKind(null)}
          onAdd={async (item) => {
            await addNode("asset", libraryKind, item.label.slice(0, 200), {
              [libraryKind === "trend" ? "trendItemId" : "fabricId"]: item.id,
              imageUrl: item.imageUrl,
              text: item.summary,
              ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
            });
            setLibraryKind(null);
          }}
        />
      ) : null}
      {historyOpen ? (
        <LegacyBoardHistory
          onClose={() => setHistoryOpen(false)}
          onImport={importLegacy}
          projectId={projectId}
        />
      ) : null}
      {helpOpen ? (
        <Dialog label="工作室使用帮助" onClose={() => setHelpOpen(false)}>
          <div className={styles.entryDialog}>
            <h2>开始你的设计</h2>
            <ol>
              <li>
                在设计助手中描述需求；需要参考时，可添加图片、草图或面料并引用。
              </li>
              <li>检查助手给出的方案，点击“确认并生成”即可开始；结果会出现在对话和画布中。</li>
              <li>
                用“修改要求”在原输入框继续描述调整，或跳过不合适的方案。需要精确参数时双击画布节点。
              </li>
              <li>
                画布位置会自动保存。顶部保存状态可查看同步时间并重试失败操作。
              </li>
              <li>
                “导出画布
                PNG”保存设计路径。候选图与系列在各自工作区导出交付文件，关闭窗口不会取消任务。
              </li>
            </ol>
            <Button variant="primary" onClick={() => setHelpOpen(false)}>
              知道了
            </Button>
          </div>
        </Dialog>
      ) : null}
      {sketchOpen ? (
        <WorkflowSketchEditor
          key={editingSketch?.id ?? "new"}
          node={editingSketch}
          onClose={() => {
            setSketchOpen(false);
            setEditingSketch(null);
          }}
          onCreated={async ({ title, ...asset }) => {
            if (editingSketch?.canEditPayload === true) {
              await mutate([
                {
                  type: "update_node",
                  nodeId: editingSketch.id,
                  title,
                  payload: { ...editingSketch.payload, ...asset },
                },
              ]);
            } else {
              const id = await addNode("asset", "sketch", title, {
                ...asset,
                source: "designer_sketch",
                role: "silhouette_ref",
                roleSource: "default",
                roleInferenceState: "pending",
                ...(editingSketch ? { sourceNodeId: editingSketch.id } : {}),
              });
              try {
                commitGraph(await inferWorkflowNodeRole(projectId, id));
              } catch {
                setNotice("草图已保存，可在节点详情重试角色识别");
              }
            }
          }}
          open
          projectId={projectId}
        />
      ) : null}
      {collectionId ? (
        <BoardProjectContext.Provider value={projectId}>
          <GenerationWorkspace>
            <CollectionDrawer
              collectionId={collectionId}
              onClose={() => setCollectionId(null)}
            />
          </GenerationWorkspace>
        </BoardProjectContext.Provider>
      ) : null}
    </main>
    </>
  );
}

function LegacyRunHistory({
  conversationId,
  onError,
}: {
  readonly conversationId: string;
  readonly onError: (message: string | null) => void;
}) {
  const [runs, setRuns] = useState<readonly AgentRunView[]>([]);
  const [selected, setSelected] = useState<AgentRunView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void listAgentRuns(conversationId)
      .then((page) => {
        if (active) {
          setRuns(page.items);
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setLoading(false);
          onError(
            cause instanceof Error ? cause.message : "旧设计运行读取失败",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [conversationId, onError]);

  const open = async (runId: string) => {
    setLoading(true);
    try {
      setSelected(await fetchAgentRun(runId));
    } catch (cause) {
      onError(
        cause instanceof Error ? cause.message : "旧设计运行详情读取失败",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section aria-label="旧设计运行历史" className={styles.legacyRuns}>
      <h3>旧设计运行 · 只读</h3>
      <p>
        这些记录保留原来的目标、步骤、尝试与人工选择。后续设计请在主画布创建新分支。
      </p>
      {loading && runs.length === 0 ? <p>正在读取旧运行…</p> : null}
      {!loading && runs.length === 0 ? <p>当前会话没有旧设计运行。</p> : null}
      <div className={styles.legacyRunList}>
        {runs.map((run) => (
          <button
            aria-pressed={selected?.id === run.id}
            key={run.id}
            onClick={() => void open(run.id)}
            type="button"
          >
            <strong>{run.intent || "未命名设计目标"}</strong>
            <span>
              {run.status} · {new Date(run.createdAt).toLocaleString("zh-CN")}
            </span>
          </button>
        ))}
      </div>
      {selected ? (
        <div
          aria-label="旧运行详情"
          className={styles.legacyRunDetail}
          role="region"
        >
          <h4>{selected.intent || "未命名设计目标"}</h4>
          <p>运行状态：{selected.status}</p>
          {selected.intelligence?.brief ? (
            <section>
              <h5>设计简报</h5>
              <p>{selected.intelligence.brief.summary}</p>
              {selected.intelligence.brief.constraints.map((constraint) => (
                <p key={constraint.id}>
                  {constraint.priority === "must" ? "必须" : "偏好"} ·{" "}
                  {constraint.requirement}
                </p>
              ))}
            </section>
          ) : null}
          <section>
            <h5>节点与尝试</h5>
            <ol>
              {selected.steps.map((step) => (
                <li key={step.id}>
                  <strong>
                    {step.ordinal + 1}. {step.title} · {step.status}
                  </strong>
                  <p>{step.instruction}</p>
                  {step.prompt ? <p>提示词：{step.prompt}</p> : null}
                  {step.sourceAssetId ? (
                    <p>来源资产：{step.sourceAssetId}</p>
                  ) : null}
                  {step.selectedAssetId ? (
                    <p>人工选定：{step.selectedAssetId}</p>
                  ) : null}
                  {step.attempts?.map((attempt) => (
                    <div className={styles.legacyAttempt} key={attempt.id}>
                      <strong>
                        尝试 {attempt.ordinal} · {attempt.status}
                      </strong>
                      <p>提示词：{attempt.prompt}</p>
                      {attempt.parentAssetId ? (
                        <p>母图：{attempt.parentAssetId}</p>
                      ) : null}
                      {attempt.candidates.length ? (
                        <p>
                          候选：
                          {attempt.candidates
                            .map((candidate) => candidate.assetId)
                            .join("、")}
                        </p>
                      ) : null}
                      {attempt.error ? (
                        <p>
                          {attempt.status === "rejected" ? "否决理由" : "错误"}
                          ：{attempt.error}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </li>
              ))}
            </ol>
          </section>
          {selected.intelligence?.actions.length ? (
            <section>
              <h5>领域评价与修订</h5>
              {selected.intelligence.actions.map((action) => (
                <div className={styles.legacyAttempt} key={action.id}>
                  <strong>
                    {action.kind === "evaluate_candidate"
                      ? "候选评价"
                      : "修订建议"}{" "}
                    · {action.status}
                  </strong>
                  {action.evaluation ? (
                    <p>{action.evaluation.summary}</p>
                  ) : null}
                  {action.refinement ? (
                    <>
                      <p>{action.refinement.summary}</p>
                      <p>建议提示词：{action.refinement.prompt}</p>
                    </>
                  ) : null}
                  {action.error ? <p>{action.error}</p> : null}
                </div>
              ))}
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
