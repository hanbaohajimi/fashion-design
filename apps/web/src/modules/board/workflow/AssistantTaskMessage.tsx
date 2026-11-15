"use client";

import type { WorkflowResultImage } from "@fashion/shared";
import { StatusMark } from "../../../components/StatusMark";
import { requestProjectTaskCenter } from "../../tasks/project-task-navigation";
import type { WorkflowGraph } from "./workflow-api";
import { AssistantExecutionStatus } from "./AssistantExecutionStatus";
import { AssistantResultGallery } from "./AssistantResultGallery";
import {
  assistantTaskState,
  imageDisplayTitle,
  type AssistantTask,
} from "./assistant-transcript";
import { resultImageNode } from "./assistant-result-data";
import styles from "./assistant-task-message.module.css";

export function AssistantTaskMessage({
  task,
  graph,
  projectId,
  disabled,
  onRefresh,
  onOpen,
  onContinue,
  onCompare,
  onLocate,
}: {
  task: AssistantTask;
  graph: WorkflowGraph;
  projectId: string;
  disabled: boolean;
  onRefresh: () => void;
  onOpen: (image: WorkflowResultImage) => void;
  onContinue: (image: WorkflowResultImage) => void;
  onCompare: (images: readonly WorkflowResultImage[]) => void;
  onLocate: (id: string) => void;
}) {
  const state = assistantTaskState(task);
  const active = ["preparing", "queued", "running", "processing"].includes(
    state,
  );
  const failed = ["failed", "moderation_failed", "partial_failed"].includes(
    state,
  );
  const nodeIds = [
    ...new Set([
      ...(task.activity?.resultNodeIds ?? []),
      ...(task.activity?.resultNodeId ? [task.activity.resultNodeId] : []),
    ]),
  ];
  const outputNodes = nodeIds.flatMap(
    (id) => graph.nodes.find((node) => node.id === id) ?? [],
  );
  const domainImages: WorkflowResultImage[] = outputNodes.flatMap((node) =>
    typeof node.payload.assetId === "string" &&
    typeof node.payload.imageUrl === "string"
      ? [
          {
            nodeId: node.id,
            assetId: node.payload.assetId,
            title: imageDisplayTitle(node.title),
            width:
              typeof node.payload.width === "number"
                ? node.payload.width
                : null,
            height:
              typeof node.payload.height === "number"
                ? node.payload.height
                : null,
          },
        ]
      : [],
  );
  const result =
    task.result ??
    (domainImages.length &&
    ["completed", "partial_failed", "failed", "canceled"].includes(state)
      ? {
          version: 1 as const,
          executionId:
            task.executionId ?? `run:${task.activity?.runId ?? task.id}`,
          toolNodeId: task.activity?.creationId ?? task.id,
          status:
            state === "partial_failed"
              ? ("partial_failed" as const)
              : state === "failed"
                ? ("failed" as const)
                : state === "canceled"
                  ? ("canceled" as const)
                  : ("completed" as const),
          completedAt: task.activity?.updatedAt ?? null,
          attempts: { completed: domainImages.length, failed: 0, canceled: 0 },
          images: domainImages,
        }
      : null);
  const count = result?.images.length ?? 0;
  const textNode = outputNodes.find(
    (node) =>
      node.type === "reference_text" && typeof node.payload.text === "string",
  );
  const title = imageDisplayTitle(
    task.progress?.title ?? task.activity?.title ?? "",
  );
  const named =
    title &&
    !/^(?:图片|文本|创作)节点\s*\d+$|^生成图(?:\s+[A-Z0-9]+)?$/u.test(title);
  const name = named
    ? `「${Array.from(title).slice(0, 36).join("")}${Array.from(title).length > 36 ? "…" : ""}」`
    : "";
  const summary =
    state === "unconfirmed"
      ? "结果尚未确认，请重新读取状态。"
      : state === "partial_failed"
        ? count
          ? `已生成 ${count} 张图片，其余操作未完成。`
          : `已有 ${nodeIds.length} 项成果，其余操作未完成。`
        : state === "canceled"
          ? count
            ? `生成已停止，已完成的 ${count} 张图片已保留。`
            : "生成已停止。"
          : failed
            ? "这次生成未完成，请查看任务详情后重试。"
            : count
              ? task.progress?.operation === "transform"
                ? `已完成 ${count} 张图片的处理。`
                : `已生成 ${count} 张${name}设计图。`
              : textNode
                ? `${name}文字已生成。`
                : state === "completed"
                  ? `${name}任务已完成。`
                  : "结果尚未确认，请重新读取状态。";
  return (
    <section
      className={styles.root}
      data-assistant-task={task.executionId ?? task.activity?.runId ?? task.id}
      data-task-state={state}
    >
      {active && task.progress ? (
        <AssistantExecutionStatus
          progress={task.progress}
          projectId={projectId}
          onRefresh={onRefresh}
          disabled={disabled}
          compact
        />
      ) : active ? (
        <div className={styles.status} role="status">
          <StatusMark
            status={state === "running" ? "running" : "pending"}
            decorative
          />
          <span>{state === "running" ? "正在生成…" : "正在准备生成…"}</span>
        </div>
      ) : (
        <p
          className={styles.summary}
          data-task-summary
          role={failed ? "alert" : "status"}
        >
          <StatusMark
            status={
              failed
                ? state === "partial_failed"
                  ? "partial"
                  : "failed"
                : state === "canceled"
                  ? "cancelled"
                  : state === "unconfirmed"
                    ? "unconfirmed"
                    : "done"
            }
            decorative
          />
          <span title={named ? title : undefined}>{summary}</span>
        </p>
      )}
      {result?.images.length ? (
        <AssistantResultGallery
          result={result}
          graph={graph}
          disabled={disabled}
          onOpen={onOpen}
          onContinue={onContinue}
          onCompare={onCompare}
          showHeader={false}
          onLocate={(image) => {
            const node = resultImageNode(graph, image);
            if (node) onLocate(node.id);
          }}
        />
      ) : null}
      {textNode ? (
        <div className={styles.textResult}>
          <p>{String(textNode.payload.text)}</p>
          <button type="button" onClick={() => onLocate(textNode.id)}>
            查看画布
          </button>
        </div>
      ) : null}
      {!count && !textNode && outputNodes.length ? (
        <div className={styles.references}>
          {outputNodes.map((node) => (
            <button
              key={node.id}
              type="button"
              className={styles.textButton}
              onClick={() => onLocate(node.id)}
            >
              查看{imageDisplayTitle(node.title)}
            </button>
          ))}
        </div>
      ) : null}
      {state === "unconfirmed" ||
      (state === "completed" &&
        !count &&
        !textNode &&
        task.progress?.operation === "image") ? (
        <button type="button" className={styles.textButton} onClick={onRefresh}>
          重新读取结果
        </button>
      ) : null}
      {failed ? (
        <button
          type="button"
          className={styles.textButton}
          onClick={() => requestProjectTaskCenter(projectId)}
        >
          查看任务详情
        </button>
      ) : null}
      <details className={styles.details}>
        <summary>查看过程</summary>
        {task.activity?.prompt ? (
          <p className={styles.prompt}>{task.activity.prompt}</p>
        ) : null}
        <ol>
          {task.messages.map((message) => (
            <li key={message.id}>
              <span>{message.content || "任务状态更新"}</span>
              {message.error ? <p>{message.error.message}</p> : null}
            </li>
          ))}
        </ol>
        {task.progress ? (
          <p>
            已完成 {task.progress.counts.completed} /{" "}
            {task.progress.counts.total} 项
            {task.progress.counts.queued
              ? `，排队 ${task.progress.counts.queued} 项`
              : ""}
            {task.progress.counts.running
              ? `，处理中 ${task.progress.counts.running} 项`
              : ""}
            {task.progress.counts.failed
              ? `，${task.progress.counts.failed} 项未完成`
              : ""}
            {task.progress.counts.canceled
              ? `，已取消 ${task.progress.counts.canceled} 项`
              : ""}
          </p>
        ) : null}
        {task.activity?.inputNodeIds.length ? (
          <div className={styles.references}>
            {task.activity.inputNodeIds
              .filter((id) => graph.nodes.some((node) => node.id === id))
              .map((id, index) => (
                <button type="button" key={id} onClick={() => onLocate(id)}>
                  查看参考 {index + 1}
                </button>
              ))}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => requestProjectTaskCenter(projectId)}
        >
          打开任务记录
        </button>
      </details>
    </section>
  );
}
