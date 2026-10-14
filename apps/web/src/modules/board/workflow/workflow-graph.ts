import type {
  WorkflowEdge,
  WorkflowGraph,
  WorkflowInputPort,
  WorkflowNode,
  WorkflowToolType,
} from "./workflow-api";

export function nodeSize(node: Pick<WorkflowNode, "type" | "kind">): {
  readonly h: number;
  readonly w: number;
} {
  if (
    node.type === "candidate" ||
    node.type === "reference_image" ||
    node.type === "sketch"
  ) {
    return { h: 300, w: 258 };
  }
  if (node.type === "evaluation" || node.type === "constraint") {
    return { h: 236, w: 258 };
  }
  return { h: node.kind === "tool" ? 206 : 210, w: 258 };
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
  const referenceTypes = new Set([
    "reference_text",
    "reference_image",
    "swatch",
    "sketch",
    "trend",
    "fabric",
    "legacy",
    "candidate",
  ]);
  switch (target.type) {
    case "analyze_brief":
      return source.type === "brief" || source.type === "reference_text"
        ? ["goal"]
        : referenceTypes.has(source.type)
          ? ["reference"]
          : [];
    case "generate_design":
      return source.type === "constraint"
        ? ["constraint"]
        : source.type === "candidate"
          ? ["source"]
          : referenceTypes.has(source.type)
            ? ["reference"]
            : [];
    case "evaluate_design":
      return source.type === "candidate"
        ? ["candidate"]
        : source.type === "constraint"
          ? ["constraint"]
          : referenceTypes.has(source.type)
            ? ["reference"]
            : [];
    case "edit_design":
    case "restore_version":
      return source.type === "candidate"
        ? ["source"]
        : source.type === "constraint"
          ? ["constraint"]
          : referenceTypes.has(source.type)
            ? ["reference"]
            : [];
    default:
      return [];
  }
}
