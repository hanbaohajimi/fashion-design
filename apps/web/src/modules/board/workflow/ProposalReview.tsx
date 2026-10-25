"use client";

/* §2.1/§2.8: review the request, then one explicit execution action.
 * Parameter editing belongs to node details; prose changes use the existing composer. */
import type { WorkflowGraph, WorkflowProposal } from "./workflow-api";
import { getWorkflowToolContract } from "@fashion/shared";
import { nodeImageUrl } from "./workflow-graph";
import styles from "./workflow-canvas.module.css";

export function ProposalReview({ proposal, graph, disabled, error, onAccept, onReject, onAdjust, onOpenResult }: {
  readonly proposal: WorkflowProposal;
  readonly graph: WorkflowGraph;
  readonly disabled: boolean;
  readonly error?: string | undefined;
  readonly onAccept: () => void;
  readonly onReject: () => void;
  readonly onAdjust: () => void;
  readonly onOpenResult: (nodeId: string) => void;
}) {
  const node = graph.nodes.find((item) => item.id === proposal.toolNodeId);
  const added = proposal.operations.find((operation) => operation.type === "add_node" && operation.node.id === proposal.toolNodeId && operation.node.kind === "tool");
  const proposedNode = added?.type === "add_node" ? added.node : null;
  const updated = proposal.operations.find((operation) => operation.type === "update_node" && operation.nodeId === proposal.toolNodeId);
  const updatedParams = updated?.type === "update_node" ? updated.payload?.params : undefined;
  const tool = proposal.action?.toolKey ?? proposedNode?.type ?? node?.type;
  const imageTool = tool === "generate_design" || tool === "edit_design";
  const pending = proposal.status === "pending";
  const accepted = proposal.status === "accepted";
  const raw = accepted ? node?.payload.params : proposal.action?.parameters ?? updatedParams ?? proposedNode?.payload.params ?? node?.payload.params;
  const defaults = tool === "generate_design" || tool === "edit_design" ? getWorkflowToolContract(tool).defaults : {};
  const params = { ...defaults, ...(raw && typeof raw === "object" ? raw as Record<string, unknown> : {}) };
  const prompt = typeof params.prompt === "string" ? params.prompt : proposal.content;
  const running = accepted && node && ["running", "pending"].includes(node.status);
  const complete = accepted && node?.status === "completed";
  const failed = accepted && node?.status === "failed";
  const resumable = accepted && node && ["ready", "failed"].includes(node.status);
  const outputs = graph.nodes.filter((item) => item.kind === "asset" && graph.edges.some(
    (edge) => edge.sourceNodeId === proposal.toolNodeId && edge.targetNodeId === item.id,
  ));
  const preserve = proposal.preserve ?? proposal.action?.preserve ?? [];

  return <section className={styles.proposalReview} aria-label="方案确认">
    <header><strong>{imageTool ? "生成方案" : "设计分析"}</strong>
      <span>{pending ? "待确认" : running ? "处理中" : complete ? "已完成" : failed ? "未完成" : accepted ? "已保存" : proposal.status === "rejected" ? "已跳过" : "已失效"}</span>
    </header>
    {pending || resumable ? <>
      <p>{prompt}</p>
      {typeof params.negativePrompt === "string" && params.negativePrompt ? <p className={styles.proposalMeta}>避免：{params.negativePrompt}</p> : null}
      {preserve.length ? <p className={styles.proposalMeta}>保留：{preserve.join("、")}</p> : null}
      {proposal.referencedNodeIds.length ? <p className={styles.proposalMeta}>参考：{proposal.referencedNodeIds.map((id) => graph.nodes.find((item) => item.id === id)?.title ?? "已移除的素材").join("、")}</p> : null}
      {imageTool ? <p className={styles.proposalMeta}>
        {typeof params.count === "number" ? params.count : 1} 张方案
        {typeof params.width === "number" && typeof params.height === "number" ? ` · ${params.width} × ${params.height}` : ""}
        <br />生成成功后按额度计次。
      </p> : null}
    </> : null}
    {running ? <p role="status">{imageTool ? "正在生成，完成后会出现在这里和画布上。" : "正在分析，可以继续补充想法。"}</p> : null}
    {error ? <p role="alert" className={styles.proposalError}>{error}</p> : null}
    {proposal.status === "rejected" && proposal.rejectionReason ? <p className={styles.proposalMeta}>{proposal.rejectionReason}</p> : null}
    {failed && !error ? <p role="alert">本次执行未完成，可以重试。</p> : null}
    {outputs.length ? <div className={styles.proposalResults} aria-label="本次结果">
      {outputs.map((result) => <button type="button" key={result.id} onClick={() => onOpenResult(result.id)}>
        {nodeImageUrl(result) ? (
          // Same-origin authenticated assets are also used by the canvas.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={nodeImageUrl(result)} alt="" />
        ) : null}
        <span>查看{result.title}</span>
      </button>)}
    </div> : null}
    {pending || resumable ? <div className={styles.suggestionActions}>
      <button className={styles.actionPrimary} disabled={disabled} onClick={onAccept} type="button">
        {failed ? imageTool ? "重试生成" : "重试分析" : accepted ? imageTool ? "继续生成" : "继续分析" : imageTool ? "确认并生成" : "确认并分析"}
      </button>
      {pending ? <>
        <button className={styles.actionSecondary} disabled={disabled} onClick={onAdjust} type="button">修改要求</button>
        <button className={styles.actionQuiet} disabled={disabled} onClick={onReject} type="button">跳过</button>
      </> : null}
    </div> : null}
  </section>;
}
