import type { WorkflowMessageView } from "../agent/agent-api";
import {
  workflowExecutionProgressSchema,
  workflowExecutionResultSchema,
  type WorkflowExecutionProgress,
} from "@fashion/shared";

/** Only observations bound to this message can announce a new execution outcome. */
export function executionObservationKey(message: WorkflowMessageView): string {
  const parsed = workflowExecutionProgressSchema.safeParse(message.proposal?.execution?.progress ?? message.context?.executionProgress);
  if (!parsed.success)
    return `${message.proposal?.id ?? ""}:${message.proposal?.status ?? ""}`;
  const progress = parsed.data;
  const result = workflowExecutionResultSchema.safeParse(message.proposal?.execution?.result);
  const terminal = [
    "completed",
    "partial_failed",
    "failed",
    "canceled",
    "moderation_failed",
  ].includes(progress.status);
  return `${progress.executionId}:${terminal ? progress.status : "active"}:${result.success && result.data.executionId === progress.executionId ? result.data.images.map(image => image.assetId).join(",") : ""}`;
}

function preserveExecutionProgress(
  previous: WorkflowExecutionProgress | null | undefined,
  incoming: WorkflowExecutionProgress | null | undefined,
) {
  const old = workflowExecutionProgressSchema.safeParse(previous),
    next = workflowExecutionProgressSchema.safeParse(incoming);
  if (!old.success) return false;
  if (!next.success) return true;
  const terminal = [
    "completed",
    "partial_failed",
    "failed",
    "canceled",
    "moderation_failed",
  ];
  return (
    Date.parse(next.data.updatedAt) < Date.parse(old.data.updatedAt) ||
    (old.data.executionId === next.data.executionId &&
      terminal.includes(old.data.status) &&
      !terminal.includes(next.data.status))
  );
}

function retainExecutionObservations(
  previous: WorkflowMessageView,
  update: WorkflowMessageView,
) {
  let next = update;
  const previousProgress = previous.context?.executionProgress;
  if (
    previousProgress &&
    previous.executionId &&
    previous.executionId === update.executionId &&
    preserveExecutionProgress(
      previousProgress,
      update.context?.executionProgress,
    )
  )
    next = {
      ...next,
      context: { ...next.context, executionProgress: previousProgress },
    };
  if (previous.proposal && previous.proposal.id === update.proposal?.id) {
    const old = previous.proposal.execution,
      incoming = update.proposal.execution;
    const stale =
      old && preserveExecutionProgress(old.progress, incoming?.progress);
    if (old && (stale || old.binding === "changed")) {
      next = {
        ...next,
        proposal: {
          ...update.proposal,
          execution: {
            ...(incoming ?? old),
            progress: stale
              ? old.progress
              : (incoming?.progress ?? old.progress),
            result: stale ? old.result : (incoming?.result ?? old.result),
            binding:
              old.binding === "changed"
                ? "changed"
                : (incoming?.binding ?? old.binding),
            canExecute:
              old.binding !== "changed" &&
              incoming?.canExecute !== false &&
              old.canExecute,
          },
        },
      };
    }
  }
  return next;
}

/** Keep local terminal decisions when older pages or in-flight polls overlap. */
export function mergeMessages(
  current: readonly WorkflowMessageView[],
  incoming: readonly WorkflowMessageView[],
  prepend = false,
): readonly WorkflowMessageView[] {
  const updates = new Map(incoming.map((message) => [message.id, message]));
  let changed = false;
  const merged = current.map((message) => {
    const update = updates.get(message.id);
    if (
      !update ||
      (message.status !== "pending" && update.status === "pending") ||
      Date.parse(update.updatedAt) < Date.parse(message.updatedAt)
    )
      return message;
    const observed = retainExecutionObservations(message, update);
    const next =
      update.proposal?.status === "pending" &&
      message.proposal &&
      message.proposal.status !== "pending"
        ? { ...observed, proposal: message.proposal }
        : observed;
    if (JSON.stringify(message) === JSON.stringify(next)) return message;
    changed = true;
    return next;
  });
  const seen = new Set(current.map((message) => message.id));
  const added = incoming.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
  return !changed && !added.length
    ? current
    : prepend
      ? [...added, ...merged]
      : [...merged, ...added];
}
