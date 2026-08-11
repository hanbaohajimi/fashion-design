import type {
  AgentConversationSummary,
  AgentMessageView,
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
): Promise<CursorPage<AgentConversationSummary>> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/agent-conversations?limit=50`,
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
