import type { AgentMessageView } from "@fashion/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachGenerationTaskToConversation,
  getProjectConversationRequest,
  hasPendingAgentMessage,
  listAgentConversations,
  listAgentMessages,
  reconcileAgentTurnMessages,
  sendAgentMessage,
  updateAgentConversation,
  validateAgentMessage,
} from "./agent-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function agentMessage(
  id: string,
  role: AgentMessageView["role"],
): AgentMessageView {
  return {
    clientRequestId: role === "user" ? "request-123" : null,
    content: id,
    context: null,
    createdAt: "2026-08-18T00:00:00.000Z",
    error: null,
    generationTaskId: null,
    id,
    replyToId: role === "assistant" ? "user-real" : null,
    role,
    status: "completed",
    updatedAt: "2026-08-18T00:00:00.000Z",
  };
}

describe("agent-api", () => {
  it("轮询已写入真实消息时不会在发送完成后重复追加", () => {
    const older = agentMessage("older", "user");
    const userMessage = agentMessage("user-real", "user");
    const assistantMessage = agentMessage("assistant-real", "assistant");

    const reconciled = reconcileAgentTurnMessages(
      [
        older,
        userMessage,
        assistantMessage,
        userMessage,
        assistantMessage,
      ],
      ["optimistic-user-request-123", "optimistic-assistant-request-123"],
      { userMessage, assistantMessage },
    );

    expect(reconciled.map((message) => message.id)).toEqual([
      "older",
      "user-real",
      "assistant-real",
    ]);
    expect(reconciled[1]).toBe(userMessage);
    expect(reconciled[2]).toBe(assistantMessage);
  });

  it("只在消息列表仍有 pending 助手消息时继续同步", () => {
    expect(
      hasPendingAgentMessage([
        { role: "assistant", status: "pending" },
        { role: "user", status: "completed" },
      ]),
    ).toBe(true);
    expect(
      hasPendingAgentMessage([
        { role: "assistant", status: "completed" },
        { role: "assistant", status: "failed" },
      ]),
    ).toBe(false);
  });

  it("首会话请求仅在同一项目内复用", () => {
    const create = vi.fn((projectId: string) =>
      Promise.resolve({ id: `conversation-${projectId}`, projectId }),
    );

    const projectA = getProjectConversationRequest(null, "project-a", create);
    const projectARepeat = getProjectConversationRequest(
      projectA,
      "project-a",
      create,
    );
    const projectB = getProjectConversationRequest(
      projectA,
      "project-b",
      create,
    );

    expect(projectARepeat).toBe(projectA);
    expect(projectB).not.toBe(projectA);
    expect(create).toHaveBeenNthCalledWith(1, "project-a");
    expect(create).toHaveBeenNthCalledWith(2, "project-b");
  });

  it("在请求前校验消息长度和画布上下文数量", () => {
    expect(validateAgentMessage("   ", 0)).toBe("请输入设计需求后再发送");
    expect(validateAgentMessage("a".repeat(4_001), 0)).toBe(
      "设计需求最多 4000 个字符，请精简后再发送",
    );
    expect(validateAgentMessage("生成外套", 101)).toBe(
      "每次最多附加 100 项画布内容，请移除部分上下文后重试",
    );
    expect(validateAgentMessage("生成外套", 100)).toBeNull();
  });

  it("loads project conversations without browser caching", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listAgentConversations("project a")).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%20a/agent-conversations?limit=50",
      { cache: "no-store", credentials: "include" },
    );
  });

  it("sends only explicit shape and file context", async () => {
    const body = {
      assistantMessage: { id: "assistant-a" },
      taskId: "task-a",
      userMessage: { id: "user-a" },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendAgentMessage("conversation-a", {
        clientRequestId: "request-123",
        content: "根据选中素材生成风衣",
        fileAssetIds: ["file-a"],
        shapeIds: ["shape-a"],
      }),
    ).resolves.toEqual(body);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      clientRequestId: "request-123",
      content: "根据选中素材生成风衣",
      fileAssetIds: ["file-a"],
      shapeIds: ["shape-a"],
    });
  });

  it("loads older messages with a cursor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listAgentMessages("conversation a", "message/older");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent-conversations/conversation%20a/messages?limit=50&cursor=message%2Folder",
      { cache: "no-store", credentials: "include" },
    );
  });

  it("updates a conversation through the patch endpoint", async () => {
    const body = { id: "conversation-a", title: "机能风系列" };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateAgentConversation("conversation-a", { title: "机能风系列" }),
    ).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent-conversations/conversation-a",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("attaches an existing generation task to the active conversation", async () => {
    const body = {
      content: "局部重绘：调整领口结构",
      generationTaskId: "task/inpaint",
      id: "message-inpaint",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      attachGenerationTaskToConversation("conversation a", "task/inpaint", {
        content: "局部重绘：调整领口结构",
        fileAssetIds: [],
        shapeIds: [],
      }),
    ).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent-conversations/conversation%20a/generation-tasks/task%2Finpaint",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
