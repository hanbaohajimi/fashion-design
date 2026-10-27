export type ProjectTaskGroup = "running" | "attention" | "ended";
export type ProjectTaskDomain = "assistant" | "workflow" | "generation" | "agent" | "export" | "runway";
export interface ProjectTaskAction {
  kind: "retry_workflow" | "cancel_reply" | "cancel_generation" | "resume_agent" | "cancel_agent" | "pause_agent" | "cancel_runway";
  targetId: string;
  conversationId?: string;
  requestId?: string;
  version?: number;
}
export interface ProjectTaskView {
  id: string;
  domain: ProjectTaskDomain;
  title: string;
  rawStatus: string;
  status: string;
  group: ProjectTaskGroup;
  createdAt: string;
  updatedAt: string;
  objectId: string | null;
  conversationId: string | null;
  href: string;
  actions: readonly ProjectTaskAction[];
}
export interface ProjectTaskPage {
  items: readonly ProjectTaskView[];
  nextCursor: string | null;
  counts: { running: number; attention: number };
}

export function projectTaskGroup(status: string): ProjectTaskGroup {
  const key = status.toLowerCase();
  if (["failed", "moderation_failed", "waiting_input", "needs_attention", "awaiting_approval", "awaiting_review", "proposed", "paused", "ready", "pending_approval"].includes(key)) return "attention";
  if (["queued", "pending", "running", "executing", "planning", "processing", "committing", "dispatching", "cancel_requested"].includes(key)) return "running";
  return "ended";
}
