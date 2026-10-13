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
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    boardElement: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    designAsset: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    designAssetDecision: {
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
  const generation = { create: vi.fn(), createFromAgent: vi.fn() };
  const storage = {
    readPrefix: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3])),
  };
  const run = { id: "run-a", status: "planning", revision: 0, steps: [] };
  const runs = {
    findReservation: vi.fn().mockResolvedValue(null),
    reserve: vi.fn().mockResolvedValue({ created: true, run }),
    completePlan: vi.fn().mockResolvedValue({ ...run, status: "ready" }),
    failPlanning: vi.fn().mockResolvedValue({ ...run, status: "failed" }),
    list: vi.fn().mockResolvedValue({ items: [] }),
  };
  return {
    database,
    generation,
    model,
    runs,
    service: new AgentConversationsService(
      database as never,
      model as never,
      generation as never,
      storage as never,
      runs as never,
    ),
    storage,
  };
}

describe("AgentConversationsService", () => {
  it("reserves a persisted plan before the Planner call and does not generate images", async () => {
    const harness = createHarness();
    const steps = [
      {
        key: "base",
        tool: "generate_design",
        title: "初步设计",
        instruction: "探索立领风衣",
        prompt: "stand collar coat",
        negativePrompt: "",
        sourceAssetId: null,
        sourceStepKey: null,
      },
    ];
    harness.model.generateJson.mockImplementation(async (input) => {
      expect(harness.runs.reserve).toHaveBeenCalledOnce();
      return input.parse(
        input.schemaName === "fashion_design_brief"
          ? {
              summary: "探索风衣",
              garmentType: "风衣",
              constraints: [],
              unknowns: ["面料未指定"],
            }
          : {
              steps,
              rationales: [
                {
                  stepKey: "base",
                  goal: "探索立领风衣",
                  constraintIds: [],
                  acceptanceChecks: ["服装单品展示"],
                },
              ],
            },
      );
    });
    await expect(
      harness.service.createPlan("user-a", "conversation-a", {
        content: "设计一件风衣",
        clientRequestId: "plan-key-123",
        fileAssetIds: [],
        shapeIds: [],
      }),
    ).resolves.toMatchObject({ status: "ready" });
    expect(harness.runs.completePlan).toHaveBeenCalledWith(
      "user-a",
      "run-a",
      steps,
      expect.objectContaining({
        version: "fashion-agents/1",
        brief: expect.objectContaining({ garmentType: "风衣" }),
        evidence: [
          {
            id: "goal",
            kind: "intent",
            label: "本轮设计目标",
            text: "设计一件风衣",
            assetId: null,
          },
        ],
      }),
    );
    expect(harness.model.generateJson).toHaveBeenCalledWith(
      expect.objectContaining({ schemaName: "fashion_design_plan" }),
    );
    expect(harness.generation.createFromAgent).not.toHaveBeenCalled();
    expect(harness.model.generateJson).toHaveBeenCalledTimes(2);
    expect(
      harness.database.designAssetDecision.findMany,
    ).not.toHaveBeenCalled();
  });

  it("replays an existing plan without another model request", async () => {
    const harness = createHarness();
    harness.runs.reserve.mockResolvedValue({
      created: false,
      run: { id: "run-a", status: "ready", revision: 1, steps: [] },
    });
    await harness.service.createPlan("user-a", "conversation-a", {
      content: "设计风衣",
      clientRequestId: "plan-key-123",
      fileAssetIds: [],
      shapeIds: [],
    });
    expect(harness.model.generateJson).not.toHaveBeenCalled();
    expect(harness.runs.completePlan).not.toHaveBeenCalled();
  });

  it("limits plan evidence to the selected asset and keeps historical decisions scoped", async () => {
    const harness = createHarness();
    harness.database.boardElement.findMany.mockResolvedValue([
      {
        fileAssetId: null,
        role: "garment_ref",
        roleLabel: null,
        shapeId: "shape-a",
        shapeType: "fashion-image",
        record: { props: { assetId: "asset-a", label: "当前风衣" } },
      },
    ]);
    harness.database.designAsset.findMany.mockResolvedValue([
      {
        id: "asset-a",
        url: "s3://generated/asset-a/image.webp",
        thumbnailUrl: "s3://generated/asset-a/thumb.webp",
        width: 1024,
        height: 1024,
      },
    ]);
    harness.database.designAssetDecision.findMany.mockResolvedValue([
      {
        id: "decision-a",
        assetId: "asset-a",
        kind: "rejected",
        reason: "旧版本袖子太宽",
      },
    ]);
    harness.model.generateJson.mockImplementation(async (input) => {
      if (input.schemaName === "fashion_design_brief") {
        expect(input.prompt).toContain("旧版本袖子太宽");
        expect(input.prompt).toContain('"kind":"decision"');
        expect(input.images).toHaveLength(1);
        return input.parse({
          summary: "改进风衣袖宽",
          garmentType: "风衣",
          constraints: [],
          unknowns: [],
        });
      }
      expect(input.images ?? []).toHaveLength(0);
      return input.parse({
        steps: [
          {
            key: "sleeves",
            tool: "edit_design",
            title: "收窄袖子",
            instruction: "调整袖宽",
            prompt: "narrower sleeves, preserve collar and color",
            negativePrompt: "",
            sourceAssetId: "asset-a",
            sourceStepKey: null,
          },
        ],
        rationales: [
          {
            stepKey: "sleeves",
            goal: "收窄袖子",
            constraintIds: [],
            acceptanceChecks: ["检查袖宽"],
          },
        ],
      });
    });
    await expect(
      harness.service.createPlan("user-a", "conversation-a", {
        content: "保持衣领，收窄袖子",
        clientRequestId: "scoped-plan-123",
        shapeIds: ["shape-a"],
        fileAssetIds: [],
      }),
    ).resolves.toMatchObject({ status: "ready" });
    expect(harness.database.designAssetDecision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-a",
          assetId: { in: ["asset-a"] },
          asset: {
            projectId: "project-a",
            archivedAt: null,
            project: { deletedAt: null, workspace: { ownerId: "user-a" } },
          },
        },
        take: 20,
      }),
    );
    expect(harness.runs.completePlan).toHaveBeenCalledWith(
      "user-a",
      "run-a",
      expect.any(Array),
      expect.objectContaining({
        evidence: expect.arrayContaining([
          expect.objectContaining({
            id: "decision_decision-a",
            assetId: "asset-a",
            kind: "decision",
          }),
        ]),
      }),
    );
  });

  it("records Planner failure when a tool or dependency is invalid", async () => {
    const harness = createHarness();
    harness.model.generateJson.mockImplementation(async (input) =>
      input.parse(
        input.schemaName === "fashion_design_brief"
          ? {
              summary: "设计风衣",
              garmentType: "风衣",
              constraints: [],
              unknowns: [],
            }
          : {
              steps: [
                {
                  key: "edit",
                  tool: "edit_design",
                  title: "调整",
                  instruction: "调整衣领",
                  prompt: "coat",
                  negativePrompt: "",
                  sourceAssetId: null,
                  sourceStepKey: "future",
                },
              ],
              rationales: [
                {
                  stepKey: "edit",
                  goal: "调整衣领",
                  constraintIds: [],
                  acceptanceChecks: [],
                },
              ],
            },
      ),
    );
    await expect(
      harness.service.createPlan("user-a", "conversation-a", {
        content: "设计风衣",
        clientRequestId: "plan-key-123",
        fileAssetIds: [],
        shapeIds: [],
      }),
    ).resolves.toMatchObject({ status: "failed" });
    expect(harness.runs.failPlanning).toHaveBeenCalledOnce();
    expect(harness.runs.completePlan).not.toHaveBeenCalled();
    expect(harness.generation.createFromAgent).not.toHaveBeenCalled();
  });

  it("restores the original plan before checking a board that has since changed", async () => {
    const harness = createHarness();
    harness.runs.findReservation.mockResolvedValue({
      id: "run-a",
      status: "ready",
    } as never);
    harness.database.boardElement.findMany.mockRejectedValue(
      new Error("the selected shape was deleted"),
    );
    await expect(
      harness.service.createPlan("user-a", "conversation-a", {
        content: "设计风衣",
        clientRequestId: "plan-key-123",
        fileAssetIds: [],
        shapeIds: ["deleted-shape"],
      }),
    ).resolves.toMatchObject({ id: "run-a", status: "ready" });
    expect(harness.database.boardElement.findMany).not.toHaveBeenCalled();
    expect(harness.runs.reserve).not.toHaveBeenCalled();
    expect(harness.model.generateJson).not.toHaveBeenCalled();
  });

  it("does not reserve a plan for an archived conversation", async () => {
    const harness = createHarness();
    harness.database.agentConversation.findUnique.mockResolvedValue({
      ...conversationFixture(),
      archivedAt: now,
    } as never);
    await expect(
      harness.service.createPlan("user-a", "conversation-a", {
        content: "设计风衣",
        clientRequestId: "plan-key-123",
        fileAssetIds: [],
        shapeIds: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.runs.reserve).not.toHaveBeenCalled();
    expect(harness.model.generateJson).not.toHaveBeenCalled();
  });

  it.each(["asset-a", "foreign-asset"])(
    "binds only a selected asset as an edit source: %s",
    async (sourceAssetId) => {
      const harness = createHarness();
      harness.database.boardElement.findMany.mockResolvedValue([
        {
          fileAssetId: null,
          role: "garment_ref",
          roleLabel: null,
          shapeId: "shape-a",
          shapeType: "fashion-image",
          record: { props: { assetId: "asset-a" } },
        },
      ]);
      harness.database.designAsset.findMany.mockResolvedValue([
        {
          id: "asset-a",
          url: "s3://generated/asset-a/image.webp",
          thumbnailUrl: "s3://generated/asset-a/thumb.webp",
          width: 1024,
          height: 1024,
        },
      ]);
      harness.model.generateJson.mockResolvedValue({
        action: "generate",
        generation: {
          prompt: "coat with revised cuffs",
          negativePrompt: "",
          sourceAssetId,
        },
        message: "修改选中设计的袖口。",
      });
      harness.generation.createFromAgent.mockResolvedValue({
        taskId: "task-a",
      });
      harness.database.agentMessage.update.mockResolvedValue(
        messageFixture(AgentMessageRole.ASSISTANT, {
          status: AgentMessageStatus.COMPLETED,
        }),
      );
      await harness.service.send("user-a", "conversation-a", {
        clientRequestId: "edit-request",
        content: "修改袖口",
        shapeIds: ["shape-a"],
        fileAssetIds: [],
      });
      if (sourceAssetId === "asset-a") {
        expect(harness.generation.createFromAgent).toHaveBeenCalledWith(
          "user-a",
          expect.objectContaining({
            taskType: "i2i",
            parentAssetId: "asset-a",
          }),
          expect.any(String),
          "修改袖口",
        );
        expect(harness.model.generateJson.mock.calls[0]?.[0].prompt).toContain(
          '"assetId":"asset-a"',
        );
      } else {
        expect(harness.generation.createFromAgent).not.toHaveBeenCalled();
      }
    },
  );

  it("读取消息时把超时遗留的 pending 助手消息回收为可重试失败态", async () => {
    const harness = createHarness();

    await harness.service.messages("user-a", "conversation-a", {
      limit: 50,
    });

    expect(harness.database.agentMessage.updateMany).toHaveBeenCalledWith({
      data: {
        content: expect.stringContaining("处理超时"),
        errorCode: "AGENT_REQUEST_INTERRUPTED",
        errorMessage: expect.stringContaining("pending"),
        status: AgentMessageStatus.FAILED,
      },
      where: {
        conversationId: "conversation-a",
        status: AgentMessageStatus.PENDING,
        updatedAt: { lt: expect.any(Date) },
      },
    });
  });

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
      harness.generation.createFromAgent.mockResolvedValue({
        taskId: "task-a",
      });
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
      expect(harness.generation.createFromAgent).toHaveBeenCalledWith(
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

  it("把当前选中的生成资产图片传给 Agent，并关联到对应画布元素", async () => {
    const harness = createHarness();
    harness.database.boardElement.findMany.mockResolvedValue([
      {
        fileAssetId: null,
        record: { props: { assetId: "asset-pink" } },
        role: "garment_ref",
        roleLabel: null,
        shapeId: "shape-pink",
        shapeType: "fashion-image",
      },
    ]);
    harness.database.designAsset.findMany.mockResolvedValue([
      {
        height: 1200,
        id: "asset-pink",
        thumbnailUrl: "s3://generated/pink/thumbnail-1024.webp",
        url: "s3://generated/pink/source",
        width: 900,
      },
    ]);
    harness.model.generateJson.mockResolvedValue({
      action: "reply",
      generation: null,
      message: "已按当前选中的粉色成衣理解。",
    });
    harness.database.agentMessage.update.mockResolvedValue(
      messageFixture(AgentMessageRole.ASSISTANT, {
        content: "已按当前选中的粉色成衣理解。",
        status: AgentMessageStatus.COMPLETED,
      }),
    );

    await harness.service.send("user-a", "conversation-a", {
      clientRequestId: "request-generated-image",
      content: "请生成模特试穿图",
      fileAssetIds: [],
      shapeIds: ["shape-pink"],
    });

    expect(harness.database.designAsset.findMany).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        id: { in: ["asset-pink"] },
        projectId: "project-a",
        project: { workspace: { ownerId: "user-a" } },
      },
      select: {
        height: true,
        id: true,
        thumbnailUrl: true,
        url: true,
        width: true,
      },
    });
    expect(harness.storage.readPrefix).toHaveBeenCalledWith(
      "generated/pink/thumbnail-1024.webp",
      expect.any(Number),
    );
    expect(harness.model.generateJson).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [
          {
            detail: "auto",
            url: "data:image/webp;base64,AQID",
          },
        ],
        prompt: expect.stringContaining('"imageIndex":0'),
      }),
    );
  });

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

  it("stores a timeout-specific assistant message when the model request times out", async () => {
    const harness = createHarness();
    harness.model.generateJson.mockRejectedValue(
      new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      ),
    );
    harness.database.agentMessage.update.mockResolvedValue(
      messageFixture(AgentMessageRole.ASSISTANT, {
        content:
          "设计助手处理时间超过 10 分钟，本次请求已停止。请重试；若仍失败，请减少上下文图片。",
        errorCode: "AGENT_REQUEST_TIMEOUT",
        errorMessage: "The operation was aborted due to timeout",
        status: AgentMessageStatus.FAILED,
      }),
    );

    const result = await harness.service.send("user-a", "conversation-a", {
      clientRequestId: "request-timeout",
      content: "生成一件风衣",
      fileAssetIds: [],
      shapeIds: [],
    });

    expect(result.assistantMessage.status).toBe("failed");
    expect(result.assistantMessage.content).toContain("超过 10 分钟");
    expect(result.assistantMessage.error?.code).toBe("AGENT_REQUEST_TIMEOUT");
    expect(harness.database.agentMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          errorCode: "AGENT_REQUEST_TIMEOUT",
        }),
      }),
    );
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
