import type {
  AgentConversationSummary,
  AgentMessageView,
  AgentRunView,
  AgentPlanStepSpec,
  AgentDomainActionView,
} from "@fashion/shared";

interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface AgentTurnResponse {
  readonly assistantMessage: AgentMessageView;
  readonly taskId: string | null;
  readonly userMessage: AgentMessageView;
}

export interface ProjectConversationRequest<T> {
  readonly projectId: string;
  readonly promise: Promise<T>;
}

export function getProjectConversationRequest<T>(
  current: ProjectConversationRequest<T> | null,
  projectId: string,
  create: (targetProjectId: string) => Promise<T>,
): ProjectConversationRequest<T> {
  if (current?.projectId === projectId) return current;
  return { projectId, promise: create(projectId) };
}

export const MAX_AGENT_MESSAGE_LENGTH = 4_000;
export const MAX_AGENT_CONTEXT_ITEMS = 100;

export function hasPendingAgentMessage(
  messages: readonly Pick<AgentMessageView, "role" | "status">[],
): boolean {
  return messages.some(
    (message) => message.role === "assistant" && message.status === "pending",
  );
}

export function reconcileAgentTurnMessages(
  current: readonly AgentMessageView[],
  replacedMessageIds: readonly string[],
  turn: Pick<AgentTurnResponse, "assistantMessage" | "userMessage">,
): readonly AgentMessageView[] {
  const incoming = new Map(
    [turn.userMessage, turn.assistantMessage].map((message) => [
      message.id,
      message,
    ]),
  );
  const replaced = new Set(replacedMessageIds);
  const seen = new Set<string>();
  const reconciled: AgentMessageView[] = [];

  for (const message of current) {
    if (seen.has(message.id)) continue;
    const replacement = incoming.get(message.id);
    if (replacement) {
      reconciled.push(replacement);
      seen.add(message.id);
      continue;
    }
    if (replaced.has(message.id)) continue;
    reconciled.push(message);
    seen.add(message.id);
  }

  for (const message of [turn.userMessage, turn.assistantMessage]) {
    if (seen.has(message.id)) continue;
    reconciled.push(message);
    seen.add(message.id);
  }

  return reconciled;
}

export function validateAgentMessage(
  content: string,
  contextItemCount: number,
): string | null {
  if (!content.trim()) return "请输入设计需求后再发送";
  if (content.length > MAX_AGENT_MESSAGE_LENGTH) {
    return `设计需求最多 ${MAX_AGENT_MESSAGE_LENGTH} 个字符，请精简后再发送`;
  }
  if (contextItemCount > MAX_AGENT_CONTEXT_ITEMS) {
    return `每次最多附加 ${MAX_AGENT_CONTEXT_ITEMS} 项画布内容，请移除部分上下文后重试`;
  }
  return null;
}

async function apiError(response: Response, fallback: string): Promise<Error> {
  try {
    const body = (await response.json()) as {
      readonly message?: string;
    };
    return new Error(body.message ?? fallback);
  } catch {
    return new Error(fallback);
  }
}

export async function listAgentConversations(
  projectId: string,
  cursor?: string,
): Promise<CursorPage<AgentConversationSummary>> {
  const query = new URLSearchParams({ limit: "50" });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/agent-conversations?${query.toString()}`,
    { cache: "no-store", credentials: "include" },
  );
  if (!response.ok) {
    throw await apiError(response, "会话列表读取失败");
  }
  return (await response.json()) as CursorPage<AgentConversationSummary>;
}

export async function createAgentConversation(
  projectId: string,
): Promise<AgentConversationSummary> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/agent-conversations`,
    {
      body: JSON.stringify({}),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw await apiError(response, "新会话创建失败");
  }
  return (await response.json()) as AgentConversationSummary;
}

export async function listAgentMessages(
  conversationId: string,
  cursor?: string,
): Promise<CursorPage<AgentMessageView>> {
  const query = new URLSearchParams({ limit: "50" });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(
    `/api/agent-conversations/${encodeURIComponent(conversationId)}/messages?${query.toString()}`,
    { cache: "no-store", credentials: "include" },
  );
  if (!response.ok) {
    throw await apiError(response, "会话消息读取失败");
  }
  return (await response.json()) as CursorPage<AgentMessageView>;
}

export async function updateAgentConversation(
  conversationId: string,
  input: { readonly archived?: boolean; readonly title?: string },
): Promise<AgentConversationSummary> {
  const response = await fetch(
    `/api/agent-conversations/${encodeURIComponent(conversationId)}`,
    {
      body: JSON.stringify(input),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    },
  );
  if (!response.ok) {
    throw await apiError(response, "会话更新失败");
  }
  return (await response.json()) as AgentConversationSummary;
}

export async function sendAgentMessage(
  conversationId: string,
  input: {
    readonly clientRequestId: string;
    readonly content: string;
    readonly fileAssetIds: readonly string[];
    readonly shapeIds: readonly string[];
  },
): Promise<AgentTurnResponse> {
  const response = await fetch(
    `/api/agent-conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      body: JSON.stringify(input),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw await apiError(response, "消息发送失败");
  }
  return (await response.json()) as AgentTurnResponse;
}

export async function attachGenerationTaskToConversation(
  conversationId: string,
  taskId: string,
  input: {
    readonly content: string;
    readonly fileAssetIds: readonly string[];
    readonly shapeIds: readonly string[];
  },
): Promise<AgentMessageView> {
  const response = await fetch(
    `/api/agent-conversations/${encodeURIComponent(conversationId)}/generation-tasks/${encodeURIComponent(taskId)}`,
    {
      body: JSON.stringify(input),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw await apiError(response, "局部重绘任务归档失败");
  }
  return (await response.json()) as AgentMessageView;
}

export async function listAgentRuns(
  conversationId: string,
): Promise<{ readonly items: readonly AgentRunView[] }> {
  return agentRunRequest(
    `/api/agent-conversations/${encodeURIComponent(conversationId)}/plans`,
    undefined,
    "设计工作流读取失败",
  );
}

export async function createAgentRun(
  conversationId: string,
  input: {
    readonly clientRequestId: string;
    readonly content: string;
    readonly fileAssetIds: readonly string[];
    readonly shapeIds: readonly string[];
  },
): Promise<AgentRunView> {
  return agentRunRequest(
    `/api/agent-conversations/${encodeURIComponent(conversationId)}/plans`,
    { method: "POST", body: JSON.stringify(input) },
    "设计计划创建失败",
  );
}

export async function fetchAgentRun(runId: string): Promise<AgentRunView> {
  return agentRunRequest(
    `/api/agent-runs/${encodeURIComponent(runId)}`,
    undefined,
    "设计工作流同步失败",
  );
}

export async function updateAgentRunStep(
  runId: string,
  stepId: string,
  input: {
    readonly revision: number;
    readonly prompt: string;
    readonly negativePrompt: string;
  },
): Promise<AgentRunView> {
  return agentRunRequest(
    `/api/agent-runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
    "节点修改失败",
  );
}

export async function controlAgentRun(
  runId: string,
  action: "execute" | "review" | "reject" | "pause" | "cancel",
  input: {
    readonly revision: number;
    readonly assetId?: string;
    readonly reason?: string;
  },
): Promise<AgentRunView> {
  return agentRunRequest(
    `/api/agent-runs/${encodeURIComponent(runId)}/${action}`,
    { method: "POST", body: JSON.stringify(input) },
    "工作流操作失败",
  );
}

export async function updateAgentRunPlan(
  runId: string,
  input: {
    readonly revision: number;
    readonly steps: readonly AgentPlanStepSpec[];
  },
): Promise<AgentRunView> {
  return agentRunRequest(
    `/api/agent-runs/${encodeURIComponent(runId)}/plan`,
    { method: "PATCH", body: JSON.stringify(input) },
    "节点图保存失败",
  );
}

export async function requestAgentDomainAction(
  runId: string,
  input: {
    readonly revision: number;
    readonly clientRequestId: string;
    readonly kind: AgentDomainActionView["kind"];
    readonly stepId: string;
    readonly assetId?: string;
  },
): Promise<AgentRunView> {
  return agentRunRequest(
    `/api/agent-runs/${encodeURIComponent(runId)}/agent-actions`,
    { method: "POST", body: JSON.stringify(input) },
    "领域 Agent 暂时无法完成分析，请重试",
  );
}

export async function applyAgentDomainAction(
  runId: string,
  actionId: string,
  input: { readonly revision: number },
): Promise<AgentRunView> {
  return agentRunRequest(
    `/api/agent-runs/${encodeURIComponent(runId)}/agent-actions/${encodeURIComponent(actionId)}/apply`,
    { method: "POST", body: JSON.stringify(input) },
    "修订建议应用失败，请刷新状态后重试",
  );
}

export class AgentRunApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AgentRunApiError";
  }
}

async function agentRunRequest<T>(
  url: string,
  init: RequestInit | undefined,
  fallback: string,
): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "include",
    ...(init
      ? { ...init, headers: { "Content-Type": "application/json" } }
      : {}),
  });
  if (!response.ok) {
    const error = await apiError(response, fallback);
    throw new AgentRunApiError(
      response.status === 409
        ? "工作流已在其他页面更新，请刷新状态后继续"
        : error.message,
      response.status,
    );
  }
  return (await response.json()) as T;
}
