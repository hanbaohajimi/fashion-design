import type { AgentMessageView } from "@fashion/shared";
import { decideWorkflowProposal, executeWorkflowNode, fetchWorkflowToolCatalog, updateWorkflowAgentSettings, type WorkflowProposal } from "../workflow/workflow-api";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachGenerationTaskToConversation,
  applyAgentDomainAction,
  AgentRunApiError,
  controlAgentRun,
  createAgentRun,
  createAgentConversation,
  fetchWorkflowConversationContext,
  fetchWorkflowConversationPlan,
  fetchAgentRun,
  getProjectConversationRequest,
  hasPendingAgentMessage,
  listAgentConversations,
  listAgentMessages,
  listAgentRuns,
  requestAgentDomainAction,
  reconcileAgentTurnMessages,
  sendAgentMessage,
  sendWorkflowMessage,
  updateAgentConversation,
  updateAgentRunStep,
  updateAgentRunPlan,
  updateWorkflowConversationContext,
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
  it("工具执行明确归属会话，拒绝理由和项目开关走独立接口", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ revision: 3 })));
    vi.stubGlobal("fetch", fetchMock);
    await executeWorkflowNode("project/a", "tool/a", "conversation-a");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/projects/project%2Fa/workflow/nodes/tool%2Fa/execute");
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({ conversationId: "conversation-a" });
    await decideWorkflowProposal("project/a", { id: "proposal/a", baseRevision: 7 } as WorkflowProposal, "reject", "这个分支要保持袖型");
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toMatchObject({ reason: "这个分支要保持袖型" });
    await fetchWorkflowToolCatalog("project/a");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/projects/project%2Fa/workflow/tools");
    await updateWorkflowAgentSettings("project/a", 1);
    expect(JSON.parse(String((fetchMock.mock.calls[3]?.[1] as RequestInit).body))).toEqual({ version: 1 });
  });
  it("持续设计消息使用专用接口，保留请求编号、显式引用和持久焦点", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ userMessage: { id: "u" }, assistantMessage: { id: "a", kind: "reply", proposal: null } })));
    vi.stubGlobal("fetch", fetchMock);
    await createAgentConversation("project a", { mode: "workflow" });
    const input = { clientRequestId: "request-one", content: "比较当前方案", referencedNodeIds: ["candidate-b"], focusNodeIds: ["candidate-a"] };
    await sendWorkflowMessage("conversation/a", input);
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({ mode: "workflow" });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/agent-conversations/conversation%2Fa/workflow-messages");
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual(input);
  });

  it("调整绑定原提案，结构化更正和计划读取保留新协议字段", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ revision: 3, plan: null })));
    vi.stubGlobal("fetch", fetchMock);
    const adjustment = { clientRequestId: "adjust-1", content: "只修改数量为4", referencedNodeIds: ["new-constraint"], respondingToProposalId: "proposal-a" };
    await sendWorkflowMessage("conversation/a", adjustment);
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual(adjustment);
    const correction = { baseRevision: 3, mutationId: "correct-1", updatedItems: [{ id: "prefer-a", text: "该分支使用银色", confirm: true, scope: "branch" as const }] };
    await updateWorkflowConversationContext("conversation/a", correction);
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual(correction);
    await fetchWorkflowConversationPlan("conversation/a");
    expect(fetchMock.mock.calls[2]).toEqual(["/api/agent-conversations/conversation%2Fa/plan", { cache: "no-store", credentials: "include", signal: expect.any(AbortSignal) }]);
  });

  it("上下文读取禁用缓存，更正携带项目revision、会话summaryRevision与mutationId", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ revision: 4, summaryRevision: 7 })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchWorkflowConversationContext("conversation/a")).resolves.toMatchObject({ revision: 4, summaryRevision: 7 });
    const update = { baseRevision: 4, summaryRevision: 7, mutationId: "context-edit", currentObjective: "轻量通勤风衣", focusNodeIds: [], disabledPreferenceIds: ["prefer-shine"] };
    await updateWorkflowConversationContext("conversation/a", update);
    expect(fetchMock.mock.calls[0]).toEqual(["/api/agent-conversations/conversation%2Fa/context", { cache: "no-store", credentials: "include", signal: expect.any(AbortSignal) }]);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/agent-conversations/conversation%2Fa/context");
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe("PATCH");
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual(update);
  });

  it("持续对话冲突保留服务端的具体原因，提示等待或刷新相应状态", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "上一条消息正在处理，请等待完成后再发送" }), { status: 409 })));
    await expect(sendWorkflowMessage("conversation-a", { clientRequestId: "busy", content: "继续", referencedNodeIds: [] })).rejects.toThrow("上一条消息正在处理，请等待完成后再发送");
  });

  it("焦点版本冲突保留服务端提示，不自动使用新summaryRevision重放旧焦点", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "会话焦点已更新，请刷新后再修改" }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(updateWorkflowConversationContext("conversation-a", { baseRevision: 4, summaryRevision: 2, mutationId: "stale-focus", focusNodeIds: ["old-candidate"] })).rejects.toThrow("会话焦点已更新，请刷新后再修改");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({ summaryRevision: 2, focusNodeIds: ["old-candidate"] });
  });

  it("领域动作保留请求ID并绑定具体节点与候选；应用建议只带当前revision", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ id: "run-a" })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      revision: 7,
      clientRequestId: "check-request-a",
      kind: "evaluate_candidate" as const,
      stepId: "step/a",
      assetId: "asset-second",
    };
    await requestAgentDomainAction("run/a", input);
    await applyAgentDomainAction("run/a", "action/a", { revision: 8 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/agent-runs/run%2Fa/agent-actions",
    );
    expect(
      JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)),
    ).toEqual(input);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/agent-runs/run%2Fa/agent-actions/action%2Fa/apply",
    );
    expect(
      JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)),
    ).toEqual({ revision: 8 });
  });
  it("保存完整节点规格和固定revision，拒绝候选只发送调整原因", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ id: "run-a" })),
      );
    vi.stubGlobal("fetch", fetchMock);
    await updateAgentRunPlan("run-a", { revision: 7, steps: [] });
    await controlAgentRun("run-a", "reject", {
      revision: 8,
      reason: "织物反光过强",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/agent-runs/run-a/plan");
    expect(
      JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)),
    ).toEqual({ revision: 7, steps: [] });
    expect(
      JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)),
    ).toEqual({ revision: 8, reason: "织物反光过强" });
  });
  it("读取持久化计划与状态时使用会话或计划作用域，禁用缓存", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ items: [] })),
      );
    vi.stubGlobal("fetch", fetchMock);
    await listAgentRuns("conversation a");
    await fetchAgentRun("run/a");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/agent-conversations/conversation%20a/plans",
      {
        cache: "no-store",
        credentials: "include",
        signal: expect.any(AbortSignal),
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/agent-runs/run%2Fa", {
      cache: "no-store",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });

  it("计划创建保留客户端请求ID，节点保存与人工确认都带revision", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ id: "run-a" })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const planInput = {
      clientRequestId: "request-a",
      content: "先设计再调整面料",
      shapeIds: ["shape-a"],
      fileAssetIds: [],
    };
    await createAgentRun("conversation-a", planInput);
    await updateAgentRunStep("run-a", "step/a", {
      revision: 2,
      prompt: "new prompt",
      negativePrompt: "logos",
    });
    await controlAgentRun("run-a", "review", {
      revision: 3,
      assetId: "asset-second",
      reason: "面料自然",
    });
    const bodies = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body)),
    );
    expect(bodies).toEqual([
      planInput,
      { revision: 2, prompt: "new prompt", negativePrompt: "logos" },
      { revision: 3, assetId: "asset-second", reason: "面料自然" },
    ]);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/agent-runs/run-a/steps/step%2Fa",
    );
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe("PATCH");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/agent-runs/run-a/review");
  });

  it("revision冲突保留409状态并提示刷新", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "REVISION_CONFLICT" }), {
          status: 409,
        }),
      ),
    );
    await expect(
      controlAgentRun("run-a", "execute", { revision: 1 }),
    ).rejects.toEqual(
      new AgentRunApiError("工作流已在其他页面更新，请刷新状态后继续", 409),
    );
  });
  it("轮询已写入真实消息时不会在发送完成后重复追加", () => {
    const older = agentMessage("older", "user");
    const userMessage = agentMessage("user-real", "user");
    const assistantMessage = agentMessage("assistant-real", "assistant");

    const reconciled = reconcileAgentTurnMessages(
      [older, userMessage, assistantMessage, userMessage, assistantMessage],
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
      { cache: "no-store", credentials: "include", signal: expect.any(AbortSignal) },
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
      { cache: "no-store", credentials: "include", signal: expect.any(AbortSignal) },
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
