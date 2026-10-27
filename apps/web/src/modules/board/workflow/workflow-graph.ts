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

type ImageDimensions = { readonly width: unknown; readonly height: unknown };

/** 共用图片卡片布局、原图比例及加载后的尺寸校正。 */
export function isImageNodeType(type: string): boolean {
  return ["candidate", "reference_image", "sketch", "fabric"].includes(type);
}

function validImageDimensions(dimensions: ImageDimensions): dimensions is { width: number; height: number } {
  return typeof dimensions.width === "number" && Number.isFinite(dimensions.width) && dimensions.width > 0 &&
    typeof dimensions.height === "number" && Number.isFinite(dimensions.height) && dimensions.height > 0;
}

/**
 * 工作台尺寸档位。图片节点是"作品"，必须成为画布上的主角；
 * 工具节点是"过程"，刻意比素材矮，用高度差表达工具服务于素材。
 * 窄视口（触屏单列视图）回退到紧凑档，否则节点会撑满整屏。
 */
function compactLayout(): boolean {
  return typeof window !== "undefined" && window.innerWidth < 768;
}

/** 等比展示完整图片；尺寸只包含原比例图片、58px 标题栏与边框。 */
export function imageNodeSize(dimensions: ImageDimensions, hasSummary = false) {
  const aspect = validImageDimensions(dimensions) ? dimensions.width / dimensions.height : 1;
  const captionHeight = 58 + (hasSummary ? 22 : 0);
  const compact = compactLayout();
  const maxImageHeight = (compact ? 340 : 460) - captionHeight;
  let width = aspect > 1 ? (compact ? 320 : 400) : compact ? 256 : 340;
  let height = width / aspect;
  if (height > maxImageHeight) {
    width *= maxImageHeight / height;
    height = maxImageHeight;
  }
  // Hairline以outline绘制，不占内容盒，避免DPR取整改变极端图片比例。
  return { w: width, h: height + captionHeight };
}

/** 图片优先使用已加载的实际尺寸，兼容历史节点没有宽高元数据的情况。 */
export function nodeSize(
  node: Pick<WorkflowNode, "type" | "kind"> & Partial<Pick<WorkflowNode, "payload" | "title">>,
  loadedImage?: ImageDimensions,
): {
  readonly h: number;
  readonly w: number;
} {
  if (node.kind === "tool") {
    const title = displayNodeTitle({ type: node.type, title: node.title ?? "" });
    // 按 14px 标题估算字宽，加上两侧 12px 内边距和边框。
    // 与渲染环境无关，节点、连线接点和导出始终使用同一尺寸。
    const textWidth = Array.from(title).reduce(
      (width, character) => width + (character.charCodeAt(0) <= 0x7f ? 8 : 14),
      0,
    );
    return { w: Math.min(224, Math.max(96, Math.ceil((textWidth + 26) / 8) * 8)), h: 44 };
  }
  if (
    isImageNodeType(node.type) &&
    (node.type !== "fabric" || Boolean(nodeImageUrl({ payload: node.payload ?? {} })))
  ) {
    const payload = node.payload ?? {};
    return imageNodeSize(
      loadedImage && validImageDimensions(loadedImage) ? loadedImage : { width: payload.width, height: payload.height },
      Boolean(nodeSummary({ type: node.type, ...("title" in node && typeof node.title === "string" ? { title: node.title } : {}), payload })),
    );
  }
  const compact = compactLayout();
  const width = compact ? 258 : 300;
  if (node.type === "evaluation" || node.type === "constraint") {
    return compact ? { h: 196, w: width } : { h: node.type === "evaluation" ? 220 : 200, w: width };
  }
  // 色卡是纯色块，做成正方形样本，像布料小样
  if (node.type === "swatch") return compact ? { h: 148, w: width } : { h: 236, w: 236 };
  // 工具节点比素材矮一档：过程不该抢作品的视觉高度
  return { h: compact ? 172 : 200, w: width };
}

export function inputPortForTool(type: WorkflowToolType): WorkflowInputPort {
  switch (type) {
    case "analyze_brief":
      return "goal";
    case "evaluate_design":
      return "candidate";
    case "edit_design":
    case "transform_image":
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
  transform_image: "调整图片尺寸",
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

/** 等宽大写类别词，构成节点卡片上"技术感"的第一层编码。 */
const NODE_TYPE_CODES: Readonly<Record<string, string>> = {
  analyze_brief: "TOOL",
  brief: "BRIEF",
  candidate: "RESULT",
  constraint: "CONSTRAINT",
  edit_design: "TOOL",
  evaluate_design: "TOOL",
  evaluation: "REVIEW",
  fabric: "FABRIC",
  generate_design: "TOOL",
  legacy: "ARCHIVE",
  reference_image: "REFERENCE",
  reference_text: "REFERENCE",
  restore_version: "TOOL",
  sketch: "SKETCH",
  swatch: "SWATCH",
  trend: "TREND",
};

/**
 * 节点类型标签：等宽大写英文 + 中文类型名。
 * 英文负责扫视时快速分类，中文负责准确表意——两者同时在场，
 * 既不依赖 hover，也不牺牲可读性。
 */
export function nodeTypeEyebrow(kind: "asset" | "tool", type: string): readonly string[] {
  const code = NODE_TYPE_CODES[type] ?? (kind === "tool" ? "TOOL" : "MATERIAL");
  return [code, nodeTypeLabel(type)];
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

export function nodeSummary(node: Pick<WorkflowNode, "type" | "payload"> & Partial<Pick<WorkflowNode, "title">>): string {
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
      return `${label}${typeof decision.reason === "string" ? `：${decision.reason}` : ""}`.slice(
        0,
        180,
      );
  }
  for (const key of ["text", "summary", "description", "report", "prompt"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      // 历史面料节点把同一组标签分别用「 · 」和「、」写入名称与摘要。
      const normalizeTags = (text: string) => text.split(/[·、]/u).map((tag) => tag.trim()).join("、");
      if (node.type === "fabric" && node.title && normalizeTags(value) === normalizeTags(node.title)) continue;
      return value.trim().slice(0, 180);
    }
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

export function nodeImageUrl(node: Pick<WorkflowNode, "payload">): string {
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

/**
 * 计算每个节点到根（无入边的节点）的 BFS 深度。
 * 用作入场动画的错峰序号：上游先落、下游后落。
 * 环状结构不会死循环——只在深度严格变小时继续扩散。
 */
export function nodeDepths(graph: WorkflowGraph): Map<string, number> {
  const incoming = new Map<string, number>();
  for (const node of graph.nodes) incoming.set(node.id, 0);
  for (const edge of graph.edges) {
    if (incoming.has(edge.targetNodeId)) incoming.set(edge.targetNodeId, (incoming.get(edge.targetNodeId) ?? 0) + 1);
  }
  const depths = new Map<string, number>();
  const queue: string[] = [];
  for (const node of graph.nodes) {
    if ((incoming.get(node.id) ?? 0) === 0) {
      depths.set(node.id, 0);
      queue.push(node.id);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const depth = depths.get(current) ?? 0;
    for (const edge of graph.edges) {
      if (edge.sourceNodeId !== current) continue;
      const next = depths.get(edge.targetNodeId);
      if (next !== undefined && next <= depth + 1) continue;
      depths.set(edge.targetNodeId, depth + 1);
      queue.push(edge.targetNodeId);
    }
  }
  // 纯环或孤岛：没有根可达，就按声明顺序给一个递增序，至少保证有节奏
  let fallback = 0;
  for (const node of graph.nodes) {
    if (!depths.has(node.id)) depths.set(node.id, Math.min(fallback++, 6));
  }
  return depths;
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

/** 聚焦只沿选中节点分别向上、向下追踪，不从祖先扩散到兄弟分支。 */
export function focusPathOf(graph: WorkflowGraph, selectedNodeId: string) {
  if (!graph.nodes.some((node) => node.id === selectedNodeId)) return null;
  const ancestors = lineageOf(graph, selectedNodeId);
  const nodeIds = new Set(ancestors.nodeIds);
  const edgeIds = new Set(ancestors.edgeIds);
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const edge of graph.edges) {
    const edges = outgoing.get(edge.sourceNodeId) ?? [];
    edges.push(edge);
    outgoing.set(edge.sourceNodeId, edges);
  }
  const visited = new Set([selectedNodeId]);
  const pending = [selectedNodeId];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined) continue;
    for (const edge of outgoing.get(id) ?? []) {
      edgeIds.add(edge.id);
      nodeIds.add(edge.targetNodeId);
      if (!visited.has(edge.targetNodeId)) {
        visited.add(edge.targetNodeId);
        pending.push(edge.targetNodeId);
      }
    }
  }
  return { nodeIds, edgeIds };
}

export type WorkflowEdgeRelation = "input" | "reference" | "result";

export function edgeRelation(
  source: WorkflowNode,
  edge: WorkflowEdge,
): WorkflowEdgeRelation {
  // 工具输出也使用 source 端口，必须先按源节点区分生成结果。
  if (source.kind === "tool") return "result";
  return edge.targetPort === "reference" ? "reference" : "input";
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
      transform_image: "candidate",
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
