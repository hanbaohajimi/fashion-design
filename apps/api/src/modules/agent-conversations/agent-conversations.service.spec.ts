import { AgentMessageRole, AgentMessageStatus, Prisma } from "@fashion/db";
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
      create: vi.fn().mockResolvedValue(conversationFixture()),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(conversationFixture()),
      update: vi.fn().mockResolvedValue(conversationFixture()),
    },
    agentMessage: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    boardElement: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    fabric: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    fileAsset: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    generationTask: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    project: {
      findUnique: vi.fn().mockResolvedValue({
        deletedAt: null,
        id: "project-a",
        workspace: { ownerId: "user-a" },
      }),
    },
  };
  const model = { generateJson: vi.fn() };
  const generation = { create: vi.fn() };
  const storage = {
    readPrefix: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3])),
  };
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

  it("normalizes a provider reply that serializes generation as a string", async () => {
    const harness = createHarness();
    harness.model.generateJson.mockImplementation(
      async (options: { parse: (value: unknown) => unknown }) =>
        options.parse({
          action: "reply",
          generation: "null",
          message: "先确认目标场景，再收敛廓形和面料。",
        }),
    );
    harness.database.agentMessage.update.mockResolvedValue(
      messageFixture(AgentMessageRole.ASSISTANT, {
        content: "先确认目标场景，再收敛廓形和面料。",
        status: AgentMessageStatus.COMPLETED,
      }),
    );

    const result = await harness.service.send("user-a", "conversation-a", {
      clientRequestId: "request-123",
      content: "我应该从哪里开始？",
      fileAssetIds: [],
      shapeIds: [],
    });

    expect(result.assistantMessage.status).toBe("completed");
    expect(result.taskId).toBeNull();
    expect(harness.generation.create).not.toHaveBeenCalled();
    expect(harness.database.agentMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: "先确认目标场景，再收敛廓形和面料。",
          status: AgentMessageStatus.COMPLETED,
        }),
      }),
    );
  });

  it.each([
    {
      files: [{ height: 900, id: "file-a", objectKey: "a", width: 1600 }],
      height: 768,
      label: "横图",
      width: 1024,
    },
    {
      files: [{ height: 1600, id: "file-a", objectKey: "a", width: 900 }],
      height: 1024,
      label: "竖图",
      width: 768,
    },
    {
      files: [{ height: 1200, id: "file-a", objectKey: "a", width: 1200 }],
      height: 1024,
      label: "方图",
      width: 1024,
    },
    {
      files: [{ height: null, id: "file-a", objectKey: "a", width: 0 }],
      height: 1024,
      label: "异常尺寸",
      width: 1024,
    },
    {
      files: [
        { height: 900, id: "file-a", objectKey: "a", width: 1600 },
        { height: 1600, id: "file-b", objectKey: "b", width: 900 },
      ],
      height: 768,
      label: "多图以首图为准",
      width: 1024,
    },
  ])(
    "uses fixed generation parameters and resolves $label output size",
    async ({ files, height, width }) => {
      const harness = createHarness();
      harness.database.boardElement.findMany.mockResolvedValue(
        files.map((file, index) => ({
          fileAssetId: file.id,
          record: { props: {} },
          role: index === 0 ? "style_ref" : "detail_ref",
          roleLabel: null,
          shapeId: `shape-${index}`,
          shapeType: "fashion-image",
        })),
      );
      harness.database.fileAsset.count.mockResolvedValue(files.length);
      harness.database.fileAsset.findMany.mockResolvedValue(
        files.map((file) => ({
          ...file,
          mimeType: "image/png",
          sizeBytes: 3,
          thumbnail1024Key: `thumbnail-${file.objectKey}`,
        })),
      );
      harness.model.generateJson.mockResolvedValue({
        action: "generate",
        generation: {
          negativePrompt: "watermark",
          prompt: "structured trench coat editorial",
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
        shapeIds: files.map((_, index) => `shape-${index}`),
      });

      expect(result.taskId).toBe("task-a");
      expect(harness.model.generateJson).toHaveBeenCalledWith(
        expect.objectContaining({
          images: files.map(() => ({
            detail: "auto",
            url: "data:image/webp;base64,AQID",
          })),
        }),
      );
      expect(harness.storage.readPrefix).toHaveBeenCalledTimes(files.length);
      files.forEach((file) => {
        expect(harness.storage.readPrefix).toHaveBeenCalledWith(
          `thumbnail-${file.objectKey}`,
          expect.any(Number),
        );
      });
      expect(harness.generation.create).toHaveBeenCalledWith(
        "user-a",
        {
          background: "opaque",
          height,
          negativePrompt: "watermark",
          outputCompression: 90,
          outputFormat: "png",
          projectId: "project-a",
          prompt: "structured trench coat editorial",
          quality: "high",
          shapeIds: files.map((_, index) => `shape-${index}`),
          taskType: "t2i",
          width,
        },
        "agent:conversation-a:request-123",
        "参考选中廓形生成一件风衣",
      );
    },
  );

  it("把便签、色值和面料标签作为权威事实传给 Agent", async () => {
    const harness = createHarness();
    let receivedElements: unknown;
    harness.database.boardElement.findMany.mockResolvedValue([
      {
        fileAssetId: null,
        record: {
          props: {
            roleLabel: "保留不对称门襟，降低肩部体积",
            text: "袖口使用隐藏式按扣",
          },
        },
        role: "note",
        roleLabel: null,
        shapeId: "note-a",
        shapeType: "fashion-note",
      },
      {
        fileAssetId: null,
        record: { props: { color: "#8B1E2D", label: "酒红" } },
        role: "palette",
        roleLabel: null,
        shapeId: "swatch-a",
        shapeType: "fashion-swatch",
      },
      {
        fileAssetId: null,
        record: {
          props: { fabricId: "fabric-a", fabricTags: ["精纺羊毛", "挺括"] },
        },
        role: "fabric_ref",
        roleLabel: null,
        shapeId: "fabric-a-shape",
        shapeType: "fashion-fabric",
      },
    ]);
    harness.database.fabric.findMany.mockResolvedValue([
      {
        id: "fabric-a",
        tags: ["精纺羊毛", "挺括"],
      },
    ]);
    harness.model.generateJson.mockImplementation(
      async (options: { prompt: string }) => {
        const prompt = JSON.parse(options.prompt) as {
          canvasContext: { elements: unknown[] };
        };
        receivedElements = prompt.canvasContext.elements;
        return {
          action: "reply",
          generation: null,
          message: "已读取所选设计约束。",
        };
      },
    );
    harness.database.agentMessage.update.mockResolvedValue(
      messageFixture(AgentMessageRole.ASSISTANT, {
        content: "已读取所选设计约束。",
        status: AgentMessageStatus.COMPLETED,
      }),
    );

    const result = await harness.service.send("user-a", "conversation-a", {
      clientRequestId: "request-context",
      content: "总结所选约束",
      fileAssetIds: [],
      shapeIds: ["note-a", "swatch-a", "fabric-a-shape"],
    });

    expect(harness.model.generateJson).toHaveBeenCalledOnce();
    expect(result.assistantMessage.status).toBe("completed");
    expect(receivedElements).toEqual([
      expect.objectContaining({
        role: "note",
        roleLabel: "保留不对称门襟，降低肩部体积",
        shapeId: "note-a",
        text: "袖口使用隐藏式按扣",
      }),
      expect.objectContaining({
        color: "#8B1E2D",
        label: "酒红",
        role: "palette",
      }),
      expect.objectContaining({
        fabricId: "fabric-a",
        fabricTags: ["精纺羊毛", "挺括"],
        role: "fabric_ref",
      }),
    ]);
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

  it("retries a failed turn with the same request id without creating duplicate messages", async () => {
    const harness = createHarness();
    const originalUser = messageFixture(AgentMessageRole.USER, {
      content: "生成一件风衣",
    });
    const failedAssistant = messageFixture(AgentMessageRole.ASSISTANT, {
      content: "我暂时无法完成这次请求。你可以检查上下文后重试。",
      errorCode: "AGENT_REQUEST_FAILED",
      errorMessage: "provider offline",
      status: AgentMessageStatus.FAILED,
    });
    harness.database.agentMessage.findUnique
      .mockResolvedValueOnce(originalUser)
      .mockResolvedValueOnce(failedAssistant);
    harness.model.generateJson.mockResolvedValue({
      action: "reply",
      generation: null,
      message: "已恢复，可以继续完善风衣方案。",
    });
    harness.database.agentMessage.update
      .mockResolvedValueOnce(
        messageFixture(AgentMessageRole.ASSISTANT, {
          content: "正在理解你的设计需求…",
          status: AgentMessageStatus.PENDING,
        }),
      )
      .mockResolvedValueOnce(
        messageFixture(AgentMessageRole.ASSISTANT, {
          content: "已恢复，可以继续完善风衣方案。",
          status: AgentMessageStatus.COMPLETED,
        }),
      );

    const result = await harness.service.send("user-a", "conversation-a", {
      clientRequestId: "request-123",
      content: "生成一件风衣",
      fileAssetIds: [],
      shapeIds: [],
    });

    expect(result.assistantMessage.status).toBe("completed");
    expect(harness.database.$transaction).not.toHaveBeenCalled();
    expect(harness.model.generateJson).toHaveBeenCalledOnce();
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

  it("rejects new messages for an archived conversation", async () => {
    const harness = createHarness();
    harness.database.agentConversation.findUnique.mockResolvedValue({
      ...conversationFixture(),
      archivedAt: now,
    });

    await expect(
      harness.service.send("user-a", "conversation-a", {
        clientRequestId: "request-123",
        content: "继续生成",
        fileAssetIds: [],
        shapeIds: [],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: "AGENT_CONVERSATION_ARCHIVED",
      }),
    });
    expect(harness.database.$transaction).not.toHaveBeenCalled();
  });

  it("returns the concurrent turn when the idempotency constraint races", async () => {
    const harness = createHarness();
    const completedAssistant = messageFixture(AgentMessageRole.ASSISTANT, {
      content: "并发请求已完成。",
      status: AgentMessageStatus.COMPLETED,
    });
    harness.database.agentMessage.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(messageFixture(AgentMessageRole.USER))
      .mockResolvedValueOnce(completedAssistant);
    harness.database.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        clientVersion: "test",
        code: "P2002",
      }),
    );

    const result = await harness.service.send("user-a", "conversation-a", {
      clientRequestId: "request-123",
      content: "并发重复发送",
      fileAssetIds: [],
      shapeIds: [],
    });

    expect(result.assistantMessage.content).toBe("并发请求已完成。");
    expect(harness.model.generateJson).not.toHaveBeenCalled();
  });

  it("paginates project conversations and updates their title", async () => {
    const harness = createHarness();
    const older = {
      ...conversationFixture(),
      id: "conversation-b",
      title: "旧会话",
    };
    harness.database.agentConversation.findMany.mockResolvedValue([
      conversationFixture(),
      older,
    ]);
    harness.database.agentConversation.update.mockResolvedValue({
      ...conversationFixture(),
      title: "机能风系列",
    });

    const page = await harness.service.list("user-a", "project-a", {
      limit: 1,
    });
    const updated = await harness.service.update("user-a", "conversation-a", {
      title: "机能风系列",
    });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe("conversation-a");
    expect(updated.title).toBe("机能风系列");
  });

  it("attaches an owned generation task to the current conversation", async () => {
    const harness = createHarness();
    const attachedMessage = messageFixture(AgentMessageRole.ASSISTANT, {
      content: "局部重绘：调整领口结构",
      generationTaskId: "task-inpaint",
      status: AgentMessageStatus.COMPLETED,
    });
    const createMessage = vi.fn().mockResolvedValue(attachedMessage);
    harness.database.generationTask.findFirst.mockResolvedValue({
      id: "task-inpaint",
    });
    harness.database.$transaction.mockImplementationOnce(
      async (callback: (transaction: unknown) => unknown) =>
        callback({
          agentConversation: { update: vi.fn().mockResolvedValue(undefined) },
          agentMessage: { create: createMessage },
        }),
    );

    const result = await harness.service.attachGenerationTask(
      "user-a",
      "conversation-a",
      "task-inpaint",
      {
        content: "局部重绘：调整领口结构",
        fileAssetIds: [],
        shapeIds: [],
      },
    );

    expect(result.generationTaskId).toBe("task-inpaint");
    expect(harness.database.generationTask.findFirst).toHaveBeenCalledWith({
      where: {
        id: "task-inpaint",
        projectId: "project-a",
        userId: "user-a",
      },
    });
    expect(createMessage).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: "conversation-a",
        generationTaskId: "task-inpaint",
        role: AgentMessageRole.ASSISTANT,
      }),
    });
  });
});
