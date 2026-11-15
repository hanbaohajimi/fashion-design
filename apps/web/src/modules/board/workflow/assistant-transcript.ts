import {
  creationActivitySchema,
  workflowExecutionProgressSchema,
  workflowExecutionResultSchema,
  type CreationActivity,
  type WorkflowExecutionProgress,
  type WorkflowExecutionResult,
} from "@fashion/shared";
import type { WorkflowMessageView } from "../agent/agent-api";

export interface AssistantTask {
  id: string;
  executionId: string | null;
  messages: WorkflowMessageView[];
  activity: CreationActivity | null;
  progress: WorkflowExecutionProgress | null;
  result: WorkflowExecutionResult | null;
}
export type AssistantTranscriptRow =
  | { kind: "message"; message: WorkflowMessageView }
  | { kind: "task"; task: AssistantTask };

const terminal = (status: string) =>
  [
    "completed",
    "partial_failed",
    "failed",
    "canceled",
    "moderation_failed",
  ].includes(status);
const time = (value: string | null | undefined) =>
  value ? Date.parse(value) || 0 : 0;

function facts(message: WorkflowMessageView) {
  const activity = creationActivitySchema.safeParse(
    message.context?.creationActivity,
  );
  const progress = workflowExecutionProgressSchema.safeParse(
    message.context?.executionProgress,
  );
  const result = workflowExecutionResultSchema.safeParse(
    message.context?.executionResult,
  );
  return {
    activity: activity.success ? activity.data : null,
    progress:
      progress.success && progress.data.executionId === message.executionId
        ? progress.data
        : null,
    result:
      result.success && result.data.executionId === message.executionId
        ? result.data
        : null,
  };
}

/** Projected rows never mutate or discard the stored transcript. Identity comes from receipts. */
export function assistantTranscript(
  messages: readonly WorkflowMessageView[],
  conversationId = "",
) {
  const factsById = new Map(
    messages.map((message) => [message.id, facts(message)]),
  );
  const runExecutions = new Map<string, Set<string>>();
  const runKey = (
    message: WorkflowMessageView,
    activity: CreationActivity | null,
  ) =>
    activity?.runId
      ? `${message.conversationId ?? conversationId}:run:${activity.creationId}:${activity.runId}`
      : null;
  for (const message of messages) {
    const key = runKey(message, factsById.get(message.id)?.activity ?? null);
    if (!key || !message.executionId) continue;
    const ids = runExecutions.get(key) ?? new Set<string>();
    ids.add(message.executionId);
    runExecutions.set(key, ids);
  }
  const rows: AssistantTranscriptRow[] = [];
  const records: WorkflowMessageView[] = [];
  const groups = new Map<string, AssistantTask>();
  for (const message of messages) {
    const { activity, progress, result } =
      factsById.get(message.id) ?? facts(message);
    const routine =
      activity &&
      ["module_saved", "adopted"].includes(activity.event) &&
      !activity.task &&
      !progress &&
      !result &&
      ![
        "preparing",
        "queued",
        "running",
        "failed",
        "partial_failed",
        "canceled",
        "unconfirmed",
      ].includes(activity.status ?? "");
    if (message.role === "assistant" && routine) {
      records.push(message);
      continue;
    }
    const taskMessage =
      message.role === "assistant" &&
      message.kind !== "clarify" &&
      !message.proposal &&
      !message.context?.canvasAction &&
      message.origin !== "background_analysis" &&
      Boolean(
        activity ||
        progress ||
        result ||
        (message.kind === "executing" && message.executionId),
      );
    if (!taskMessage) {
      rows.push({ kind: "message", message });
      continue;
    }
    const run = runKey(message, activity);
    const linked = run ? runExecutions.get(run) : undefined;
    const executionId =
      message.executionId ??
      (linked?.size === 1 ? [...linked][0] : null) ??
      null;
    const key = executionId
      ? `${message.conversationId ?? conversationId}:execution:${executionId}`
      : (run ?? `message:${message.id}`);
    let task = groups.get(key);
    if (!task) {
      task = {
        id: message.id,
        executionId,
        messages: [],
        activity: null,
        progress: null,
        result: null,
      };
      groups.set(key, task);
      rows.push({ kind: "task", task });
    }
    task.messages.push(message);
    if (
      activity &&
      (!task.activity ||
        time(activity.updatedAt ?? message.updatedAt) >=
          time(task.activity.updatedAt))
    )
      task.activity = activity;
    if (
      progress &&
      (!task.progress ||
        !terminal(task.progress.status) ||
        terminal(progress.status)) &&
      (!task.progress ||
        time(progress.updatedAt) >= time(task.progress.updatedAt))
    )
      task.progress = progress;
    if (
      result &&
      (!task.result ||
        time(result.completedAt ?? message.updatedAt) >=
          time(task.result.completedAt))
    )
      task.result = result;
  }
  return { rows, records };
}

/** Only automatic legacy labels are translated; saved titles and prompts are not rewritten. */
export { imageDisplayTitle } from "../image-display-title";

export function assistantTaskState(task: AssistantTask) {
  if (task.result) return task.result.status;
  if (task.progress) return task.progress.status;
  if (task.activity?.status) return task.activity.status;
  return task.activity?.event === "submitted" ? "preparing" : "unconfirmed";
}
