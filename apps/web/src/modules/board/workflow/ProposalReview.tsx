"use client";

/* §2.1/§2.8: review the request, then one explicit execution action.
 * Parameter editing belongs to node details; prose changes use the existing composer. */
import type { WorkflowGraph, WorkflowProposal } from "./workflow-api";
import { useLayoutEffect, useRef } from "react";
import {
  getWorkflowToolContract,
  workflowProposalExecutionSchema,
  type WorkflowResultImage,
} from "@fashion/shared";
import { resultImageNode } from "./assistant-result-data";
import { AssistantExecutionStatus } from "./AssistantExecutionStatus";
import { AssistantResultGallery } from "./AssistantResultGallery";
import { Button } from "../../../components/ui";
import {
  motionEase,
  motionTime,
  observeMotionCancellation,
} from "../../../components/interactions/motion-policy";
import styles from "./workflow-canvas.module.css";

export function ProposalReview({
  proposal,
  graph,
  disabled,
  submitting = false,
  error,
  onAccept,
  onReject,
  onAdjust,
  onOpenResult,
  onContinue,
  projectId,
  onRefresh = () => {},
  onOpenImage,
  onContinueImage,
  onCompare,
  onRevealResult,
}: {
  readonly proposal: WorkflowProposal;
  readonly graph: WorkflowGraph;
  readonly disabled: boolean;
  readonly submitting?: boolean;
  readonly error?: string | undefined;
  readonly onAccept: () => void;
  readonly onReject: () => void;
  readonly onAdjust: () => void;
  readonly onOpenResult: (nodeId: string) => void;
  readonly onContinue: (nodeId: string) => void;
  readonly projectId?: string;
  readonly onRefresh?: () => void;
  readonly onOpenImage?: (image: WorkflowResultImage) => void;
  readonly onContinueImage?: (image: WorkflowResultImage) => void;
  readonly onCompare?: (images: readonly WorkflowResultImage[]) => void;
  readonly onRevealResult?: (() => void) | undefined;
}) {
  const previousProposal = useRef({ id: proposal.id, status: proposal.status });
  const acceptanceReceipt = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const previous = previousProposal.current;
    previousProposal.current = { id: proposal.id, status: proposal.status };
    const receipt = acceptanceReceipt.current;
    if (!receipt) return;
    receipt.hidden = true;
    // Only acknowledge a real transition observed here. Historical accepted
    // proposals and subsequent node polling must not replay submission success.
    if (
      previous.id !== proposal.id ||
      previous.status !== "pending" ||
      proposal.status !== "accepted"
    )
      return;
    receipt.hidden = false;
    const duration = motionTime("--motion-feedback-check", 350);
    const path = receipt.querySelector("path");
    const animation =
      duration > 0 && !window.matchMedia?.("(forced-colors: active)").matches
        ? path?.animate?.([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
            duration,
            easing: motionEase(),
          })
        : undefined;
    const cancelMotion = () => animation?.cancel();
    const unsubscribe = observeMotionCancellation(cancelMotion);
    // This is only a receipt for acceptance, never a delay to starting work.
    const timer = window.setTimeout(() => {
      receipt.hidden = true;
    }, 1000);
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
      cancelMotion();
      receipt.hidden = true;
    };
  }, [proposal.id, proposal.status]);
  const node = graph.nodes.find((item) => item.id === proposal.toolNodeId);
  const added = proposal.operations.find(
    (operation) =>
      operation.type === "add_node" &&
      operation.node.id === proposal.toolNodeId &&
      operation.node.kind === "tool",
  );
  const proposedNode = added?.type === "add_node" ? added.node : null;
  const updated = proposal.operations.find(
    (operation) =>
      operation.type === "update_node" &&
      operation.nodeId === proposal.toolNodeId,
  );
  const updatedParams =
    updated?.type === "update_node" ? updated.payload?.params : undefined;
  const tool = proposal.action?.toolKey ?? proposedNode?.type ?? node?.type;
  const imageTool = tool === "generate_design" || tool === "edit_design";
  const pending = proposal.status === "pending";
  const accepted = proposal.status === "accepted";
  const raw =
    proposal.action?.parameters ??
    updatedParams ??
    proposedNode?.payload.params;
  const defaults =
    tool === "generate_design" || tool === "edit_design"
      ? getWorkflowToolContract(tool).defaults
      : {};
  const params = {
    ...defaults,
    ...(raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}),
  };
  const prompt =
    typeof params.prompt === "string" ? params.prompt : proposal.content;
  const parsedExecution = workflowProposalExecutionSchema.safeParse(
    proposal.execution,
  );
  const execution =
    accepted && parsedExecution.success ? parsedExecution.data : null;
  const status = execution?.progress?.status;
  const failed = status === "failed" || status === "moderation_failed";
  const resumable = accepted && execution?.canExecute === true;
  const preserve = proposal.preserve ?? proposal.action?.preserve ?? [];
  const count = typeof params.count === "number" ? params.count : 1;

  return (
    <section
      className={styles.proposalReview}
      aria-label="方案确认"
      data-proposal-status={proposal.status}
    >
      <header>
        <strong>
          {pending
            ? imageTool
              ? "生成前确认"
              : "分析前确认"
            : imageTool
              ? "生成记录"
              : "分析记录"}
        </strong>
        <span>
          <span
            ref={acceptanceReceipt}
            hidden
            aria-hidden="true"
            data-proposal-accepted
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              style={{ verticalAlign: "-2px", marginRight: "4px" }}
            >
              <path
                d="m5 12 4 4L19 6"
                pathLength="1"
                strokeDasharray="1"
                strokeDashoffset="0"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            已受理{" "}
          </span>
          <span
            role="status"
            className={styles.proposalState}
            key={`${submitting}:${proposal.status}:${status}:${Boolean(error)}`}
          >
            {submitting
              ? "提交中"
              : error
                ? "提交失败"
                : pending
                  ? "待确认"
                  : accepted
                    ? status
                      ? {
                          preparing: "准备执行",
                          queued: "排队中",
                          running: "处理中",
                          processing: "正在确认结果",
                          completed: "已完成",
                          partial_failed: "部分未完成",
                          failed: "执行失败",
                          canceled: "已取消",
                          moderation_failed: "内容检查未通过",
                        }[status]
                      : execution?.binding === "not_started"
                        ? "已确认，待执行"
                        : "历史执行未核实"
                    : proposal.status === "rejected"
                      ? "未采用"
                      : "已失效"}
          </span>
        </span>
      </header>
      {pending || resumable ? (
        <>
          {imageTool ? (
            <p className={styles.proposalMeta}>
              {tool === "edit_design" ? "基于已有方案修改" : "生成新的服装方案"}
            </p>
          ) : null}
          <p>{prompt}</p>
          {typeof params.negativePrompt === "string" &&
          params.negativePrompt ? (
            <p className={styles.proposalMeta}>避免：{params.negativePrompt}</p>
          ) : null}
          {preserve.length ? (
            <p className={styles.proposalMeta}>保留：{preserve.join("、")}</p>
          ) : null}
          {proposal.referencedNodeIds.length ? (
            <p className={styles.proposalMeta}>
              参考：
              {proposal.referencedNodeIds.length} 项素材
            </p>
          ) : null}
          {imageTool ? (
            <p className={styles.proposalMeta}>
              {count} 张方案
              {typeof params.width === "number" &&
              typeof params.height === "number"
                ? ` ${params.width} × ${params.height}`
                : ""}
              <br />
              生成成功后按额度计次。
            </p>
          ) : null}
        </>
      ) : accepted ? (
        <details className={styles.proposalMeta}>
          <summary>查看已确认内容</summary>
          <p>{prompt}</p>
          <p>
            {count} 项操作
            {preserve.length ? `，保留：${preserve.join("、")}` : ""}
          </p>
        </details>
      ) : null}
      {execution?.binding === "changed" ? (
        <p className={styles.proposalMeta}>
          这条确认后的内容已有后续修改，历史结果保留。请发送新需求继续。
        </p>
      ) : accepted && (!execution || execution.binding === "unrecorded") ? (
        <p className={styles.proposalMeta}>
          这条旧确认缺少可核实的执行关联，可查看任务记录，或发送新需求继续。
        </p>
      ) : null}
      {execution?.progress && projectId ? (
        <AssistantExecutionStatus
          key={execution.progress.executionId}
          progress={execution.progress}
          projectId={projectId}
          onRefresh={onRefresh}
          disabled={disabled}
        />
      ) : null}
      {error ? (
        <p role="alert" className={styles.proposalError}>
          {error}
        </p>
      ) : null}
      {proposal.status === "rejected" && proposal.rejectionReason ? (
        <p className={styles.proposalMeta}>{proposal.rejectionReason}</p>
      ) : null}
      {failed && !error ? <p role="alert">本次执行未完成，可以重试。</p> : null}
      {accepted && execution?.result?.images.length ? (
        onRevealResult ? (
          <button
            type="button"
            className={styles.actionSecondary}
            onClick={onRevealResult}
          >
            查看本次结果
          </button>
        ) : (
          <AssistantResultGallery
            result={execution.result}
            graph={graph}
            disabled={disabled}
            onOpen={(image) => {
              if (onOpenImage) onOpenImage(image);
              else {
                const node = resultImageNode(graph, image);
                if (node) onOpenResult(node.id);
              }
            }}
            onContinue={(image) => {
              if (onContinueImage) onContinueImage(image);
              else {
                const node = resultImageNode(graph, image);
                if (node) onContinue(node.id);
              }
            }}
            onCompare={(images) => onCompare?.(images)}
          />
        )
      ) : null}
      {pending || resumable ? (
        <div className={styles.suggestionActions}>
          {pending ? (
            <>
              <button
                className={styles.actionSecondary}
                disabled={disabled}
                onClick={onAdjust}
                type="button"
              >
                {imageTool ? "修改生成要求" : "修改分析要求"}
              </button>
              <button
                className={styles.actionQuiet}
                disabled={disabled}
                onClick={onReject}
                type="button"
              >
                不采用此方案
              </button>
            </>
          ) : null}
          <Button
            className={styles.actionPrimary}
            variant="primary"
            interaction="ripple"
            loading={submitting}
            feedback={{
              phase: submitting ? "pending" : error ? "error" : "idle",
              actionKey: proposal.id,
              revision: 0,
            }}
            feedbackAction={proposal.id}
            disabled={disabled}
            onClick={onAccept}
            type="button"
          >
            {submitting
              ? "提交中…"
              : failed
                ? imageTool
                  ? "重试生成"
                  : "重试分析"
                : accepted
                  ? imageTool
                    ? "继续生成"
                    : "继续分析"
                  : imageTool
                    ? `确认并生成 ${count} 张`
                    : "确认并分析"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
