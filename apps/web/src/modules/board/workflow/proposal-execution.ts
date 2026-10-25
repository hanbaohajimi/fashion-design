import {
  decideWorkflowProposal,
  executeWorkflowNode,
  fetchWorkflow,
  type WorkflowGraph,
  type WorkflowProposal,
} from "./workflow-api";

/** Stable across retries and reloads: accepting a proposal must not submit it twice. */
export async function proposalExecutionId(key: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function acceptAndExecuteProposal(
  projectId: string,
  proposal: WorkflowProposal,
  conversationId: string,
  onAccepted: (graph: WorkflowGraph) => void,
): Promise<WorkflowGraph> {
  const graph = proposal.status === "accepted"
    ? await fetchWorkflow(projectId)
    : await decideWorkflowProposal(projectId, proposal, "accept");
  // Persist the accepted state even when queue submission fails afterwards.
  onAccepted(graph);
  const node = graph.nodes.find((item) => item.id === proposal.toolNodeId && item.kind === "tool");
  if (!node) throw new Error("方案已保存，但执行步骤不可用，请重新请求方案。");
  if (["running", "pending", "completed"].includes(node.status)) return graph;
  if (!["ready", "failed"].includes(node.status)) throw new Error("当前方案暂不能执行，请检查输入素材。");
  const mutationId = await proposalExecutionId(
    `${projectId}:${proposal.id}:${node.status === "failed" ? node.updatedAt : "initial"}`,
  );
  return executeWorkflowNode(projectId, node.id, conversationId, mutationId);
}
