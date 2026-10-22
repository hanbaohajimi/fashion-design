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
  submitting: { state: "submitting", label: "正在提交" },
  dispatching: { state: "submitting", label: "正在接纳" },
  queued: { state: "queued", label: "排队中" },
  pending: { state: "processing", label: "处理中" },
  running: { state: "processing", label: "处理中" },
  completed: { state: "complete", label: "已完成" },
  succeeded: { state: "complete", label: "已完成" },
  failed: { state: "failed", label: "执行失败" },
  moderation_failed: { state: "failed", label: "内容审核未通过" },
  not_admitted: { state: "failed", label: "未接纳" },
  canceled: { state: "canceled", label: "已取消" },
  cancelled: { state: "canceled", label: "已取消" },
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
