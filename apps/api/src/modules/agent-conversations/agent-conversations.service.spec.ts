import { AgentMessageRole, AgentMessageStatus } from "@fashion/db";
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { AgentConversationsService } from "./agent-conversations.service";

const now = new Date("2026-08-05T08:00:00.000Z");

function conversationFixture() {
  return {
    archivedAt: null,
    createdAt: now,
    createdById: "user-a",
    id: "conversation-a",
    project: {
      deletedAt: null,
      workspace: { ownerId: "user-a" },
    },
    projectId: "project-a",
    title: "新的设计对话",
    updatedAt: now,
  };
}

function messageFixture(
  role: AgentMessageRole,
  overrides: Record<string, unknown> = {},
) {
  return {
    clientRequestId: role === AgentMessageRole.USER ? "request-123" : null,
    content:
      role === AgentMessageRole.USER ? "设计一件风衣" : "正在理解你的设计需求…",
    context:
      role === AgentMessageRole.USER
        ? { fileAssetIds: [], shapeIds: [] }
        : null,
    conversationId: "conversation-a",
    createdAt: now,
    errorCode: null,
    errorMessage: null,
    generationTaskId: null,
    id: role === AgentMessageRole.USER ? "message-user" : "message-assistant",
    replyToId: role === AgentMessageRole.USER ? null : "message-user",
    role,
    status:
      role === AgentMessageRole.USER
        ? AgentMessageStatus.COMPLETED
        : AgentMessageStatus.PENDING,
    updatedAt: now,
    ...overrides,
  };
}

function createHarness() {
  const userMessage = messageFixture(AgentMessageRole.USER);
  const pendingMessage = messageFixture(AgentMessageRole.ASSISTANT);
  const database = {
    $transaction: vi.fn(async (callback: (transaction: unknown) => unknown) =>
      callback({
        agentConversation: { update: vi.fn().mockResolvedValue(undefined) },
        agentMessage: {
          create: vi
            .fn()
            .mockResolvedValueOnce(userMessage)
            .mockResolvedValueOnce(pendingMessage),
        },
      }),
    ),
    agentConversation: {
      findUnique: vi.fn().mockResolvedValue(conversationFixture()),
    },
    agentMessage: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    boardElement: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    fileAsset: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    project: {},
  };
  const model = { generateJson: vi.fn() };
  const generation = { create: vi.fn() };
  const storage = { createDownloadUrl: vi.fn() };
  return {
    database,
    generation,
    model,
    service: new AgentConversationsService(
      database as never,
      model as never,
      generation as never,
      storage as never,
    ),
    storage,
  };
}

describe("AgentConversationsService", () => {
  it("persists a normal assistant reply without creating a generation task", async () => {
    const harness = createHarness();
    harness.model.generateJson.mockResolvedValue({
      action: "reply",
      generation: null,
      message: "可以，建议先确定风衣的长度和面料。",
    });
    harness.database.agentMessage.update.mockResolvedValue(
      messageFixture(AgentMessageRole.ASSISTANT, {
        content: "可以，建议先确定风衣的长度和面料。",
        status: AgentMessageStatus.COMPLETED,
      }),
    );

    const result = await harness.service.send("user-a", "conversation-a", {
      clientRequestId: "request-123",
      content: "你建议我先从哪里开始？",
      fileAssetIds: [],
      shapeIds: [],
    });

    expect(result.assistantMessage.status).toBe("completed");
    expect(result.taskId).toBeNull();
    expect(harness.generation.create).not.toHaveBeenCalled();
  });

  it("uses selected project shapes and the existing generation service", async () => {
    const harness = createHarness();
    harness.database.boardElement.findMany.mockResolvedValue([
      { fileAssetId: null, shapeId: "shape-a" },
    ]);
    harness.model.generateJson.mockResolvedValue({
      action: "generate",
      generation: {
        background: "opaque",
        height: 1024,
        negativePrompt: "watermark",
        outputFormat: "png",
        prompt: "structured trench coat editorial",
        quality: "high",
        width: 768,
      },
      message: "我会按选中的廓形参考生成一版风衣。",
    });
    harness.generation.create.mockResolvedValue({ taskId: "task-a" });
    harness.database.agentMessage.update.mockResolvedValue(
      messageFixture(AgentMessageRole.ASSISTANT, {
        content: "我会按选中的廓形参考生成一版风衣。",
        generationTaskId: "task-a",
        status: AgentMessageStatus.COMPLETED,
      }),
    );

    const result = await harness.service.send("user-a", "conversation-a", {
      clientRequestId: "request-123",
      content: "参考选中廓形生成一件风衣",
      fileAssetIds: [],
      shapeIds: ["shape-a"],
    });

    expect(result.taskId).toBe("task-a");
    expect(harness.generation.create).toHaveBeenCalledWith(
      "user-a",
      expect.objectContaining({
        projectId: "project-a",
        shapeIds: ["shape-a"],
        taskType: "t2i",
      }),
      "agent:conversation-a:request-123",
    );
  });

  it("rejects shape ids that do not belong to the conversation project", async () => {
    const harness = createHarness();

    await expect(
      harness.service.send("user-a", "conversation-a", {
        clientRequestId: "request-123",
        content: "使用这个素材",
        fileAssetIds: [],
        shapeIds: ["foreign-shape"],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.model.generateJson).not.toHaveBeenCalled();
  });

  it("stores a failed assistant message when the model is unavailable", async () => {
    const harness = createHarness();
    harness.model.generateJson.mockRejectedValue(new Error("provider offline"));
    harness.database.agentMessage.update.mockResolvedValue(
      messageFixture(AgentMessageRole.ASSISTANT, {
        content: "我暂时无法完成这次请求。你可以检查上下文后重试。",
        errorCode: "AGENT_REQUEST_FAILED",
        errorMessage: "provider offline",
        status: AgentMessageStatus.FAILED,
      }),
    );

    const result = await harness.service.send("user-a", "conversation-a", {
      clientRequestId: "request-123",
      content: "生成一件风衣",
      fileAssetIds: [],
      shapeIds: [],
    });

    expect(result.assistantMessage.status).toBe("failed");
    expect(result.assistantMessage.error?.code).toBe("AGENT_REQUEST_FAILED");
    expect(harness.generation.create).not.toHaveBeenCalled();
  });

  it("replays a completed turn for a duplicate client request id", async () => {
    const harness = createHarness();
    harness.database.agentMessage.findUnique
      .mockResolvedValueOnce(messageFixture(AgentMessageRole.USER))
      .mockResolvedValueOnce(
        messageFixture(AgentMessageRole.ASSISTANT, {
          content: "已创建生成任务。",
          generationTaskId: "task-a",
          status: AgentMessageStatus.COMPLETED,
        }),
      );

    const result = await harness.service.send("user-a", "conversation-a", {
      clientRequestId: "request-123",
      content: "重复发送",
      fileAssetIds: [],
      shapeIds: [],
    });

    expect(result.taskId).toBe("task-a");
    expect(harness.database.$transaction).not.toHaveBeenCalled();
    expect(harness.model.generateJson).not.toHaveBeenCalled();
  });
});
