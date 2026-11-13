export type ProjectTaskGroup = "running" | "attention" | "ended";
export type ProjectTaskDomain = "assistant" | "workflow" | "generation" | "agent" | "export" | "runway" | "review";
export interface ProjectTaskAction {
  kind: "retry_workflow" | "cancel_reply" | "cancel_generation" | "resume_agent" | "cancel_agent" | "pause_agent" | "cancel_runway" | "acknowledge_review";
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
  /** Read-only, project-wide observation; independent of the requested page. */
  readonly activity?: ProjectTaskActivity;
}

export interface ProjectTaskTerminal {
  readonly id: string;
  readonly domain: ProjectTaskDomain;
  readonly outcome: "completed" | "failed" | "canceled";
  readonly updatedAt: string;
}

export interface ProjectTaskActivity {
  readonly preparing: number;
  /** The queued subset of preparing, so the UI can use an honest queue label. */
  readonly queued: number;
  readonly executing: number;
  readonly awaitingUser: number;
  readonly waiting: { readonly input: number; readonly confirmation: number; readonly resume: number };
  readonly recent: readonly ProjectTaskTerminal[];
}

export function projectTaskGroup(status: string): ProjectTaskGroup {
  const key = status.toLowerCase();
  if (["failed", "partial_failed", "moderation_failed", "not_admitted", "waiting_input", "needs_attention", "awaiting_approval", "awaiting_review", "waiting_review", "proposed", "paused", "ready", "pending_approval"].includes(key)) return "attention";
  if (["queued", "pending", "running", "executing", "planning", "processing", "committing", "dispatching", "cancel_requested"].includes(key)) return "running";
  return "ended";
}
