import { workflowInputPorts } from "@fashion/shared";
import type {
  WorkflowEdge,
  WorkflowGraph,
  WorkflowInputPort,
  WorkflowNode,
  WorkflowToolType,
  WorkflowProposal,
} from "./workflow-api";

/** Project a pending proposal for review; saved nodes and their positions remain authoritative. */
export function projectWorkflowProposal(graph: WorkflowGraph, proposal: WorkflowProposal | null): WorkflowGraph {
  if (!proposal || proposal.status !== "pending") return graph;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  for (const operation of proposal.operations) {
    if (operation.type === "add_node") nodes.set(operation.node.id, { ...operation.node, status: "proposed", createdAt: "", updatedAt: "" });
    if (operation.type === "update_node") {
      const previous = nodes.get(operation.nodeId);
      if (previous) nodes.set(operation.nodeId, { ...previous, ...(operation.title !== undefined ? { title: operation.title } : {}), ...(operation.payload ? { payload: operation.payload } : {}), status: "proposed" });
    }
    if (operation.type === "remove_edge") edges.delete(operation.edgeId);
    if (operation.type === "add_edge") edges.set(operation.edge.id, operation.edge);
  }
  return { ...graph, nodes: [...nodes.values()], edges: [...edges.values()] };
}

/**
 * 节点尺寸。
 *
 * 尺寸应当由内容决定：图像类节点需要高度给图片，文字类节点的留白
 * 则纯粹是"统一卡片"的残留——内容只占上半部，下半部是空的。
 * 因此文字节点收窄到贴合成文本量级，图像节点保留大尺寸。
 */
export function nodeSize(node: Pick<WorkflowNode, "type" | "kind">): {
  readonly h: number;
  readonly w: number;
} {
  if (
    node.type === "candidate" ||
    node.type === "reference_image" ||
    node.type === "sketch"
  ) {
    return { h: 340, w: 258 };  // 增加高度让图片更完整展示
  }
  if (node.type === "evaluation" || node.type === "constraint") {
    return { h: 196, w: 258 };
  }
  // 色卡是纯色块，不需要文字节点的高度
  if (node.type === "swatch") return { h: 148, w: 258 };
  return { h: node.kind === "tool" ? 186 : 172, w: 258 };
}

export function inputPortForTool(type: WorkflowToolType): WorkflowInputPort {
  switch (type) {
    case "analyze_brief":
      return "goal";
    case "evaluate_design":
      return "candidate";
    case "edit_design":
    case "restore_version":
      return "source";
    case "generate_design":
      return "constraint";
  }
}

/**
 * 素材/工具类型的中文名，用于在没有可读标题时兜底。
 */
const NODE_TYPE_TITLES: Readonly<Record<string, string>> = {
  analyze_brief: "解析设计需求",
  brief: "设计需求",
  candidate: "设计方案",
  constraint: "设计约束",
  edit_design: "局部修改",
  evaluate_design: "评估设计",
  evaluation: "评估报告",
  fabric: "面料参考",
  generate_design: "生成设计方案",
  legacy: "历史记录",
  reference_image: "参考图片",
  reference_text: "参考文字",
  restore_version: "恢复历史版本",
  sketch: "设计草图",
  swatch: "色卡",
  trend: "趋势参考",
};

/** 节点类型的中文名，供界面标签使用。 */
export function nodeTypeLabel(type: string): string {
  return NODE_TYPE_TITLES[type] ?? type;
}

/** 纯哈希 / 十六进制串，以及超长无分隔的紧凑串，都是机器生成的 id。 */
const HASH_TITLE = /^[0-9a-f]{16,}(?:\.\w{1,5})?$/iu;

/**
 * 面向设计师的节点标题。
 *
 * 上游有时把文件哈希存成 title（如 `4be5c6b871ac036349e494e66d…`）。
 * 那串字符对设计师没有意义，长度还会挤掉图片本身的位置，
 * 因此在界面上替换为节点类型的可读名称；原始值仍在节点详情里可查。
 */
export function displayNodeTitle(
  node: Pick<WorkflowNode, "title" | "type">,
): string {
  const fallback = NODE_TYPE_TITLES[node.type] ?? node.type;
  const trimmed = node.title.trim();
  if (!trimmed) return fallback;
  if (HASH_TITLE.test(trimmed)) return fallback;
  if (
    trimmed.length > 24 &&
    !/\s/u.test(trimmed) &&
    !/\p{Script=Han}/u.test(trimmed)
  )
    return fallback;
  return trimmed;
}

export function nodeSummary(node: WorkflowNode): string {
  const payload = node.payload;
  if (
    node.type === "candidate" &&
    payload.decision &&
    typeof payload.decision === "object"
  ) {
    const decision = payload.decision as {
      readonly kind?: unknown;
      readonly reason?: unknown;
    };
    const label =
      decision.kind === "selected"
        ? "已选定"
        : decision.kind === "rejected"
          ? "已否决"
          : decision.kind === "compare"
            ? "保留比较"
            : "";
    if (label)
      return `${label}${typeof decision.reason === "string" ? ` · ${decision.reason}` : ""}`.slice(
        0,
        180,
      );
  }
  for (const key of ["text", "summary", "description", "report", "prompt"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim())
      return value.trim().slice(0, 180);
  }
  if (node.type === "generate_design")
    return "输入约束与参考，生成可比较的候选方案";
  if (node.type === "analyze_brief") return "整合目标与参考，提取设计约束";
  if (node.type === "evaluate_design") return "逐项检查候选方案与设计约束";
  if (node.type === "edit_design") return "保留既有设计，按指定部位创建新分支";
  if (node.type === "restore_version") return "从历史版本创建新的设计分支";
  if (node.type === "swatch" && typeof payload.color === "string")
    return payload.color;
  return "";
}

export function nodeImageUrl(node: WorkflowNode): string {
  for (const key of ["imageUrl", "thumbnailUrl", "url"]) {
    const value = node.payload[key];
    if (typeof value === "string" && /^(https?:\/\/|\/)/u.test(value))
      return value;
  }
  if (typeof node.payload.assetId === "string" && node.payload.assetId) {
    return `/api/design-assets/${encodeURIComponent(node.payload.assetId)}/thumbnail`;
  }
  if (
    typeof node.payload.fileAssetId === "string" &&
    node.payload.fileAssetId
  ) {
    return `/api/files/${encodeURIComponent(node.payload.fileAssetId)}/thumbnail/1024`;
  }
  return "";
}

export function lineageOf(
  graph: WorkflowGraph,
  selectedNodeId: string,
): {
  readonly edgeIds: ReadonlySet<string>;
  readonly nodeIds: ReadonlySet<string>;
} {
  const nodeIds = new Set<string>([selectedNodeId]);
  const edgeIds = new Set<string>();
  const pending = [selectedNodeId];
  while (pending.length > 0) {
    const target = pending.pop();
    if (!target) continue;
    for (const edge of graph.edges) {
      if (edge.targetNodeId !== target) continue;
      edgeIds.add(edge.id);
      if (nodeIds.has(edge.sourceNodeId)) continue;
      nodeIds.add(edge.sourceNodeId);
      pending.push(edge.sourceNodeId);
    }
  }
  return { edgeIds, nodeIds };
}

export function incomingEdges(
  graph: WorkflowGraph,
  nodeId: string,
): readonly WorkflowEdge[] {
  return graph.edges.filter((edge) => edge.targetNodeId === nodeId);
}

export function outgoingEdges(
  graph: WorkflowGraph,
  nodeId: string,
): readonly WorkflowEdge[] {
  return graph.edges.filter((edge) => edge.sourceNodeId === nodeId);
}

export function availableInputPorts(
  source: WorkflowNode,
  target: WorkflowNode,
): readonly WorkflowInputPort[] {
  if (source.kind === target.kind || source.id === target.id) return [];
  if (source.kind === "tool") {
    const outputType: Readonly<Record<WorkflowToolType, string>> = {
      analyze_brief: "constraint",
      edit_design: "candidate",
      restore_version: "candidate",
      evaluate_design: "evaluation",
      generate_design: "candidate",
    };
    return outputType[source.type as WorkflowToolType] === target.type
      ? ["source"]
      : [];
  }
  return workflowInputPorts(source.type, target.type).slice(0, 1);
}
