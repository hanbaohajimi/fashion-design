"use client";
import { tldrawAssetUrls } from "../tldraw-assets";
import dynamic from "next/dynamic";
import { discardWorkspaceDrafts } from "../../../components/drafts/draft-repository";
import { ProjectTaskCenter } from "../../tasks/ProjectTaskCenter";
import { ProjectTaskProvider } from "../../tasks/project-task-source";
import { WorkspaceSplit } from "../../../components/WorkspaceSplit";
import { useFeatureGuide } from "../../../components/feature-guide/FeatureGuideProvider";
import { CanvasSaveStatus } from "./CanvasSaveStatus";
import { visibleCanvasShapes } from "./canvas-visibility";
import { renderCanvasExport } from "./canvas-export-images";
import { privateRequestSignal } from "../../auth/private-fetch";
import { CanvasSourceRecovery } from "./CanvasSourceRecovery";
import { useWorkspaceFocusMode } from "../../../components/WorkspaceChrome";
import { ZhiyaAssistant, ZHIYA_ENABLED } from "../../assistant-character/ZhiyaAssistant";
import { IDLE_CHAT_ACTIVITY, type ChatActivity } from "../../assistant-character/project-activity";
import { useWorkspaceLayout } from "./use-workspace-layout";
import { GeneratedFilesPanel } from "./GeneratedFilesPanel";
import type { ImageToolEntryRequest } from "./image-tool-entry";
import { InfiniteWorkspace, type InfiniteWorkspaceHandle } from "./InfiniteWorkspace";
import { initializeCanvas, runCanvasCommand } from "./canvas-api";
import { useCanvasCommand } from "./use-canvas-command";
import { DesignWorkbench } from "./DesignWorkbench";
import { CanvasAction } from "./CanvasAction";
import { canvasMaterialTypeSchema, workflowToolKeySchema } from "@fashion/shared";
import { markResultArrival } from "./result-arrivals";
import { ImageResultArrivals } from "./image-result-arrivals";
import { markMotion } from "../../../components/motion/events";
import { useAuth } from "../../auth/AuthProvider";
import { readSwatchColors } from "@fashion/shared";
import { WorkflowImageInputs } from "./WorkflowImageInputs";
import {
  WorkflowDetailWorkspace,
  type DetailOrigin,
} from "./WorkflowDetailWorkspace";
import {
  WorkspaceDraftProvider,
  WorkspaceDraftStore,
  useWorkspaceDraftRevision,
} from "./workspace-drafts";
import detailStyles from "./workflow-detail-workspace.module.css";

import { CanvasProjectMenu, RenameProjectDialog } from "./CanvasProjectMenu";
import { CanvasShortcutEntry } from "./CanvasShortcutEntry";
import { canvasProjectFunctions, type CanvasProjectPanel } from "./canvas-project-functions";
import {
  Button,
  Dialog,
  SegmentedControl,
  Tooltip,
  TooltipGroup,
} from "../../../components/ui";
import { motionOptions } from "../../../components/ui-config";
import controls from "../../../components/ui.module.css";
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
import { clearProjectIntake, peekProjectIntake } from "../../projects/project-intake";
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
import { CanvasLicenseRequired } from "../CanvasLicenseRequired";
import { tldrawLicenseKey, tldrawLicenseRequired } from "../canvas-license";
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
import { WorkflowAssistantPanel, type WorkflowAssistantDraftRequest } from "./WorkflowAssistantPanel";
import { useWorkflowLayoutSave } from "./use-workflow-layout-save";
import type { WorkflowLayoutSave } from "./workflow-layout-save";
import { NodeDetails, ToolSettings } from "./WorkflowNodeDetails";
import {
  WorkflowMaterialEntry,
  WorkflowLibraryDialog,
} from "./WorkflowMaterialDialogs";
import { useSerialPolling } from "../../use-serial-polling";

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

const CREATIVE_STARTER_PROMPTS: Readonly<Record<string, string>> = {
  collection:
    "我想从一件适合秋冬通勤的外套开始做一组小系列。请先帮我梳理廓形、目标人群、面料方向与需要补充的信息，暂不生成图片。",
  material:
    "我想从一块自然肌理面料出发建立设计方向。请先分析它适合的触感、廓形、配色和穿着场景，整理成可以继续验证的设计约束，暂不生成图片。",
  lookbook:
    "我想为一个服装品牌做一组视觉提案。请先帮我梳理统一的视觉语言、画面结构、单品关系和需要补充的参考，暂不生成图片。",
  research:
    "我刚整理了一份趋势简报。请读取画布中的趋势来源和简报，先总结设计目标、来源依据与待验证假设，再整理成下一步设计计划，暂不生成图片。",
};

function readProjectIntakeBrief(projectId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return peekProjectIntake(window.sessionStorage, projectId);
  } catch {
    return null;
  }
}

function readCreativeStarterPrompt(intakeBrief: string | null): string | null {
  if (typeof window === "undefined") return null;
  const id = new URLSearchParams(window.location.search).get("starter");
  const starter = id ? CREATIVE_STARTER_PROMPTS[id] ?? null : null;
  return [starter, intakeBrief ? `设计者补充的初始简报：\n${intakeBrief}` : null]
    .filter((value): value is string => Boolean(value))
    .join("\n\n") || null;
}

function readStarterReferenceNodeIds(): string[] {
  if (typeof window === "undefined") return [];
  const params = new URLSearchParams(window.location.search);
  const multiple = (params.get("referenceNodeIds") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.length <= 128);
  if (multiple.length) return [...new Set(multiple)].slice(0, 16);
  const single = params.get("referenceNodeId");
  return single && single.length <= 128 ? [single] : [];
}

const toolInputHints = {
  generate_text: "要求与参考",
  analyze_brief: "需求与参考",
  generate_design: "约束与参考",
  evaluate_design: "图片与约束",
  edit_design: "图片",
  transform_image: "设计图片",
};
const TOOL_OPTIONS = getWorkflowToolCatalog().map((tool) => ({
  type: tool.key,
  title: tool.name,
  hint: `${toolInputHints[tool.key]} → ${tool.output.type === "constraint" ? "设计约束" : tool.output.type === "evaluation" ? "评估报告" : "新的设计方案"}`,
}));

const PORT_LABELS: Readonly<Record<WorkflowInputPort, string>> = {
  candidate: "设计图",
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
  readOnly = false,
}: {
  readonly graph: WorkflowGraph;
  readonly onEditor: (editor: Editor | null) => void;
  readonly onLayout: (
    positions: readonly { nodeId: string; x: number; y: number }[],
  ) => void;
  readonly onSelected: (id: string | null) => void;
  readonly proposal: WorkflowProposal | null;
  readonly selectedId: string | null;
  readonly readOnly?: boolean;
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
    () => {
      if (!readOnly) return projectWorkflowProposal(graph, proposal);
      const projected = projectWorkflowProposal(graph, null);
      const depths = nodeDepths(projected);
      const rows = new Map<number, number>();
      return { ...projected, nodes: [...projected.nodes].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map((node) => {
        const depth = depths.get(node.id) ?? 0;
        const row = rows.get(depth) ?? 0; rows.set(depth, row + 1);
        return { ...node, x: depth * 440 + 80, y: row * 440 + 80 };
      }) };
    },
    [graph, proposal, readOnly],
  );
  const lineage = useMemo(
    () => (selectedId ? focusPathOf(projectedGraph, selectedId) : null),
    [projectedGraph, selectedId],
  );

  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);
  useEffect(() => {
    editor.user.updateUserPreferences({ colorScheme: "light" });
    editor.updateInstanceState({ isReadonly: readOnly });
  }, [editor, readOnly]);
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
    editor.updateInstanceState({ isReadonly: false });
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
    editor.updateInstanceState({ isReadonly: readOnly });
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
        projectedGraph.nodes.find((node) => node.id === selectedId) ??
        projectedGraph.nodes.find((node) => node.type === "brief") ??
        projectedGraph.nodes[0];
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
    readOnly,
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
  const { session } = useAuth();
  return <ProjectTaskProvider key={`${session?.user.id ?? "guest"}:${projectId}`} projectId={projectId}><WorkflowCanvasSession projectId={projectId} /></ProjectTaskProvider>;
}

const CanvasProjectWorkspace = dynamic(() => import("./CanvasProjectWorkspace"), { ssr: false });

function WorkflowCanvasSession({ projectId }: WorkflowCanvasProps) {
  const [functionsReady, setFunctionsReady] = useState(false);
  const [projectWorkspace, setProjectWorkspace] = useState<{ active: CanvasProjectPanel | null; visited: CanvasProjectPanel[] }>({ active: null, visited: [] });
  const [renamingProject, setRenamingProject] = useState(false);
  const { session } = useAuth();
  const { startGuide } = useFeatureGuide();
  const [intakeBrief] = useState<string | null>(() => readProjectIntakeBrief(projectId));
  const [starterPrompt] = useState<string | null>(() => readCreativeStarterPrompt(intakeBrief));
  const [starterReferenceNodeIds] = useState<string[]>(readStarterReferenceNodeIds);
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
  const [assistantFocusInput, setAssistantFocusInput] = useState(false);
  const assistantPointer = useRef("mouse");
  const [chatActivity, setChatActivity] = useState<ChatActivity>(IDLE_CHAT_ACTIVITY);
  const [referenceRequest, setReferenceRequest] = useState<{
    nodeId?: string;
    nodeIds?: string[];
    nonce: number;
    instances?: Readonly<Record<string, readonly string[]>>;
    conversationId?: string | null;
    notice?: string;
    onConsumed?: () => void;
  } | null>(null);
  const [assistantDraftRequest, setAssistantDraftRequest] = useState<WorkflowAssistantDraftRequest | null>(null);
  const [referencesPreparing, setReferencesPreparing] = useState(false);
  const referenceFlight = useRef(false);
  const starterReferenceHandled = useRef(false);
  const intakeBriefFlight = useRef(false);
  const referenceConversation = useRef(activeConversationId);
  const canvasHandle = useRef<InfiniteWorkspaceHandle | null>(null);
  const openShortcut = useCallback(async (entryId: string, requestId: string) => {
    const handle = canvasHandle.current;
    if (!handle) throw new Error("画布尚未就绪，请稍后重试。");
    await handle.openFunction(entryId, requestId);
    if (canvasHandle.current?.editor !== handle.editor) throw new Error("工作区已切换，请回到原项目继续。");
  }, []);
  const changeAssistantConversation = useCallback((id: string | null) => {
    referenceConversation.current = id;
    setActiveConversationId(id);
  }, []);
  const [sourceEditor, setSourceEditor] = useState<Editor | null>(null);
  const sourceReadOnly = useValue("canvas-image-tool-permission", () => sourceEditor?.getIsReadonly() ?? true, [sourceEditor]);
  const [canvasMode, setCanvasMode] = useState<"canvas" | "node">("canvas");
  const [canvasCanEdit, setCanvasCanEdit] = useState(false);
  const [unavailableCharacter, setUnavailableCharacter] = useState<string | null>(null);
  const [manualTool, setManualTool] = useState<{ node: WorkflowNode; inputs: string[]; instances: Readonly<Record<string, readonly string[]>> } | null>(null);
  const manualCommand = useCanvasCommand(projectId, "manual-tool-command");
  const [retryingManual, setRetryingManual] = useState(false);
  const canvasSelection = useRef<string[]>([]);
  const [canvasView, setCanvasView] = useState<"workbench" | "workflow">("workbench");
  const pendingExport = useRef(false);
  const executionConversation = useRef<Promise<string> | null>(null);
  const graphRef = useRef<WorkflowGraph | null>(null);
  const assistantDraftSequence = useRef(0);
  const editorRef = useRef<Editor | null>(null);
  const [projectName, setProjectName] = useState("设计项目");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedCreationId, setFocusedCreationId] = useState<string | null>(null);
  const [arrivals, setArrivals] = useState<string[]>([]);
  const [menuTab, setMenuTab] = useState<MenuTab | null>(null);
  const [draftType, setDraftType] = useState<WorkflowAssetType | null>(null);
  const [libraryKind, setLibraryKind] = useState<LibraryKind | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sketchOpen, setSketchOpen] = useState(false);
  const [editingSketch, setEditingSketch] = useState<WorkflowNode | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  useEffect(() => {
    if (!starterPrompt && !starterReferenceNodeIds.length) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("starter");
    url.searchParams.delete("referenceNodeId");
    url.searchParams.delete("referenceNodeIds");
    window.history.replaceState(window.history.state, "", url);
  }, [projectId, starterPrompt, starterReferenceNodeIds]);
  useEffect(() => {
    if (!starterReferenceNodeIds.length || !graph || starterReferenceHandled.current) return;
    const referenceNodeIds = starterReferenceNodeIds.filter((id) => graph.nodes.some((node) => node.id === id));
    if (!referenceNodeIds.length) return;
    const nonce = Date.now();
    const frame = requestAnimationFrame(() => {
      setReferenceRequest(current => {
        starterReferenceHandled.current = true;
        return current ?? {
          nodeIds: referenceNodeIds,
          nonce,
          notice: referenceNodeIds.length > 1
            ? "已将研究报告、moodboard 和色彩参考带入本次讨论；核对后再发送。"
            : "已将刚保存的趋势简报带入本次讨论；核对后再发送。",
          onConsumed: () => setReferenceRequest(current => current?.nonce === nonce ? null : current),
        };
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [graph, starterReferenceNodeIds]);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("collectionId");
    if (!requested || requested.length > 128) return;
    const frame = requestAnimationFrame(() => setCollectionId(requested));
    return () => cancelAnimationFrame(frame);
  }, [projectId]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailOrigin, setDetailOrigin] = useState<DetailOrigin | null>(null);
  const [detailSessions, setDetailSessions] = useState<string[]>([]);
  const [detailEpochs, setDetailEpochs] = useState<Record<string, number>>({});
  const [assetHistoryRequest, setAssetHistoryRequest] = useState<ImageToolEntryRequest & { nodeId: string } | null>(null);
  const assetHistorySequence = useRef(0);
  const [draftStore] = useState(() => new WorkspaceDraftStore());
  useWorkspaceDraftRevision(draftStore);
  const detailBaseline = (node: WorkflowNode) =>
    node.type === "candidate"
      // Image contents are immutable per asset; permissions gate actions separately.
      ? JSON.stringify([node.payload.assetId])
      : JSON.stringify([
          node.title,
          node.payload,
          node.canEditPayload,
          node.canForkPayload,
          node.status,
        ]);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const inspectedRef = useRef<string | null>(null);
  const detailReturnFocus = useRef<HTMLElement | null>(null);
  const detailReturnFocusSelector = useRef<string | null>(null);
  useLayoutEffect(() => {
    inspectedRef.current = inspectedId;
  }, [inspectedId]);
  const {
    mode: layoutMode,
    sidebarOpen,
    setSidebarOpen,
    mobileView,
    setMobileView,
    canDock,
    setPresentation,
  } = useWorkspaceLayout({ projectId, ...(session ? { accountId: session.user.id } : {}), defaultOpen: false, assistantWindow: true });
  const openAssistant = useCallback((focusInput = assistantPointer.current !== "touch") => {
    setAssistantFocusInput(focusInput);
    setSidebarOpen(true);
    setMobileView("assistant");
    if (focusInput) setAssistantFocusRequest(value => value + 1);
  }, [setSidebarOpen, setMobileView]);
  const closeAssistant = useCallback(() => {
    setSidebarOpen(false);
    setMobileView("canvas");
    requestAnimationFrame(() => {
      const trigger = document.querySelector<HTMLElement>("[data-zhiya]:not([hidden]) [role=button]") ?? document.querySelector<HTMLElement>("[data-canvas-assistant-entry]");
      trigger?.focus({ preventScroll: true });
    });
  }, [setSidebarOpen, setMobileView]);
  const prepareAssistantFeedback = useCallback(async (request: {
    assetId: string;
    title: string;
    revision: number;
    prompt: string;
    commentIds: readonly string[];
  }) => {
    const source = graphRef.current?.nodes.find(
      node => node.type === "candidate" && node.payload.assetId === request.assetId,
    );
    const count = request.commentIds.length;
    setAssistantDraftRequest({
      nonce: ++assistantDraftSequence.current,
      prompt: request.prompt,
      ...(source ? { nodeIds: [source.id] } : {}),
      notice: source
        ? `已带入「${request.title}」和 ${count} 条已保存意见（图片意见 r${request.revision}）。发送前可继续编辑。`
        : `已带入 ${count} 条已保存意见（图片意见 r${request.revision}）。图片来源暂未定位，请发送前核对。`,
      onConsumed: () => setAssistantDraftRequest(null),
    });
    openAssistant(true);
  }, [openAssistant]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canvasInitAttempt, setCanvasInitAttempt] = useState(0);
  const [canvasInitResult, setCanvasInitResult] = useState<{ projectId: string; attempt: number; error: string | null } | null>(null);
  const canvasInitializing = canvasInitResult?.projectId !== projectId || canvasInitResult.attempt !== canvasInitAttempt;
  const canvasInitError = canvasInitializing ? null : canvasInitResult.error;
  useEffect(() => {
    let active = true;
    void initializeCanvas(projectId)
      .then((document) => {
        if (!active) return;
        setCanvasMode(document.mode);
        if (document.mode === "node") {
          try { if (sessionStorage.getItem("fashion:canvas-view") === "workflow") setCanvasView("workflow"); }
          catch { /* Legacy mode remains usable when browser storage is blocked. */ }
        }
        setCanvasCanEdit(document.canEdit);
        setCanvasInitResult({ projectId, attempt: canvasInitAttempt, error: null });
      })
      .catch((cause: unknown) => { if (active) setCanvasInitResult({ projectId, attempt: canvasInitAttempt, error: cause instanceof Error ? cause.message : "白板初始化失败，原数据保持不变" }); });
    return () => { active = false; };
  }, [projectId, canvasInitAttempt]);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const exportFlight = useRef<AbortController | null>(null);
  useEffect(() => () => { exportFlight.current?.abort(); }, [projectId]);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [canvasPanelOpen, setCanvasPanelOpen] = useState(false);
  const [creationPanelOpen, setCreationPanelOpen] = useState(false);
  const [objectHistoryOpen, setObjectHistoryOpen] = useState(false);
  const [generatedFilesOpen, setGeneratedFilesOpen] = useState(false);
  const changeCanvasView = (view: "workbench" | "workflow") => {
    setCanvasView(view);
    setMobileListOpen(false);
    setMobileView("canvas");
    setMenuTab(null);
    try {
      sessionStorage.setItem("fashion:canvas-view", view);
    } catch {
      /* The view still works without storage. */
    }
  };
  useEffect(() => {
    if (canvasMode !== "canvas" || !menuTab) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-workflow-add-menu] > button")?.focus());
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest("[data-workflow-add-menu], [data-canvas-menu-trigger]")) setMenuTab(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuTab(null);
        if (trigger?.isConnected) trigger.focus();
        else editorRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [canvasMode, menuTab]);
  useEffect(() => {
    const update = () => {
      document.documentElement.dataset.pageHidden = String(document.hidden);
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      delete document.documentElement.dataset.pageHidden;
    };
  }, []);
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const discardReply = useRef<((accepted: boolean) => void) | null>(null);
  const beforeLeave = useCallback(async () => {
    await canvasHandle.current?.flushLayout();
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
      if (editorRef.current?.getShape(nodeShapeId(inspectedId))) editorRef.current.select(nodeShapeId(inspectedId));
    }
  };
  const hasUnsavedDetails = useCallback(() => draftStore.hasDirty() || Boolean(canvasHandle.current?.hasUnsaved()), [draftStore]);
  const restoreDetailsFocus = useCallback(() => {
    const active = document.activeElement;
    if (document.hidden || active instanceof HTMLElement && active !== document.body && !active.closest('[aria-label="节点详情工作区"]')) return;
    const target = Array.from(
      document.querySelectorAll<HTMLElement>("[data-node-id]"),
    ).find(
      (element) =>
        element.dataset.nodeId === inspectedId &&
        element.getAttribute("role") === "group",
    );
    const focus = (detailReturnFocusSelector.current ? document.querySelector<HTMLElement>(detailReturnFocusSelector.current) : null) ?? target ?? detailReturnFocus.current;
    if (focus?.isConnected && focus.checkVisibility())
      focus.focus({ preventScroll: true });
  }, [inspectedId]);
  const closeDetails = useCallback(() => setDetailOpen(false), []);
  const selectNode = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);
  const openDetails = useCallback(
    (id: string) => {
      const target = graphRef.current?.nodes.find((node) => node.id === id);
      if (!target || target.status === "proposed") return;
      const element = Array.from(
        document.querySelectorAll<HTMLElement>("[data-node-id]"),
      ).find(
        (item) =>
          item.dataset.nodeId === id && item.getAttribute("role") === "group",
      );
      const trigger =
        element ??
        (document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null);
      detailReturnFocus.current = trigger;
      detailReturnFocusSelector.current = null;
      const bounds = element?.getBoundingClientRect();
      const keyboard =
        document.activeElement?.matches(":focus-visible") ?? false;
      setDetailOrigin(
        bounds
          ? {
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
              keyboard,
            }
          : null,
      );
      setDetailSessions((sessions) =>
        sessions.includes(id) ? sessions : [...sessions, id],
      );
      setSelectedId(id);
      setInspectedId(id);
      setDetailOpen(true);
      setMobileView("canvas");
      setMobileListOpen(false);
      if (editorRef.current?.getShape(nodeShapeId(id))) editorRef.current.select(nodeShapeId(id));
    },
    [setMobileView],
  );
  useEffect(() => {
    const ids = new Set(graph?.nodes.map((node) => node.id));
    for (const id of detailSessions)
      if (!ids.has(id)) {
        draftStore.removeOwner(id);
      }
  }, [draftStore, graph, detailSessions, inspectedId]);
  const setWorkspaceAssetId = (assetId: string) => {
    const node = graphRef.current?.nodes.find(
      (item) => item.payload.assetId === assetId,
    );
    if (node) openDetails(node.id);
  };
  const [imageArrivals] = useState(() => new ImageResultArrivals());
  useEffect(() => {
    if (!graph) return;
    const result = imageArrivals.observe(graph);
    if (!result.first) return;
    // Arrivals are offered in place; opening a viewer remains an explicit action.
    requestAnimationFrame(() => setArrivals(ids => [...new Set([...ids, ...result.fresh.map(node => node.id)])]));
  }, [graph, imageArrivals]);
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
        if (node.type === "fabric" && !known.has(node.id))
          markMotion(`node:${node.id}`, "material");
        const prior = previous.nodes.find((item) => item.id === node.id);
        if (
          node.kind === "tool" &&
          ["queued", "pending", "running", "processing"].includes(
            node.status,
          ) &&
          prior &&
          !["queued", "pending", "running", "processing"].includes(prior.status)
        ) {
          markMotion(
            `node:${node.id}`,
            "needle",
            `node:${node.id}:${next.revision}`,
          );
        }
      }
      const fresh = next.nodes.filter(
        (node) => node.type === "candidate" && node.payload.historicalImport !== true && !known.has(node.id),
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
          node.status === "pending",
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
          if (canvasMode === "node") {
            const next = await patchWorkflow(projectId, { baseRevision: packet.baseRevision, mode: "semantic", mutationId: packet.mutationId, operations });
            commitGraph(next); mutationPackets.current.delete(key); setError(null); return next;
          }
          if (canvasView === "workflow") throw new Error("流程图为只读视图，请返回设计工作台继续创作");
          let next = current;
          for (const operation of operations) {
            if (operation.type === "remove_node") { canvasHandle.current?.removePlacement(operation.nodeId); continue; }
            const commandId = operations.length === 1 ? packet.mutationId : crypto.randomUUID();
            if (operation.type === "update_node") {
              const node = next.nodes.find((item) => item.id === operation.nodeId);
              if (!node) throw new Error("素材已不存在");
              next = (await runCanvasCommand(projectId, node.kind === "tool" ? { type: "configure_tool", mutationId: commandId, nodeId: node.id, parameters: (operation.payload?.params ?? node.payload.params ?? {}) as Record<string, unknown> }
                : { type: "update_material", mutationId: commandId, nodeId: node.id, ...(operation.title ? { title: operation.title } : {}), payload: { ...node.payload, ...operation.payload } })).graph;
            } else if (operation.type === "link_collection") next = (await runCanvasCommand(projectId, { ...operation, mutationId: commandId })).graph;
            else if (operation.type === "add_node" && operation.node.kind === "asset") next = (await runCanvasCommand(projectId, { type: "create_material", mutationId: commandId, materialType: canvasMaterialTypeSchema.parse(operation.node.type), title: operation.node.title, payload: { ...operation.node.payload } })).graph;
            else throw new Error("请通过素材或图片工具完成此操作");
          }
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
    [canvasMode, canvasView, commitGraph, enqueue, projectId, reload],
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
  const focusedEditor = sketchOpen || detailOpen && inspected?.type === "candidate";
  useWorkspaceFocusMode(Boolean(focusedEditor));

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
        const response = canvasMode === "node" ? { graph: await mutate(operations), nodeId: id } : kind === "asset"
          ? await runCanvasCommand(projectId, { type: "create_material", mutationId: id, materialType: canvasMaterialTypeSchema.parse(type), title, payload: { ...payload }, position: { x, y } })
          : await runCanvasCommand(projectId, { type: "run_tool", mutationId: id, toolKey: workflowToolKeySchema.parse(type), title, parameters: (payload.params ?? {}) as Record<string, unknown>, inputs: canvasSelection.current.flatMap((nodeId) => {
            const node = current.nodes.find((item) => item.id === nodeId);
            if (!node) return [];
            const port: WorkflowInputPort = node.type === "brief" ? "goal" : node.type === "constraint" ? "constraint" : type === "edit_design" || type === "transform_image" ? "source" : type === "evaluate_design" ? "candidate" : "reference";
            return [{ nodeId, port }];
          }) });
        commitGraph(response.graph);
        pendingCreates.current.delete(createKey);
        setSelectedId(response.nodeId);
        setMenuTab(null);
        setDraftType(null);
        requestAnimationFrame(() => {
          canvasHandle.current?.locate(response.nodeId);
          editorRef.current?.zoomToSelection(motionOptions());
        });
        return response.nodeId;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "节点添加失败");
        throw cause;
      } finally {
        setBusy(false);
      }
    },
    [canvasMode, commitGraph, mutate, projectId, selectedId],
  );

  useEffect(() => {
    if (!intakeBrief || !graph || loading || intakeBriefFlight.current) return;
    const existing = graph.nodes.find(
      (node) => node.type === "brief" && node.payload.text === intakeBrief,
    );
    if (existing) {
      intakeBriefFlight.current = true;
      try {
        clearProjectIntake(window.sessionStorage, projectId);
      } catch {
        // Optional session storage must not block an already recovered brief.
      }
      return;
    }

    intakeBriefFlight.current = true;
    // The intake is an explicit user request; persist it as a graph node after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void addNode(
      "asset",
      "brief",
      "初始设计简报",
      {
        text: intakeBrief,
        source: "project-intake",
      },
    )
      .then(() => {
        try {
          clearProjectIntake(window.sessionStorage, projectId);
        } catch {
          // The brief is already persisted in the workflow graph.
        }
      })
      .catch(() => {
        intakeBriefFlight.current = false;
      });
  }, [addNode, graph, intakeBrief, loading, projectId]);

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
    if (exportFlight.current) return;
    const editor = editorRef.current;
    if (!editor) {
      pendingExport.current = true;
      changeCanvasView("workflow");
      return;
    }
    const shapeIds = visibleCanvasShapes(editor).map(shape => shape.id);
    if (shapeIds.length === 0) {
      setError("当前没有可导出的可见对象");
      return;
    }
    const controller = new AbortController();
    exportFlight.current = controller;
    const signal = privateRequestSignal(controller.signal);
    setExporting(true);
    setError(null);
    try {
      const rendered = await renderCanvasExport(editor, shapeIds, {
        background: true,
        format: "png",
        padding: 64,
        pixelRatio: 2,
      }, signal);
      if (signal.aborted || editorRef.current !== editor) return;
      const url = URL.createObjectURL(rendered.blob);
      const link = document.createElement("a");
      link.download = `fashion-workflow-${projectId}.png`;
      link.href = url;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : "画布导出失败");
    } finally {
      if (exportFlight.current === controller) {
        exportFlight.current = null;
        setExporting(false);
      }
    }
  };

  const locatedRequest = useRef("");
  useEffect(() => {
    if (!graph || loading) return;
    if (canvasMode === "canvas" && !sourceEditor) return;
    const query = new URLSearchParams(window.location.search);
    const assetId = query.get("assetId");
    const sourceShape = sourceEditor?.getCurrentPageShapes().find(shape => "assetId" in shape.props && shape.props.assetId === assetId);
    if (assetId && canvasMode === "canvas" && !sourceShape) return;
    const id = query.get("nodeId") ?? (typeof sourceShape?.meta.canvasNodeId === "string" ? sourceShape.meta.canvasNodeId : graph.nodes.find(node => node.payload.assetId === assetId)?.id);
    if (id && locatedRequest.current !== id && graph.nodes.some(node => node.id === id)) {
      locatedRequest.current = id;
      canvasHandle.current?.locate(id);
      openDetails(id);
    }
  }, [graph, loading, openDetails, sourceEditor, canvasMode]);

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
    <NodeDetails
      embedded
      readOnly={canvasMode === "canvas" && (canvasView === "workflow" || Boolean(sourceEditor?.getIsReadonly())) || sessionNode.canForkPayload === false && sessionNode.canEditPayload !== true || draftStore.ownerConflict(sessionNode.id)}
      placementOnly={canvasMode === "canvas"}
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
          setError(cause instanceof Error ? cause.message : "系列创建失败");
        } finally {
          setBusy(false);
        }
      }}
      onOpenAsset={() =>
        document
          .querySelector<HTMLElement>('[aria-label="图片资产操作"] button')
          ?.focus()
      }
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
      setError={setError}
    />
  );

  return (
    <>
      <main
        className={styles.shell}
        data-guide-page="workspace"
        data-guide-ready="true"
        data-layout-save-state={layoutSave.state}
        data-layout-pending-count={layoutSave.pendingCount}
        onPointerDownCapture={event => { assistantPointer.current = event.pointerType; }}
        onKeyDownCapture={(event) => {
          assistantPointer.current = "keyboard";
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
        <WorkspaceSplit
          className={styles.workspace}
          docked={layoutMode === "docked"}
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          manageOpenPreference={false}
          focusInputOnOpen={assistantFocusInput}
          projectId={projectId}
          assistantWindow={{ mode: layoutMode === "mobile" ? "mobile" : layoutMode === "docked" ? "docked" : "floating", canDock, onPresentationChange: setPresentation, onClose: closeAssistant }}
          data-mobile-view={mobileView}
          data-sidebar-open={sidebarOpen ? "true" : "false"}
        >
          <section
            aria-label="设计工作流画布"
            aria-hidden={layoutMode === "mobile" && sidebarOpen ? true : undefined}
            className={styles.canvasSection}
            data-canvas-view={canvasView}
            data-mobile-list-open={mobileListOpen ? "true" : "false"}
            data-canvas-panel-open={canvasPanelOpen ? "true" : "false"}
            inert={layoutMode === "mobile" && sidebarOpen ? true : undefined}
          >
            <div className={styles.canvasChrome} data-canvas-chrome hidden={Boolean(focusedEditor) || layoutMode === "mobile" && sidebarOpen}>
              <CanvasProjectMenu projectId={projectId} projectName={projectName} canEdit={canvasCanEdit} />
            </div>
            {session ? <CanvasShortcutEntry key={`${session.user.id}:${projectId}`} accountId={session.user.id} projectId={projectId}
              canvasReady={Boolean(sourceEditor) && !canvasInitializing && !canvasInitError} functionsReady={functionsReady} onOpen={openShortcut} /> : null}
            {sync.error || canvasMode === "node" && layoutSave.state === "error" ? <div className={styles.canvasSyncNotice} role="status">
              {sync.error ? <><span>画布同步异常：{sync.error}</span><Button onClick={sync.retry}>重试同步</Button></> : <><span>画布未保存</span><Button onClick={() => void layoutSave.queue.flush().catch(() => undefined)}>重试保存</Button></>}
            </div> : canvasMode === "node" ? <CanvasSaveStatus className={styles.canvasSyncNotice} label={layoutSave.state === "saving" ? "保存中…" : layoutSave.state === "dirty" ? "等待保存" : "已保存"} /> : null}
            {canvasView === "workbench" && !sidebarOpen && !focusedEditor && (canvasMode !== "canvas" || !ZHIYA_ENABLED || unavailableCharacter === projectId || canvasInitError) ? <div className={styles.canvasAssistantEntry}><CanvasAction
              data-canvas-assistant-entry
              data-guide="workspace-assistant"
              data-guide-variant="collapsed"
              label="展开设计助手" icon="comment"
              type="button"
              onClick={event => openAssistant(event.detail === 0 || assistantPointer.current !== "touch")}
            /></div> : null}
            {!focusedEditor && !(layoutMode === "mobile" && sidebarOpen) ? <CanvasSourceRecovery key={projectId} projectId={projectId} graph={graph}
              editor={sourceEditor}
              canPlace={canvasMode === "canvas" && canvasView === "workbench" && !canvasInitializing && !canvasInitError && Boolean(sourceEditor)}
              onPlaced={async (next, nodeId) => {
                commitGraph(next);
                await canvasHandle.current?.refresh();
                canvasHandle.current?.locate(nodeId);
                openDetails(nodeId);
              }} /> : null}
            {canvasMode === "canvas" && canvasView === "workbench" ? <ZhiyaAssistant
              projectId={projectId}
              chatOpen={sidebarOpen}
              mobile={layoutMode === "mobile"}
              chatActivity={chatActivity}
              suspended={canvasInitializing || Boolean(canvasInitError) || detailOpen || Boolean(menuTab) || mobileListOpen || generatedFilesOpen || objectHistoryOpen || Boolean(collectionId) || historyOpen || helpOpen || sketchOpen || creationPanelOpen || Boolean(projectWorkspace.active) || layoutMode === "mobile" && canvasPanelOpen}
              onOpenChat={openAssistant}
              onUnavailable={() => setUnavailableCharacter(projectId)}
            /> : null}
            <div
              className={styles.canvasBackdrop}
              inert={canvasInitializing || Boolean(canvasInitError) || detailOpen && Boolean(inspected)}
              data-detail-open={detailOpen && Boolean(inspected)}
              data-initializing={canvasInitializing || Boolean(canvasInitError)}
            >
              {canvasMode === "node" ? <div className={styles.viewSwitch} data-guide="workspace-views">
                <SegmentedControl
                  label="画布呈现"
                  value={canvasView}
                  options={[
                    { value: "workbench", label: "设计工作台" },
                    { value: "workflow", label: "流程画布" },
                  ]}
                  onChange={changeCanvasView}
                />
              </div> : null}
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
                  <ul
                    className={styles.edgeLegend}
                    aria-label="连线颜色图例"
                    role="list"
                  >
                    {EDGE_LEGEND_ITEMS.map(({ label, color }) => (
                      <li key={label}>
                        <svg
                          width="24"
                          height="10"
                          viewBox="0 0 24 10"
                          aria-hidden="true"
                          style={{ color }}
                        >
                          <path
                            d="M 1 5 H 19"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                          <path
                            d="M 18 1 L 24 5 L 18 9 Z"
                            fill="currentColor"
                          />
                        </svg>
                        {label}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {arrivals.some((id) =>
                  graph.nodes.some((node) => node.id === id),
                ) ? (
                  <div
                    className={styles.arrivalNotice}
                    role="status"
                    style={
                      detailOpen
                        ? {
                            position: "fixed",
                            top: 60,
                            left: "50%",
                            transform: "translateX(-50%)",
                            zIndex: 150,
                          }
                        : undefined
                    }
                  >
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
                  disabled={canvasMode === "canvas" && canvasView === "workflow"}
                  editor={() => editorRef.current}
                  onAdd={async (type, title, payload, point) => {
                    await addNode(
                      "asset",
                      type,
                      title,
                      payload,
                      point,
                    );
                  }}
                >
                    {canvasInitializing || canvasInitError ? null : canvasMode === "canvas" ? <InfiniteWorkspace
                      key={projectId}
                      projectId={projectId}
                      graph={graph}
                      onEnsureConversation={ensureConversation}
                      active={canvasView === "workbench"}
                      mediaActive={!detailOpen && !generatedFilesOpen && !objectHistoryOpen && !collectionId && !historyOpen && !helpOpen && !sketchOpen && !menuTab && !mobileListOpen && !projectWorkspace.active && !(layoutMode === "mobile" && canvasPanelOpen)}
                      onEditor={(editor) => { editorRef.current = editor; }}
                      onReady={(handle) => { canvasHandle.current = handle; setSourceEditor(handle?.editor ?? null); }}
                      onGraph={commitGraph}
                      onError={setError}
                      onOpen={openDetails}
                      onAddMaterial={() => setMenuTab("assets")}
                      toolActions={{
                        onFunctionsReady: setFunctionsReady,
                        projectFunctions: canvasProjectFunctions.filter(item => item.id !== "canvas-legacy" || graph.legacyAvailable).map(item => ({ ...item, disabled: item.id === "project-rename" ? !canvasCanEdit : item.id === "canvas-export" ? exporting : false })),
                        onProjectFunction: async (id) => {
                          const item = canvasProjectFunctions.find(item => item.id === id);
                          if (item?.panel) {
                            const tab = item.panel;
                            setProjectWorkspace(current => ({ active: tab, visited: current.visited.includes(tab) ? current.visited : [...current.visited, tab] }));
                          } else if (id === "project-rename" && canvasCanEdit) setRenamingProject(true);
                          else if (id === "project-files") setGeneratedFilesOpen(true);
                          else if (id === "project-tasks") window.dispatchEvent(new CustomEvent("fashion-project:tasks", { detail: { projectId } }));
                          else if (id === "canvas-export" && !exporting) await exportCanvas();
                          else if (id === "canvas-legacy" && graph.legacyAvailable) setHistoryOpen(true);
                          else if (id === "canvas-help") setHelpOpen(true);
                        },
                        onCanvasPanelOpenChange: setCanvasPanelOpen,
                        onCreationPanelOpenChange: setCreationPanelOpen,
                        onObjectHistoryOpenChange: setObjectHistoryOpen,
                        onOpenAssetHistory: (nodeId, assetId) => {
                          const target = graphRef.current?.nodes.find(node => node.id === nodeId && ["candidate", "reference_image", "sketch"].includes(node.type) && node.payload.assetId === assetId && node.status !== "proposed");
                          if (!target) return false;
                          openDetails(nodeId);
                          setAssetHistoryRequest({ nodeId, assetId, action: "history", nonce: ++assetHistorySequence.current });
                          return true;
                        },
                        imageToolNodeIds: graph.nodes.filter(node => ["candidate", "reference_image", "sketch"].includes(node.type) && node.status !== "proposed").map(node => node.id),
                        onOpenImageTool: (nodeId, assetId, action) => {
                          const target = graphRef.current?.nodes.find(node => node.id === nodeId && ["candidate", "reference_image", "sketch"].includes(node.type) && node.payload.assetId === assetId && node.status !== "proposed");
                          if (!target || sourceReadOnly) return;
                          openDetails(nodeId);
                          const primary = `[data-creation-image-tools] [data-image-action="${action}"]`;
                          const more = '[data-creation-image-tools] [aria-label="更多图片操作"]';
                          const selector = document.querySelector(primary) ? primary : document.querySelector(more) ? more : '[data-guide="workspace-functions"]';
                          detailReturnFocusSelector.current = selector;
                          detailReturnFocus.current = document.querySelector<HTMLElement>(selector);
                          setAssetHistoryRequest({ nodeId, assetId, action, nonce: ++assetHistorySequence.current });
                        },
                        assistantOpen: sidebarOpen,
                        onStartConversation: openAssistant,
                        toolsOpen: menuTab === "tools",
                        collectionsOpen: Boolean(collectionId) || projectWorkspace.active === "planning",
                        onOpenCollections: () => setProjectWorkspace(current => ({ active: "planning", visited: current.visited.includes("planning") ? current.visited : [...current.visited, "planning"] })),
                        onOpenFabrics: () => handleAssetOption("fabric"),
                        onOpenTrends: () => handleAssetOption("trend"),
                        onOpenSketch: () => handleAssetOption("sketch"),
                        onUpload: () => handleAssetOption("reference_image"),
                        onUseTools: () => setMenuTab(current => current === "tools" ? null : "tools"),
                        referencesPreparing,
                        onReferenceNodeIds: (nodeIds) => {
                          setReferenceRequest({ nodeIds: [...nodeIds], conversationId: referenceConversation.current, nonce: Date.now() });
                          openAssistant(false);
                        },
                        onReference: () => {
                          const canvas = canvasHandle.current;
                          if (!canvas || referenceFlight.current) return;
                          const conversation = referenceConversation.current;
                          const focusInput = assistantPointer.current !== "touch";
                          referenceFlight.current = true;
                          setReferencesPreparing(true);
                          const finish = () => {
                            referenceFlight.current = false;
                            setReferencesPreparing(false);
                          };
                          void canvas.captureReferences().then((selection) => {
                            if (canvasHandle.current !== canvas || referenceConversation.current !== conversation) { finish(); return; }
                            setReferenceRequest({ ...selection, conversationId: conversation, nonce: Date.now(), onConsumed: finish });
                            openAssistant(focusInput);
                          }).catch((cause: unknown) => {
                            finish();
                            if (canvasHandle.current === canvas) setError(cause instanceof Error ? cause.message : "素材尚未准备好，请重试引用。");
                          });
                        },
                      }}
                      onSelection={(nodeIds) => {
                        const creationId = canvasHandle.current?.editor.getOnlySelectedShape()?.meta.canvasCreationId;
                        setFocusedCreationId(typeof creationId === "string" ? creationId : null);
                        canvasSelection.current = nodeIds;
                        setSelectedId(nodeIds[0] ?? null);
                      }}
                    /> : canvasView === "workbench" ? <DesignWorkbench graph={graph} assistantOpen={sidebarOpen} pendingProposal={proposal?.status === "pending"} onOpen={openDetails} onAdd={() => setMenuTab("assets")} onStart={() => { setSidebarOpen(true); setMobileView("assistant"); setAssistantFocusRequest((value) => value + 1); }} onReference={(nodeId) => { setSelectedId(nodeId); setReferenceRequest({ nodeId, nonce: Date.now() }); setSidebarOpen(true); setMobileView("assistant"); }} /> : null}
                  {canvasView === "workflow" ? tldrawLicenseRequired ? (
                    <CanvasLicenseRequired compact />
                  ) : (
                    <WorkflowInteractionProvider
                      readOnly={canvasMode === "canvas"}
                      graph={graph}
                      editorRef={editorRef}
                      onEdit={editInput}
                      onDetails={openDetails}
                    >
                      <Tldraw
                        assetUrls={tldrawAssetUrls}
                        hideUi
                        locale="zh-cn"
                        options={{ createTextOnCanvasDoubleClick: false }}
                        overrides={workflowUiOverrides}
                        shapeUtils={[
                          WorkflowNodeShapeUtil,
                          WorkflowEdgeShapeUtil,
                        ]}
                        store={store}
                        {...(tldrawLicenseKey
                          ? { licenseKey: tldrawLicenseKey }
                          : {})}
                      >
                        <WorkflowProjection
                          readOnly={canvasMode === "canvas"}
                          graph={graph}
                          onEditor={(editor) => {
                            editorRef.current = editor;
                            if (editor && pendingExport.current) {
                              pendingExport.current = false;
                              requestAnimationFrame(() => void exportCanvas());
                            }
                          }}
                          onLayout={saveLayout}
                          onSelected={selectNode}
                          proposal={proposal}
                          selectedId={selectedId}
                        />
                        {canvasMode === "node" ? <WorkflowConnectionOverlay graph={graph} /> : null}
                      </Tldraw>
                    </WorkflowInteractionProvider>
                  ) : null}
                </WorkflowImageInputs>
                {canvasView === "workflow" && graph.nodes.length === 0 ? (
                  <div className={styles.emptyState}>
                    <h2>让想法成为设计方案</h2>
                    <p>
                      在左侧助手里描述需求，确认后生成。素材与结果会自动保存在画布上。
                    </p>
                    <button
                      onClick={() => {
                        setSidebarOpen(true);
                        setMobileView("assistant");
                        setAssistantFocusRequest((current) => current + 1);
                      }}
                      type="button"
                    >
                      开始设计对话
                    </button>
                  </div>
                ) : null}
                {canvasMode !== "canvas" && canvasView === "workbench" && graph.nodes.length === 0 && !sidebarOpen ? (
                  <div className={styles.emptyState}>
                    <h2>从一个想法开始</h2>
                    <p>
                      打开助手，描述设计方向；或拖入参考图、趋势卡片直接开始。
                    </p>
                    <button
                      onClick={() => openAssistant(true)}
                      type="button"
                    >
                      打开设计助手
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

              {(canvasMode === "canvas" ? canvasView === "workbench" && menuTab : canvasView === "workflow" || menuTab) ? (
                <div
                  className={canvasMode === "canvas" ? styles.canvasAddMenu : `${styles.bottomMenu} ${controls.controlSurface}`}
                >
                  {canvasMode !== "canvas" ? <>
                  <button
                    data-material-trigger
                    data-guide="workspace-materials"
                    aria-expanded={menuTab === "assets"}
                    onClick={() =>
                      setMenuTab(menuTab === "assets" ? null : "assets")
                    }
                    type="button"
                  >
                    ＋ 添加素材
                  </button>
                  {canvasView === "workflow" ? (
                    <>
                      <span className={styles.menuDivider} />
                      <button
                        aria-expanded={menuTab === "tools"}
                        onClick={() =>
                          setMenuTab(menuTab === "tools" ? null : "tools")
                        }
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
                    </>
                  ) : null}
                  </> : null}
                  {menuTab ? (
                    <div className={styles.addPopover} data-workflow-add-menu>
                      <header>
                        <strong>
                          {menuTab === "assets"
                            ? "添加设计素材"
                            : "使用设计工具"}
                        </strong>
                        <button
                          aria-label="关闭菜单"
                          onClick={() => setMenuTab(null)}
                          type="button"
                        >
                          ×
                        </button>
                      </header>
                      {(menuTab === "assets"
                        ? ASSET_OPTIONS
                        : TOOL_OPTIONS
                      ).map((option) => (
                        <button
                          key={option.type}
                          onClick={() => {
                            if (menuTab === "assets")
                              handleAssetOption(
                                option.type as WorkflowAssetType,
                              );
                            else {
                              const tool = getWorkflowToolContract(
                                option.type as WorkflowToolKey,
                              );
                              if (canvasMode === "canvas") {
                                const instances = canvasHandle.current?.selectionInstances() ?? {};
                                setManualTool({ node: { id: crypto.randomUUID(), kind: "tool", type: option.type as WorkflowToolType, title: option.title, payload: { toolKey: tool.key, toolVersion: tool.version, params: { ...tool.defaults, prompt: "" } }, x: 0, y: 0, status: "ready", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, inputs: Object.keys(instances), instances });
                                setMenuTab(null);
                                return;
                              }
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
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {error || notice || manualCommand.pending ? (
                <div
                  aria-live="polite"
                  className={`${error ? styles.errorNotice : styles.successNotice} ${styles.canvasNotice} ${canvasMode === "canvas" && canvasView === "workbench" ? styles.workspaceNotice : ""}`}
                  role={error ? "alert" : "status"}
                >
                  {error ? userFacingError(error) : notice ?? "上一次工具操作尚未确认，可继续处理原操作。"}
                  {manualCommand.pending ? <Button disabled={retryingManual} onClick={() => {
                    setRetryingManual(true);
                    void manualCommand.execute().then(result => { commitGraph(result.graph); setManualTool(null); setError(null); setNotice("原操作已恢复"); }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "恢复未完成")).finally(() => setRetryingManual(false));
                  }}>{retryingManual ? "正在恢复…" : "重试原工具操作"}</Button> : null}
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
            {canvasInitializing || canvasInitError ? <section className={styles.canvasInitialization} role={canvasInitError ? "alert" : "status"}>
              <h2>{canvasInitError ? "暂时无法打开白板" : "正在打开白板"}</h2>
              <p>{canvasInitError ?? "正在恢复素材和上次保存的内容。"}</p>
              {canvasInitError ? <Button onClick={() => setCanvasInitAttempt(value => value + 1)}>重试载入白板</Button> : null}
            </section> : null}
            {manualTool ? <WorkflowDetailWorkspace open title={manualTool.node.title} status="ready" origin={null} dirty={false} onClose={() => setManualTool(null)}>
              <ToolSettings key={manualTool.node.id} draftMode readOnly={false} node={manualTool.node} graph={graph} projectId={projectId} referenceNodeIds={manualTool.inputs}
                inputs={manualTool.inputs.length || (["analyze_brief", "generate_design"].includes(manualTool.node.type) ? 1 : 0)}
                onGraphChange={commitGraph} onEnsureConversation={ensureConversation} setError={setError}
                onSavePayload={async (_id, payload) => { setManualTool((current) => current ? { ...current, node: { ...current.node, payload } } : current); }}
                onExecute={async () => {
                  await canvasHandle.current?.flush();
                  const selected = canvasHandle.current?.resolveReferences(manualTool.inputs, manualTool.instances).nodeIds ?? manualTool.inputs;
                  const toolKey = workflowToolKeySchema.parse(manualTool.node.type);
                  const parameters = manualTool.node.payload.params as Record<string, unknown>;
                  const inputs = selected.flatMap((id) => { const node = graphRef.current?.nodes.find((item) => item.id === id); if (!node) return []; const port: WorkflowInputPort = node.type === "brief" || node.type === "reference_text" && toolKey === "analyze_brief" ? "goal" : node.type === "constraint" ? "constraint" : toolKey === "edit_design" || toolKey === "transform_image" ? "source" : toolKey === "evaluate_design" ? "candidate" : "reference"; return [{ nodeId: id, port }]; });
                  const result = await manualCommand.execute({ type: "run_tool", mutationId: manualTool.node.id, toolKey, title: manualTool.node.title, parameters, inputs, ...(!inputs.some((input) => input.port === "goal" || input.port === "constraint") && ["analyze_brief", "generate_design"].includes(toolKey) ? { newObjective: String(parameters.prompt ?? "") } : {}), conversationId: await ensureConversation() });
                  commitGraph(result.graph); setManualTool(null);
                }} />
            </WorkflowDetailWorkspace> : null}
            <WorkflowDetailWorkspace
              fullScreen={Boolean(inspected && ["candidate", "reference_image", "sketch"].includes(inspected.type) && typeof inspected.payload.assetId === "string" && (inspected.type !== "sketch" || assetHistoryRequest?.nodeId === inspected.id))}
              open={detailOpen && Boolean(inspected)}
              title={inspected ? displayNodeTitle(inspected) : "节点详情"}
              status={inspected?.status ?? "ready"}
              origin={detailOrigin}
              dirty={Boolean(inspectedId && draftStore.ownerDirty(inspectedId))}
              onClose={closeDetails}
              onAfterClose={restoreDetailsFocus}
            >
              {detailSessions.map((id) => {
                const sessionNode = graph.nodes.find((node) => node.id === id);
                if (!sessionNode) return null;
                const baseline = detailBaseline(sessionNode);
                const dirty = draftStore.ownerDirty(id);
                const conflict = draftStore.ownerConflict(id);
                const discard = async () => {
                  await discardWorkspaceDrafts(key => { const parts = JSON.parse(key) as string[]; return parts[3]?.endsWith(`:${id}`) === true; });
                  draftStore.removeOwner(id);
                  setDetailEpochs((epochs) => ({
                    ...epochs,
                    [id]: (epochs[id] ?? 0) + 1,
                  }));
                };
                const editable = (canvasMode === "node" || canvasView === "workbench") && (
                  sessionNode.canEditPayload === true ||
                  sessionNode.canForkPayload !== false);
                // Image tools save new versions; payload flags protect the original history.
                const imageEditable = canvasMode === "canvas" ? canvasView === "workbench" && !sourceReadOnly && sessionNode.status !== "proposed" : editable;
                const closeSession = () => {
                  if (inspectedRef.current === id) closeDetails();
                };
                return (
                  <div
                    key={id}
                    hidden={id !== inspectedId}
                    className={detailStyles.session}
                  >
                    {dirty ? (
                      <div className={detailStyles.draftWarning}>
                        {conflict
                          ? "节点内容或权限已更新，草稿仍保留。请载入最新内容后重新编辑。"
                          : "修改已暂存于本次工作区，尚未保存。"}
                        <button
                          type="button"
                          disabled={draftStore.ownerLocked(id)}
                          onClick={discard}
                        >
                          {conflict ? "载入最新内容并放弃草稿" : "放弃修改"}
                        </button>
                      </div>
                    ) : null}
                    <WorkspaceDraftProvider
                      store={draftStore}
                      owner={id}
                      baseline={baseline}
                      key={`${id}:${detailEpochs[id] ?? 0}:${draftStore.ownerEpoch(id)}`}
                    >
                      <fieldset
                        className={detailStyles.editorFieldset}
                        disabled={conflict && sessionNode.type !== "candidate"}
                      >
                        {canvasMode === "canvas" && canvasView === "workflow" ? <>
                          <Button onClick={() => { setCanvasView("workbench"); requestAnimationFrame(() => canvasHandle.current?.locate(id)); }}>定位到白板继续创作</Button>
                          {renderDetails(sessionNode)}
                        </> : sessionNode.type === "swatch" &&
                        (editable || dirty) ? (
                          <WorkflowMaterialEntry
                            embedded
                            type="swatch"
                            initialTitle={sessionNode.title}
                            initialPayload={sessionNode.payload}
                            busy={busy}
                            onClose={closeSession}
                            onAdd={async (title, payload) => {
                              if (sessionNode.canEditPayload === true)
                                await mutate([
                                  {
                                    type: "update_node",
                                    nodeId: id,
                                    title,
                                    payload: {
                                      ...sessionNode.payload,
                                      ...payload,
                                    },
                                  },
                                ]);
                              else
                                await addNode("asset", "swatch", title, {
                                  ...payload,
                                  sourceNodeId: id,
                                });
                            }}
                          />
                        ) : sessionNode.type === "sketch" &&
                          (editable || dirty) && assetHistoryRequest?.nodeId !== id ? (
                          <WorkflowSketchEditor
                            embedded
                            ignoreStoredDraft={(detailEpochs[id] ?? 0) > 0}
                            node={sessionNode}
                            open
                            projectId={projectId}
                            onClose={closeSession}
                            onCreated={async ({ title, ...asset }) => {
                              if (sessionNode.canEditPayload === true)
                                await mutate([
                                  {
                                    type: "update_node",
                                    nodeId: id,
                                    title,
                                    payload: {
                                      ...sessionNode.payload,
                                      ...asset,
                                    },
                                  },
                                ]);
                              else
                                await addNode("asset", "sketch", title, {
                                  ...asset,
                                  sourceNodeId: id,
                                  source: "designer_sketch",
                                });
                            }}
                          />
                        ) : ["candidate", "reference_image", "sketch"].includes(sessionNode.type) &&
                          typeof sessionNode.payload.assetId === "string" ? (
                          <>
                            <BoardProjectContext.Provider value={projectId}>
                              <WorkflowAssetWorkspace
                                embedded
                                assetId={sessionNode.payload.assetId}
                                entryRequest={assetHistoryRequest?.nodeId === id && assetHistoryRequest.assetId === sessionNode.payload.assetId ? assetHistoryRequest : undefined}
                                active={detailOpen && inspectedId === id}
                                canEdit={!conflict && imageEditable}
                                open
                                projectId={projectId}
                                tasks={graph.nodes.filter(
                                  (node) =>
                                    node.kind === "tool" &&
                                    graph.edges.some(
                                      (edge) =>
                                        edge.sourceNodeId === sessionNode.id &&
                                        edge.targetNodeId === node.id &&
                                        edge.targetPort === "source",
                                    ),
                                )}
                                candidates={graph.nodes.filter(
                                  (node) => node.type === "candidate",
                                )}
                                onSelectAsset={setWorkspaceAssetId}
                                onRestoredAsset={({ graph: restoredGraph, assetId }) => {
                                  commitGraph(restoredGraph);
                                  setWorkspaceAssetId(assetId);
                                }}
                                onClose={closeSession}
                                onEnsureConversation={ensureConversation}
                                onPrepareAssistantFeedback={prepareAssistantFeedback}
                                onGraphRefresh={() => {
                                  void reload().catch((cause: unknown) =>
                                    setError(
                                      cause instanceof Error
                                        ? cause.message
                                        : "工作流刷新失败",
                                    ),
                                  );
                                }}
                              />
                            </BoardProjectContext.Provider>
                          </>
                        ) : (
                          renderDetails(sessionNode)
                        )}
                        {(sessionNode.type === "sketch" ||
                          sessionNode.type === "swatch") &&
                        (editable || dirty) ? (
                          <details className={detailStyles.metadata}>
                            <summary>素材详情与用途</summary>
                            {renderDetails(sessionNode)}
                          </details>
                        ) : null}
                      </fieldset>
                    </WorkspaceDraftProvider>
                  </div>
                );
              })}
            </WorkflowDetailWorkspace>
          </section>

          <aside
            id="workflow-design-assistant"
            aria-label="设计助手"
            className={`${styles.sidebar} ${controls.controlSurface}`}
            hidden={!sidebarOpen}
          >
            <div className={styles.assistantMount}>
              <WorkflowAssistantPanel
                canManageAssistant={canvasCanEdit}
                onVisitReference={(nodeId, instances) => {
                  const handle = canvasHandle.current;
                  if (!handle || canvasMode !== "canvas") return false;
                  if (layoutMode !== "mobile") return handle.visitReference(nodeId, instances);
                  if (!handle.editor.getCurrentPageShapes().some(shape => shape.meta.canvasNodeId === nodeId && !handle.editor.isShapeHidden(shape))) return false;
                  setMobileView("canvas"); setSidebarOpen(false);
                  requestAnimationFrame(() => handle.visitReference(nodeId, instances, () => { setSidebarOpen(true); setMobileView("assistant"); }));
                  return true;
                }}
                focusedCreationId={focusedCreationId}
                graph={graph}
                starterPrompt={starterPrompt}
                assistantDraftRequest={assistantDraftRequest}
                onOpenGeneratedFiles={() => setGeneratedFilesOpen(true)}
                canUploadReferences={canvasMode === "canvas" && canvasView === "workbench" && Boolean(sourceEditor && !sourceEditor.getIsReadonly())}
                referencePlacement={{
                  canPlace: canvasMode === "canvas" && canvasView === "workbench" && Boolean(sourceEditor && !sourceEditor.getIsReadonly()),
                  isPlaced: nodeId => Boolean(sourceEditor?.getCurrentPageShapes().some(shape => shape.meta.canvasNodeId === nodeId)),
                  prepare: async signal => {
                    const handle = canvasHandle.current;
                    if (!handle || handle.editor.getIsReadonly()) throw new Error("当前白板不可编辑，请核对权限后继续。");
                    await handle.flushLayout(); signal.throwIfAborted();
                    if (canvasHandle.current !== handle) throw new Error("工作区已切换，请回到原项目继续。");
                    const center = handle.editor.getViewportPageBounds().center;
                    const boxes = handle.editor.getCurrentPageShapes().map(shape => handle.editor.getShapePageBounds(shape)).filter(Boolean);
                    for (let slot = 0; slot < 200; slot++) {
                      const point = { x: center.x - 160 + slot % 4 * 360, y: center.y - 190 + Math.floor(slot / 4) * 420 };
                      if (!boxes.some(box => box && point.x < box.maxX + 20 && point.x + 320 > box.minX - 20 && point.y < box.maxY + 20 && point.y + 380 > box.minY - 20)) return point;
                    }
                    return { x: center.x + 1480, y: center.y };
                  },
                  apply: async (result, signal) => {
                    signal.throwIfAborted();
                    const handle = canvasHandle.current;
                    if (!handle || result.canvas.projectId !== projectId || handle.editor.getIsReadonly()) throw new Error("白板已切换或不可编辑，请回到原项目确认放置。");
                    commitGraph(result.graph); handle.applyResult(result.canvas, result.graph);
                    await handle.flushLayout(); signal.throwIfAborted();
                  },
                  locate: nodeId => {
                    setMobileView("canvas");
                    if (layoutMode === "mobile" || layoutMode === "overlay") setSidebarOpen(false);
                    canvasHandle.current?.locate(nodeId);
                  },
                }}
                onPrepareImageImport={async signal => {
                  signal.throwIfAborted();
                  const handle = canvasHandle.current;
                  if (!handle || handle.editor.getIsReadonly()) throw new Error("白板暂时不可编辑，请核对权限后继续。");
                  await handle.flushLayout(); signal.throwIfAborted();
                  if (canvasHandle.current !== handle) throw new Error("工作区已切换，请回到原项目继续。");
                }}
                onImageImported={async (result, signal) => {
                  signal.throwIfAborted();
                  const handle = canvasHandle.current;
                  if (!handle || result.canvas.projectId !== projectId) throw new Error("白板已切换，请回到原项目继续确认。");
                  commitGraph(result.graph);
                  handle.applyResult(result.canvas, result.graph);
                  await handle.flushLayout(); signal.throwIfAborted();
                }}
                referenceRequest={referenceRequest}
                referencesPreparing={referencesPreparing}
                directExecution={canvasMode === "canvas"}
                onExecution={() => { setCanvasView("workbench"); window.dispatchEvent(new Event("fashion-creations:refresh")); }}
                onBeforeSend={async (ids, instances) => {
                  if (canvasMode === "node") return { nodeIds: [...ids], instances };
                  const canvas = canvasHandle.current;
                  if (!canvas) throw new Error("白板尚未载入完成，请稍后发送");
                  const creationContext = await canvas.prepareAssistantContext();
                  await canvas.flush();
                  if (canvasHandle.current !== canvas) throw new Error("工作区已切换，尚未发送给助手。");
                  const observation = canvas.observeAssistantCanvas();
                  return { ...canvas.resolveReferences(ids, instances), ...creationContext, ...(observation ? { canvasObservation: observation } : {}) };
                }}
                onBeforeEnhance={async (ids, instances) => {
                  if (canvasMode === "node") return { nodeIds: [...ids], instances };
                  const canvas = canvasHandle.current;
                  if (!canvas) throw new Error("白板尚未载入完成，请稍后增强。");
                  await canvas.flush();
                  if (canvasHandle.current !== canvas) throw new Error("工作区已切换，原文已保留。");
                  return canvas.resolveReferences(ids, instances);
                }}
                onExecuteCanvasAction={async envelope => {
                  const canvas = canvasHandle.current;
                  if (!canvas || canvasView !== "workbench") throw new Error("请返回当前项目画布后继续操作。");
                  if (envelope.action.type === "open_panel" && layoutMode === "mobile") { setMobileView("canvas"); setSidebarOpen(false); }
                  return canvas.executeAssistantCanvasAction(envelope);
                }}
                focusRequest={assistantFocusRequest}
                onOpenResult={(nodeId) => {
                  const node = graphRef.current?.nodes.find(
                    (item) => item.id === nodeId,
                  );
                  if (typeof node?.payload.assetId === "string")
                    setWorkspaceAssetId(node.payload.assetId);
                  else openDetails(nodeId);
                }}
                onConversationChange={changeAssistantConversation}
                onActivityChange={setChatActivity}
                onAddMaterial={() => {
                  setMobileView("canvas");
                  if (layoutMode === "mobile" || layoutMode === "overlay") setSidebarOpen(false);
                  setMenuTab("assets");
                  requestAnimationFrame(() =>
                    document
                      .querySelector<HTMLElement>(
                        "[data-workflow-add-menu] > button",
                      )
                      ?.focus(),
                  );
                }}
                onGraphChange={commitGraph}
                onNotice={setNotice}
                onError={setError}
                onProposal={setProposal}
                projectId={projectId}
                selected={selected}
                onLocate={(nodeId) => {
                  if (layoutMode === "mobile" || layoutMode === "overlay") { setMobileView("canvas"); setSidebarOpen(false); }
                  if (canvasView === "workbench") {
                    if (canvasMode === "canvas") canvasHandle.current?.locate(nodeId);
                    else openDetails(nodeId);
                    return;
                  }
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
          </aside>
        </WorkspaceSplit>

          <Dialog open={Boolean(discardAction)} label="保留未保存的参数" onClose={cancelDiscard}>
            <div className={styles.entryDialog}>
              <h2>参数尚未保存</h2>
              <p>继续会放弃当前节点的修改。也可以返回，先保存参数。</p>
              <div className={styles.dialogActions}>
                <Button onClick={cancelDiscard}>返回编辑</Button>
                <Button
                  variant="danger"
                  onClick={async () => {
                    await discardWorkspaceDrafts(key => !(JSON.parse(key) as string[])[3]?.startsWith("assistant:"));
                    discardReply.current?.(true);
                    discardReply.current = null;
                    discardAction?.();
                    setDiscardAction(null);
                  }}
                >
                  放弃修改并继续
                </Button>
              </div>
            </div>
          </Dialog>
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
          <Dialog open={helpOpen} label="工作室使用帮助" onClose={() => setHelpOpen(false)} returnFocusSelector='[data-guide="workspace-functions"]'>
            <div className={styles.entryDialog}>
              <h2>开始你的设计</h2>
              <ol>
                <li>
                  在设计助手中描述需求；需要参考时，可添加图片、草图或面料并引用。
                </li>
                <li>
                  {canvasMode === "canvas" ? "讨论不会生成图片；发送明确的生成或修改要求后开始执行，结果会出现在对话和白板中。" : "检查助手给出的方案，点击“确认并生成”即可开始；结果会出现在对话和画布中。"}
                </li>
                <li>
                  用“修改要求”在原输入框继续描述调整，或跳过不合适的方案。需要精确参数时双击画布节点。
                </li>
                <li>
                  白板位置会自动保存，完成后不再常驻提示。保存失败时，可从白板提示中重试或恢复。
                </li>
                <li>
                  “导出画布
                  PNG”保存设计路径。设计图与系列在各自工作区导出交付文件，关闭窗口不会取消任务。
                </li>
              </ol>
              <div className={styles.dialogActions}>
                {canvasMode !== "canvas" && canvasView === "workflow" ? (
                  <Button disabled={exporting} onClick={() => { setHelpOpen(false); void exportCanvas(); }}>
                    导出画布 PNG
                  </Button>
                ) : null}
                {canvasMode !== "canvas" && graph.legacyAvailable ? (
                  <Button onClick={() => { setHelpOpen(false); setHistoryOpen(true); }}>
                    历史白板
                  </Button>
                ) : null}
                <Button onClick={() => { setHelpOpen(false); startGuide(); }}>
                  查看界面指引
                </Button>
                <Button variant="primary" onClick={() => setHelpOpen(false)}>
                  知道了
                </Button>
              </div>
            </div>
          </Dialog>
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
                await addNode("asset", "sketch", title, {
                  ...asset,
                  source: "designer_sketch",
                  ...(editingSketch ? { sourceNodeId: editingSketch.id } : {}),
                });
              }
            }}
            open
            projectId={projectId}
          />
        ) : null}
        <ProjectTaskCenter projectId={projectId} hideTrigger />
        {session && projectWorkspace.visited.length > 0 ? <CanvasProjectWorkspace key={`${session.user.id}:${projectId}`} accountId={session.user.id}
          projectId={projectId} projectName={projectName} activeTab={projectWorkspace.active} visitedTabs={projectWorkspace.visited}
          onClose={() => setProjectWorkspace(current => ({ ...current, active: null }))}
          onOpenPanel={tab => setProjectWorkspace(current => ({ active: tab, visited: current.visited.includes(tab) ? current.visited : [...current.visited, tab] }))}
          onRefreshCanvas={async () => { await reload(); await canvasHandle.current?.refresh(); }}
          onEditAsset={(assetId, styleRevisionId) => {
            const url = new URL(window.location.href);
            url.searchParams.set("assetId", assetId);
            url.searchParams.set("styleRevisionId", styleRevisionId);
            window.history.replaceState(window.history.state, "", url);
            const node = graphRef.current?.nodes.find(item => item.payload.assetId === assetId);
            if (node) { canvasHandle.current?.locate(node.id); openDetails(node.id); }
          }} /> : null}
        {renamingProject ? <RenameProjectDialog projectId={projectId} projectName={projectName} onRename={setProjectName} onClose={() => setRenamingProject(false)} /> : null}
        {generatedFilesOpen ? <GeneratedFilesPanel projectId={projectId} onClose={() => setGeneratedFilesOpen(false)}
          canPlace={canvasMode === "canvas" && canvasView === "workbench" && Boolean(sourceEditor && !sourceEditor.getIsReadonly())}
          isPlaced={(resourceId, domain = "asset") => Boolean(sourceEditor?.getCurrentPageShapes().some(shape => domain === "runway"
            ? "mediaId" in shape.props && shape.props.mediaId === resourceId
            : "assetId" in shape.props && shape.props.assetId === resourceId))}
          onPreparePlacement={async () => {
            const handle = canvasHandle.current;
            if (!handle || handle.editor.getIsReadonly()) throw new Error("当前白板不可编辑，请核对权限后重试。");
            await handle.flushLayout();
            if (canvasHandle.current !== handle) throw new Error("工作区已切换，请返回原项目继续。");
            const center = handle.editor.getViewportPageBounds().center;
            return { x: center.x - 160, y: center.y - 190 };
          }}
          onPlaced={async result => {
            const handle = canvasHandle.current;
            if (!handle || result.canvas.projectId !== projectId) throw new Error("白板已切换，请回到原项目确认放置。");
            commitGraph(result.graph);
            handle.applyResult(result.canvas, result.graph);
            await handle.flushLayout();
            if (result.graph.nodes.some(node => node.id === result.nodeId && node.type === "media")) {
              handle.locate(result.nodeId);
              const shapeIds = handle.editor.getCurrentPageShapes().filter(shape => shape.meta.canvasNodeId === result.nodeId).map(shape => shape.id);
              if (shapeIds.length) handle.editor.bringToFront(shapeIds);
              if (layoutMode === "mobile") {
                const camera = handle.editor.getCamera();
                handle.editor.setCamera({ ...camera, x: camera.x - 40 / camera.z });
              }
              handle.editor.setSelectedShapes([]);
              await handle.flushLayout();
            }
          }}
          onLocate={nodeId => {
          if (!graph.nodes.some(node => node.id === nodeId)) return false;
          setGeneratedFilesOpen(false);
          if (canvasHandle.current) canvasHandle.current.locate(nodeId); else openDetails(nodeId);
          return true;
        }} /> : null}
        {collectionId ? (
          <BoardProjectContext.Provider value={projectId}>
            <GenerationWorkspace>
              <CollectionDrawer
                key={collectionId}
                collectionId={collectionId}
                canEdit={canvasCanEdit}
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
      <h3>旧设计运行 只读</h3>
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
              {run.status} {new Date(run.createdAt).toLocaleString("zh-CN")}
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
                  {constraint.priority === "must" ? "必须" : "偏好"} {" "}
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
                    {step.ordinal + 1}. {step.title} {step.status}
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
                        尝试 {attempt.ordinal} {attempt.status}
                      </strong>
                      <p>提示词：{attempt.prompt}</p>
                      {attempt.parentAssetId ? (
                        <p>母图：{attempt.parentAssetId}</p>
                      ) : null}
                      {attempt.candidates.length ? (
                        <p>
                          图片：
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
                      ? "图片评价"
                      : "修订建议"}{" "}
                    {action.status}
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
