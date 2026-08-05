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
