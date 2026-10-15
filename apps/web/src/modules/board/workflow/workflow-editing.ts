import {
  workflowInputConnectionError,
  workflowInputPorts,
} from "@fashion/shared";
import type {
  WorkflowEdge,
  WorkflowGraph,
  WorkflowInputPort,
  WorkflowNode,
  WorkflowOperation,
} from "./workflow-api";
import { nodeSize } from "./workflow-graph";

export interface InputEdit {
  readonly targetId: string;
  readonly sourceId?: string;
  readonly edgeId?: string;
  readonly port?: WorkflowInputPort;
}

export interface PlannedInputEdit {
  readonly operations: readonly WorkflowOperation[];
  readonly targetId: string;
  readonly branched: boolean;
  readonly maskCleared: boolean;
}

function branchPosition(graph: WorkflowGraph, tool: WorkflowNode) {
  const size = nodeSize(tool);
  let y = tool.y + size.h + 80;
  while (
    graph.nodes.some((node) => {
      const other = nodeSize(node);
      return (
        tool.x < node.x + other.w + 40 &&
        tool.x + size.w + 40 > node.x &&
        y < node.y + other.h + 40 &&
        y + size.h + 40 > node.y
      );
    })
  )
    y += size.h + 80;
  return { x: tool.x, y };
}

/** A whole gesture becomes one semantic patch; execution is always a separate action. */
export function planInputEdit(
  graph: WorkflowGraph,
  edit: InputEdit,
): PlannedInputEdit {
  const target = graph.nodes.find((node) => node.id === edit.targetId);
  if (!target || target.kind !== "tool")
    throw new Error("只能编辑素材到工具的输入连接");
  if (target.type === "restore_version")
    throw new Error("请从候选方案的版本工作台恢复版本");
  if (target.status === "proposed") throw new Error("请先确认这条助手建议");
  const old = edit.edgeId
    ? graph.edges.find(
        (edge) => edge.id === edit.edgeId && edge.targetNodeId === target.id,
      )
    : undefined;
  if (edit.edgeId && !old) throw new Error("这条连接已变化，请重新选择");
  const source = edit.sourceId
    ? graph.nodes.find((node) => node.id === edit.sourceId)
    : undefined;
  if (
    edit.sourceId &&
    (!source || source.kind !== "asset" || source.status === "proposed")
  )
    throw new Error("请选择已加入画布的素材节点");
  if (!source && !old) throw new Error("请选择需要连接的素材");
  const ports = source ? workflowInputPorts(source.type, target.type) : [];
  const port =
    edit.port ??
    (old && ports.includes(old.targetPort) ? old.targetPort : ports[0]);
  if (source && (!port || !ports.includes(port)))
    throw new Error("这类素材不能作为该工具的输入");
  const branched = target.status !== "ready";
  const targetId = branched ? crypto.randomUUID() : target.id;
  const inputs = graph.edges.filter(
    (edge) => edge.targetNodeId === target.id && edge.id !== old?.id,
  );
  const added: WorkflowEdge | undefined =
    source && port
      ? {
          id: crypto.randomUUID(),
          sourceNodeId: source.id,
          targetNodeId: targetId,
          sourcePort: "out",
          targetPort: port,
        }
      : undefined;
  if (added && source) {
    const validationEdges = branched
      ? inputs.map((edge) => ({ ...edge, targetNodeId: targetId }))
      : graph.edges.filter((edge) => edge.id !== old?.id);
    const reason = workflowInputConnectionError(
      source.type,
      target.type,
      added,
      validationEdges,
    );
    if (reason) throw new Error(reason);
  }
  const originalParams = target.payload.params;
  const params: Record<string, unknown> =
    originalParams &&
    typeof originalParams === "object" &&
    !Array.isArray(originalParams)
      ? { ...originalParams }
      : {};
  const changesMother =
    (old?.targetPort === "source" || port === "source") &&
    old?.sourceNodeId !== source?.id;
  const maskCleared = changesMother && params.taskType === "inpaint";
  if (maskCleared) {
    delete params.maskImageUrl;
    delete params.referenceImageUrl;
    delete params.parentAssetId;
    params.taskType = "i2i";
  }
  const operations: WorkflowOperation[] = [];
  if (branched) {
    operations.push({
      type: "add_node",
      node: {
        id: targetId,
        kind: "tool",
        type: target.type,
        title: `${target.title.replace(/ · 分支$/u, "")} · 分支`.slice(0, 200),
        payload: {
          toolKey: target.type,
          toolVersion: target.payload.toolVersion ?? "1",
          params,
        },
        ...branchPosition(graph, target),
      },
    });
    for (const edge of inputs)
      operations.push({
        type: "add_edge",
        edge: { ...edge, id: crypto.randomUUID(), targetNodeId: targetId },
      });
  } else {
    if (old) operations.push({ type: "remove_edge", edgeId: old.id });
    if (maskCleared)
      operations.push({
        type: "update_node",
        nodeId: target.id,
        payload: { ...target.payload, params },
      });
  }
  if (added) operations.push({ type: "add_edge", edge: added });
  return { operations, targetId, branched, maskCleared };
}
