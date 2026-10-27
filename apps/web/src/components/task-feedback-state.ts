export type FeedbackState =
  | "idle"
  | "submitting"
  | "queued"
  | "processing"
  | "complete"
  | "failed"
  | "canceled"
  | "unknown";

const STATES: Readonly<
  Record<string, { state: FeedbackState; label: string }>
> = {
  ready: { state: "idle", label: "待执行" },
  draft: { state: "idle", label: "待提交" },
  proposed: { state: "idle", label: "待确认" },
  awaiting_approval: { state: "idle", label: "等待确认" },
  cancel_requested: { state: "processing", label: "请求停止中" },
  submitting: { state: "submitting", label: "正在提交" },
  dispatching: { state: "submitting", label: "正在接纳" },
  queued: { state: "queued", label: "排队中" },
  pending: { state: "processing", label: "处理中" },
  running: { state: "processing", label: "处理中" },
  processing: { state: "processing", label: "处理中" },
  executing: { state: "processing", label: "执行中" },
  planning: { state: "processing", label: "正在规划" },
  waiting_input: { state: "idle", label: "等待你的确认" },
  needs_attention: { state: "idle", label: "需要确认执行结果" },
  paused: { state: "idle", label: "已暂停" },
  awaiting_review: { state: "idle", label: "等待评审" },
  expired: { state: "idle", label: "已过期" },
  completed: { state: "complete", label: "已完成" },
  succeeded: { state: "complete", label: "已完成" },
  failed: { state: "failed", label: "执行失败" },
  moderation_failed: { state: "failed", label: "内容审核未通过" },
  not_admitted: { state: "failed", label: "未接纳" },
  canceled: { state: "canceled", label: "已取消" },
  cancelled: { state: "canceled", label: "已取消" },
  stopped: { state: "canceled", label: "已停止后续处理" },
};

export function taskState(status: string) {
  return (
    STATES[status.toLowerCase()] ?? {
      state: "unknown" as const,
      label: "正在确认状态",
    }
  );
}

export function isTaskActive(status: string) {
  return ["submitting", "queued", "processing"].includes(
    taskState(status).state,
  );
}
