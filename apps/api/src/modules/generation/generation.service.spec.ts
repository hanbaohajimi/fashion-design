import { GenerationTaskStatus } from "@fashion/db";
import { HttpStatus } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GenerationLimitExceededException } from "../billing/billing.errors";
import { BullGenerationJobs } from "./generation-queue.service";
import { GenerationService } from "./generation.service";

const request = {
  taskType: "t2i" as const,
  prompt: "fashion editorial",
  width: 1024,
  height: 1024,
  steps: 28,
  cfg: 3.5,
};

function taskRecord(overrides: Record<string, unknown> = {}) {
  return {
    attemptCount: 0,
    compiledPrompt: null,
    canceledAt: null,
    completedAt: null,
    countedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    errorCode: null,
    errorMessage: null,
    id: "task-1",
    input: request,
    output: null,
    providerJob: null,
    startedAt: null,
    status: GenerationTaskStatus.QUEUED,
    taskType: "t2i",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    userId: "user-1",
    ...overrides,
  };
}

describe("GenerationService", () => {
  const database = {
    designAsset: {
      findUnique: vi.fn(),
    },
    generationTask: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const jobs = {
    cancel: vi.fn(),
    enqueue: vi.fn(),
  };
  const billing = {
    canGenerate: vi.fn(),
    withLockedGenerationQuota: vi.fn(),
  };
  const compiler = {
    compile: vi.fn(),
  };
  const storage = {
    createDownloadUrl: vi.fn(),
  };
  const service = new GenerationService(
    database as never,
    jobs,
    billing as never,
    compiler as never,
    storage as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    billing.canGenerate.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 100,
      used: 0,
    });
    billing.withLockedGenerationQuota.mockImplementation(
      async (
        _userId: string,
        operation: (
          transaction: { generationTask: typeof database.generationTask },
          quota: {
            allowed: boolean;
            limit: number;
            remaining: number;
            used: number;
          },
        ) => Promise<unknown>,
      ) =>
        operation(
          { generationTask: database.generationTask },
          {
            allowed: true,
            limit: 100,
            remaining: 100,
            used: 0,
          },
        ),
    );
    database.generationTask.create.mockResolvedValue({ id: "task-1" });
    database.generationTask.findUnique.mockResolvedValue(undefined);
    database.generationTask.updateMany.mockResolvedValue({ count: 1 });
    jobs.cancel.mockResolvedValue(undefined);
    jobs.enqueue.mockResolvedValue(undefined);
    compiler.compile.mockResolvedValue({
      enhancement: "keywords",
      mode: "text_only",
      negativePrompt: "watermark",
      positivePrompt: "fashion editorial",
      version: 1,
    });
  });

  it("超限时返回 429 且不建任务、不入队", async () => {
    billing.canGenerate.mockResolvedValue({
      allowed: false,
      code: "GEN_LIMIT_EXCEEDED",
      limit: 100,
      message: "本月免费生成次数已用完",
      remaining: 0,
      used: 100,
    });

    const error = await service
      .create("user-1", request)
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(GenerationLimitExceededException);
    expect(error).toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(database.generationTask.create).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("通过额度检查后创建 queued task 并使用 task id 入队", async () => {
    await expect(service.create("user-1", request)).resolves.toEqual({
      taskId: "task-1",
    });

    expect(database.generationTask.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        input: expect.objectContaining({
          ...request,
          negativePrompt: expect.stringContaining("fashion model"),
          prompt: expect.stringContaining("garment-only"),
        }),
        compiledPrompt: expect.objectContaining({
          presentationPolicy: {
            matchedSignals: [],
            mode: "garment_only",
            version: 1,
          },
          positivePrompt: "fashion editorial",
        }),
        status: GenerationTaskStatus.QUEUED,
        taskType: "t2i",
        userId: "user-1",
      },
      select: { id: true },
    });
    expect(jobs.enqueue).toHaveBeenCalledWith("task-1", "user-1");
    expect(billing.withLockedGenerationQuota).toHaveBeenCalledOnce();
  });

  it("用户未明确要求试穿时默认注入无人物展示硬约束", async () => {
    await service.create("user-1", {
      ...request,
      negativePrompt: "blurry",
      prompt: "设计一件黑色廓形夹克",
    });

    const createData =
      database.generationTask.create.mock.calls.at(0)?.[0].data;
    expect(createData.input.prompt).toContain("garment-only");
    expect(createData.input.prompt).toContain("without any human wearer");
    expect(createData.input.negativePrompt).toContain("fashion model");
    expect(createData.input.negativePrompt).toContain("blurry");
    expect(createData.input.negativePrompt).toContain("watermark");
    expect(createData.compiledPrompt.presentationPolicy).toEqual({
      matchedSignals: [],
      mode: "garment_only",
      version: 1,
    });
  });

  it("用户明确要求模特试穿时不注入默认禁令", async () => {
    compiler.compile.mockResolvedValueOnce({
      enhancement: "keywords",
      mode: "text_only",
      negativePrompt: "watermark",
      positivePrompt: "a fashion model wearing a black jacket",
      version: 1,
    });

    await service.create("user-1", {
      ...request,
      prompt: "让模特试穿这件黑色夹克",
    });

    const createData =
      database.generationTask.create.mock.calls.at(0)?.[0].data;
    expect(createData.input.prompt).toBe(
      "a fashion model wearing a black jacket",
    );
    expect(createData.input.negativePrompt).toBe("watermark");
    expect(createData.compiledPrompt.presentationPolicy).toEqual({
      matchedSignals: ["zh_model_try_on"],
      mode: "on_model",
      version: 1,
    });
  });

  it("画布备注明确要求模特试穿时不注入默认禁令", async () => {
    const note =
      "全身正面平视视角，一位身材纤细、气场干练的短发亚裔女模特，" +
      "身穿短款雕塑感通勤夹克。模特双臂自然下垂，双手轻插裤袋。";
    compiler.compile.mockResolvedValueOnce({
      enhancement: "keywords",
      mode: "board_guided",
      negativePrompt: "watermark",
      notes: [note],
      positivePrompt: `design notes: ${note}`,
      version: 1,
    });

    await service.create(
      "user-1",
      { ...request, prompt: "生成一件短款通勤夹克" },
      "note-model-intent",
      "根据画布备注生成",
    );

    const createData =
      database.generationTask.create.mock.calls.at(0)?.[0].data;
    expect(createData.input.prompt).toContain("短发亚裔女模特");
    expect(createData.input.prompt).not.toContain("without any human wearer");
    expect(createData.input.negativePrompt).not.toContain("fashion model");
    expect(createData.compiledPrompt.presentationPolicy).toEqual({
      matchedSignals: ["zh_model_try_on"],
      mode: "on_model",
      version: 1,
    });
  });

  it("否定表达优先于试穿关键词", async () => {
    await service.create("user-1", {
      ...request,
      prompt: "不要模特试穿，只展示服装单品",
    });

    const createData =
      database.generationTask.create.mock.calls.at(0)?.[0].data;
    expect(createData.input.prompt).toContain("garment-only");
    expect(createData.compiledPrompt.presentationPolicy).toEqual({
      matchedSignals: ["zh_explicit_denial"],
      mode: "garment_only",
      version: 1,
    });
  });

  it("Agent 路径以原始用户消息判定，不信任模型改写后的试穿提示词", async () => {
    compiler.compile.mockResolvedValueOnce({
      enhancement: "llm",
      mode: "text_only",
      negativePrompt: "watermark",
      positivePrompt: "a fashion model wearing an editorial red dress",
      version: 1,
    });

    await service.create(
      "user-1",
      { ...request, prompt: "a fashion model wearing an editorial red dress" },
      "agent-raw-intent",
      "设计一条红色连衣裙",
    );

    const createData =
      database.generationTask.create.mock.calls.at(0)?.[0].data;
    expect(createData.input.prompt).toContain("garment-only");
    expect(createData.compiledPrompt.presentationPolicy.mode).toBe(
      "garment_only",
    );
  });

  it("在生成任务同一事务中记录 fabric_id 与标签快照血缘", async () => {
    compiler.compile.mockResolvedValue({
      enhancement: "keywords",
      fabricInputs: [
        {
          boardElementId: "board-element-1",
          fabricId: "fabric-1",
          role: "fabric_texture",
          tags: ["cotton blend", "plain"],
          weight: 0.7,
        },
      ],
      mode: "board_guided",
      negativePrompt: "watermark",
      positivePrompt: "fabric material: cotton 60%, polyester 40%",
      version: 1,
    });

    await service.create("user-1", request, "fabric-lineage-key");

    expect(database.generationTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          generationInputs: {
            create: [
              {
                boardElementId: "board-element-1",
                fabricId: "fabric-1",
                inputType: "fabric",
                role: "fabric_texture",
                tagsSnapshot: ["cotton blend", "plain"],
                weight: 0.7,
              },
            ],
          },
        }),
      }),
    );
  });

  it("权威事务发现活跃占用已满时不创建、不入队", async () => {
    billing.withLockedGenerationQuota.mockImplementation(
      async (
        _userId: string,
        operation: (
          transaction: { generationTask: typeof database.generationTask },
          quota: {
            allowed: boolean;
            limit: number;
            remaining: number;
            used: number;
          },
        ) => Promise<unknown>,
      ) =>
        operation(
          { generationTask: database.generationTask },
          {
            allowed: false,
            limit: 1,
            remaining: 0,
            used: 1,
          },
        ),
    );

    await expect(
      service.create("user-1", request, "authoritative-limit"),
    ).rejects.toBeInstanceOf(GenerationLimitExceededException);

    expect(database.generationTask.create).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("锁内发现并发创建的同幂等任务时允许重放，即使额度已满", async () => {
    await service.create("user-1", request, "concurrent-idempotency");
    const compiledPrompt =
      database.generationTask.create.mock.calls.at(0)?.[0].data.compiledPrompt;
    vi.clearAllMocks();
    billing.canGenerate.mockResolvedValue({
      allowed: true,
      limit: 1,
      remaining: 1,
      used: 0,
    });
    jobs.enqueue.mockResolvedValue(undefined);
    database.generationTask.findUnique
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        compiledPrompt,
        id: "existing-task",
        status: GenerationTaskStatus.QUEUED,
        userId: "user-1",
      });
    billing.withLockedGenerationQuota.mockImplementation(
      async (
        _userId: string,
        operation: (
          transaction: { generationTask: typeof database.generationTask },
          quota: {
            allowed: boolean;
            limit: number;
            remaining: number;
            used: number;
          },
        ) => Promise<unknown>,
      ) =>
        operation(
          { generationTask: database.generationTask },
          {
            allowed: false,
            limit: 1,
            remaining: 0,
            used: 1,
          },
        ),
    );

    await expect(
      service.create("user-1", request, "concurrent-idempotency"),
    ).resolves.toEqual({ taskId: "existing-task" });

    expect(database.generationTask.create).not.toHaveBeenCalled();
    expect(jobs.enqueue).toHaveBeenCalledWith("existing-task", "user-1");
  });

  it("保存 compiled_prompt，并把项目 id 与原始 prompt 隔离在 Provider 输入之外", async () => {
    await service.create("user-1", {
      ...request,
      projectId: "project-1",
      shapeIds: ["shape-1", "shape-2"],
    });

    expect(compiler.compile).toHaveBeenCalledWith(
      "user-1",
      "project-1",
      "fashion editorial",
      ["shape-1", "shape-2"],
    );
    const createData =
      database.generationTask.create.mock.calls.at(0)?.[0].data;
    expect(createData).toBeDefined();
    expect(createData.input).not.toHaveProperty("projectId");
    expect(createData.input).not.toHaveProperty("shapeIds");
    expect(createData.projectId).toBe("project-1");
    expect(createData.compiledPrompt).toMatchObject({
      positivePrompt: "fashion editorial",
      request: {
        ...request,
        projectId: "project-1",
        shapeIds: ["shape-1", "shape-2"],
      },
    });
  });

  it("把白板 style_ref 注入文生图 Provider 请求", async () => {
    compiler.compile.mockResolvedValueOnce({
      enhancement: "keywords",
      mode: "board_guided",
      negativePrompt: "watermark",
      positivePrompt: "fashion editorial",
      silhouetteReferences: [],
      styleReferences: [
        {
          elementId: "style-1",
          imageUrl: "https://signed.test/style.png",
          labels: [],
        },
      ],
      version: 1,
    });

    await service.create("user-1", {
      ...request,
      projectId: "project-1",
      shapeIds: ["style-shape"],
    });

    const createData =
      database.generationTask.create.mock.calls.at(0)?.[0].data;
    expect(createData.input).toMatchObject({
      referenceImageUrl: "https://signed.test/style.png",
      strength: 0.72,
      taskType: "t2i",
    });
    expect(createData.compiledPrompt).toMatchObject({
      styleReferences: [
        {
          elementId: "style-1",
          imageUrl: "https://signed.test/style.png",
        },
      ],
    });
  });

  it("趋势 style_ref 使用通道提供的 0.5 权重", async () => {
    compiler.compile.mockResolvedValueOnce({
      enhancement: "keywords",
      mode: "board_guided",
      negativePrompt: "watermark",
      positivePrompt: "dopamine dressing",
      silhouetteReferences: [],
      styleReferences: [
        {
          elementId: "trend-image-1",
          imageUrl: "https://signed.test/trend.png",
          labels: ["dopamine dressing"],
          role: "style_ref",
          trendItemId: "trend-1",
          weight: 0.5,
        },
      ],
      version: 1,
    });

    await service.create("user-1", {
      ...request,
      projectId: "project-1",
      shapeIds: ["trend-image-shape"],
    });

    const createData =
      database.generationTask.create.mock.calls.at(0)?.[0].data;
    expect(createData.input).toMatchObject({
      referenceImageUrl: "https://signed.test/trend.png",
      strength: 0.5,
      taskType: "t2i",
    });
  });

  it("没有风格或廓形参考时把面料纹理图和通道权重注入 Provider", async () => {
    compiler.compile.mockResolvedValueOnce({
      enhancement: "keywords",
      fabricInputs: [],
      fabricReferences: [
        {
          elementId: "fabric-element-1",
          fabricId: "fabric-1",
          imageUrl: "https://signed.test/fabric.png",
          labels: ["cotton 100%", "plain"],
          role: "fabric_texture",
          weight: 0.7,
        },
      ],
      mode: "board_guided",
      negativePrompt: "watermark",
      positivePrompt: "fabric material: cotton 100%, weave type: plain",
      silhouetteReferences: [],
      styleReferences: [],
      version: 1,
    });

    await service.create("user-1", {
      ...request,
      projectId: "project-1",
      shapeIds: ["fabric-shape"],
    });

    const createData =
      database.generationTask.create.mock.calls.at(0)?.[0].data;
    expect(createData.input).toMatchObject({
      referenceImageUrl: "https://signed.test/fabric.png",
      referenceImages: [
        {
          order: 0,
          role: "fabric_texture",
          url: "https://signed.test/fabric.png",
          weight: 0.7,
        },
      ],
      strength: 0.7,
      taskType: "t2i",
    });
  });

  it("保留多标签参考图的角色、权重和稳定顺序并让细节参考参与 Provider", async () => {
    compiler.compile.mockResolvedValueOnce({
      avoidLabels: [],
      detailReferences: [
        {
          elementId: "detail-1",
          imageUrl: "https://signed.test/detail.png",
          labels: ["bound seam"],
        },
      ],
      enhancement: "keywords",
      fabricInputs: [],
      fabricReferences: [
        {
          elementId: "fabric-1",
          fabricId: "fabric-1",
          imageUrl: "https://signed.test/fabric.png",
          labels: ["silk"],
          role: "fabric_texture",
          weight: 0.7,
        },
      ],
      mode: "board_guided",
      negativePrompt: "watermark",
      notes: [],
      palette: [],
      paletteReferences: [],
      patternReferences: [],
      positivePrompt: "silk dress with bound seam",
      silhouetteReferences: [
        {
          edgeImageUrl: "https://signed.test/silhouette.png",
          elementId: "silhouette-1",
        },
      ],
      styleReferences: [
        {
          elementId: "style-1",
          imageUrl: "https://signed.test/style.png",
          labels: [],
        },
      ],
      version: 1,
    });

    await service.create("user-1", {
      ...request,
      projectId: "project-1",
      shapeIds: ["style-1", "fabric-1", "silhouette-1", "detail-1"],
    });

    const createData =
      database.generationTask.create.mock.calls.at(0)?.[0].data;
    expect(createData.input.referenceImages).toEqual([
      {
        order: 0,
        role: "style_ref",
        url: "https://signed.test/style.png",
        weight: 0.72,
      },
      {
        order: 1,
        role: "fabric_texture",
        url: "https://signed.test/fabric.png",
        weight: 0.7,
      },
      {
        order: 2,
        role: "detail_ref",
        url: "https://signed.test/detail.png",
        weight: 0.65,
      },
      {
        order: 3,
        role: "silhouette_ref",
        url: "https://signed.test/silhouette.png",
        weight: 0.55,
      },
    ]);
  });

  it("变体任务校验父资产归属并保存 parentAssetId", async () => {
    database.designAsset.findUnique.mockResolvedValue({
      id: "asset-parent",
      projectId: "project-1",
      project: { workspace: { ownerId: "user-1" } },
      url: "https://cdn.test/parent.png",
    });

    await service.create("user-1", {
      ...request,
      parentAssetId: "asset-parent",
      projectId: "project-1",
    });

    expect(database.generationTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          parentAssetId: "asset-parent",
          projectId: "project-1",
        }),
      }),
    );
  });

  it("持久化候选采纳状态并保留生成结果", async () => {
    const images = [
      { assetId: "asset-1", url: "/api/design-assets/asset-1/content" },
    ];
    const existing = taskRecord({
      output: {
        images,
        seed: 7,
      },
      status: GenerationTaskStatus.SUCCEEDED,
    });
    database.generationTask.findFirst.mockResolvedValue(existing);
    database.generationTask.update.mockResolvedValue({
      ...existing,
      output: {
        candidateDispositions: { "0": "adopted" },
        images,
        seed: 7,
      },
    });

    const result = await service.setCandidateDisposition(
      "user-1",
      "task-1",
      0,
      "adopted",
    );

    expect(database.generationTask.update).toHaveBeenCalledWith({
      data: {
        output: {
          candidateDispositions: { "0": "adopted" },
          images,
          seed: 7,
        },
      },
      where: { id: "task-1" },
    });
    expect(result.output).toMatchObject({
      candidateDispositions: { "0": "adopted" },
    });
  });

  it("拒绝处置不存在的候选序号", async () => {
    database.generationTask.findFirst.mockResolvedValue(
      taskRecord({
        output: { images: [{ assetId: "asset-1", url: "https://cdn.test/1" }] },
        status: GenerationTaskStatus.SUCCEEDED,
      }),
    );

    await expect(
      service.setCandidateDisposition("user-1", "task-1", 2, "dismissed"),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(database.generationTask.update).not.toHaveBeenCalled();
  });

  it("相同幂等键命中 queued 任务时补投队列且不重复检查额度", async () => {
    await service.create("user-1", request, "same-generation-key");
    const compiledPrompt =
      database.generationTask.create.mock.calls.at(0)?.[0].data.compiledPrompt;
    vi.clearAllMocks();
    database.generationTask.findUnique.mockResolvedValue({
      id: "existing-task",
      userId: "user-1",
      status: GenerationTaskStatus.QUEUED,
      compiledPrompt,
    });
    jobs.enqueue.mockResolvedValue(undefined);

    await expect(
      service.create("user-1", request, "same-generation-key"),
    ).resolves.toEqual({ taskId: "existing-task" });

    expect(billing.canGenerate).not.toHaveBeenCalled();
    expect(database.generationTask.create).not.toHaveBeenCalled();
    expect(jobs.enqueue).toHaveBeenCalledWith("existing-task", "user-1");
  });

  it("相同幂等键复用于不同请求时返回 409", async () => {
    await service.create("user-1", request, "conflicting-key");
    const compiledPrompt =
      database.generationTask.create.mock.calls.at(0)?.[0].data.compiledPrompt;
    vi.clearAllMocks();
    database.generationTask.findUnique.mockResolvedValue({
      id: "existing-task",
      userId: "user-1",
      status: GenerationTaskStatus.QUEUED,
      compiledPrompt,
    });

    await expect(
      service.create(
        "user-1",
        { ...request, prompt: "a different request" },
        "conflicting-key",
      ),
    ).rejects.toMatchObject({
      response: { code: "IDEMPOTENCY_KEY_REUSED" },
      status: HttpStatus.CONFLICT,
    });
    expect(billing.canGenerate).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("幂等指纹包含系列上下文", async () => {
    await service.createForCollection(
      "user-1",
      request,
      {
        collectionId: "collection-1",
        variationAxis: "COLOR",
      },
      "collection-key",
    );
    const compiledPrompt =
      database.generationTask.create.mock.calls.at(0)?.[0].data.compiledPrompt;
    vi.clearAllMocks();
    database.generationTask.findUnique.mockResolvedValue({
      id: "existing-task",
      userId: "user-1",
      status: GenerationTaskStatus.QUEUED,
      compiledPrompt,
    });

    await expect(
      service.createForCollection(
        "user-1",
        request,
        {
          collectionId: "collection-1",
          variationAxis: "DETAIL",
        },
        "collection-key",
      ),
    ).rejects.toMatchObject({
      response: { code: "IDEMPOTENCY_KEY_REUSED" },
      status: HttpStatus.CONFLICT,
    });
  });

  it("系列任务最终请求保留原始变化轴硬约束", async () => {
    compiler.compile.mockResolvedValue({
      enhancement: "llm",
      mode: "text_only",
      negativePrompt: "watermark",
      positivePrompt: "normalized fashion collection prompt",
      version: 1,
    });

    await service.createForCollection(
      "user-1",
      {
        ...request,
        prompt: "本次变化轴：fabric。必须替换面料，不得沿用 Hero 的原面料。",
      },
      {
        collectionId: "collection-1",
        variationAxis: "FABRIC",
      },
      "collection-axis-prompt",
    );

    const input = database.generationTask.create.mock.calls.at(0)?.[0].data
      .input as { readonly prompt: string } | undefined;
    expect(input?.prompt).toContain("normalized fashion collection prompt");
    expect(input?.prompt).toContain("系列变化硬约束（必须逐条执行）");
    expect(input?.prompt).toContain("必须替换面料，不得沿用 Hero 的原面料");
  });

  it("入队响应丢失时保留 queued，并允许同幂等键补投", async () => {
    jobs.enqueue.mockRejectedValue(new Error("redis unavailable"));

    await expect(
      service.create("user-1", request, "response-lost-key"),
    ).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
    expect(database.generationTask.update).not.toHaveBeenCalled();

    const compiledPrompt =
      database.generationTask.create.mock.calls.at(0)?.[0].data.compiledPrompt;
    database.generationTask.findUnique.mockResolvedValue({
      compiledPrompt,
      id: "task-1",
      status: GenerationTaskStatus.QUEUED,
      userId: "user-1",
    });
    jobs.enqueue.mockResolvedValue(undefined);

    await expect(
      service.create("user-1", request, "response-lost-key"),
    ).resolves.toEqual({ taskId: "task-1" });
    expect(jobs.enqueue).toHaveBeenCalledTimes(2);
  });

  it("取消 queued task 后更新数据库并移除队列任务", async () => {
    database.generationTask.findFirst
      .mockResolvedValueOnce(taskRecord())
      .mockResolvedValueOnce(
        taskRecord({
          canceledAt: new Date(),
          completedAt: new Date(),
          status: GenerationTaskStatus.CANCELED,
        }),
      );

    const result = await service.cancel("user-1", "task-1");

    expect(result.status).toBe("canceled");
    expect(database.generationTask.updateMany).toHaveBeenCalledWith({
      where: {
        id: "task-1",
        status: {
          in: [GenerationTaskStatus.QUEUED, GenerationTaskStatus.RUNNING],
        },
        userId: "user-1",
      },
      data: expect.objectContaining({
        status: GenerationTaskStatus.CANCELED,
      }),
    });
    expect(jobs.cancel).toHaveBeenCalledWith("task-1");
  });

  it("Redis 暂时不可用时仍以数据库 canceled 状态为准", async () => {
    database.generationTask.findFirst
      .mockResolvedValueOnce(taskRecord())
      .mockResolvedValueOnce(
        taskRecord({ status: GenerationTaskStatus.CANCELED }),
      );
    jobs.cancel.mockRejectedValue(new Error("redis unavailable"));

    await expect(service.cancel("user-1", "task-1")).resolves.toMatchObject({
      status: "canceled",
    });
  });

  it("取消 CAS 失败时返回并保留并发完成的终态", async () => {
    database.generationTask.findFirst
      .mockResolvedValueOnce(taskRecord())
      .mockResolvedValueOnce(
        taskRecord({ status: GenerationTaskStatus.SUCCEEDED }),
      );
    database.generationTask.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.cancel("user-1", "task-1")).resolves.toMatchObject({
      status: "succeeded",
    });
    expect(jobs.cancel).not.toHaveBeenCalled();
  });

  it("用户不能读取不属于自己的任务", async () => {
    database.generationTask.findFirst.mockResolvedValue(null);

    await expect(service.get("user-2", "task-1")).rejects.toMatchObject({
      response: {
        code: "GENERATION_TASK_NOT_FOUND",
      },
      status: HttpStatus.NOT_FOUND,
    });
  });

  it("任务详情返回可查询的 compiled_prompt", async () => {
    database.generationTask.findFirst.mockResolvedValue(
      taskRecord({
        compiledPrompt: {
          mode: "board_guided",
          positivePrompt: "structured fashion prompt",
        },
      }),
    );

    await expect(service.get("user-1", "task-1")).resolves.toMatchObject({
      compiledPrompt: {
        mode: "board_guided",
        positivePrompt: "structured fashion prompt",
      },
      request,
    });
  });

  it("列表按 createdAt/id 倒序游标分页并返回 nextCursor", async () => {
    const cursorCreatedAt = new Date("2026-01-03T00:00:00.000Z");
    database.generationTask.findFirst.mockResolvedValue({
      createdAt: cursorCreatedAt,
      id: "task-3",
    });
    database.generationTask.findMany.mockResolvedValue([
      taskRecord({
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        id: "task-2",
        projectId: "project-1",
      }),
      taskRecord({
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        id: "task-1",
        projectId: "project-1",
      }),
      taskRecord({
        createdAt: new Date("2025-12-31T00:00:00.000Z"),
        id: "task-0",
        projectId: "project-1",
      }),
    ]);

    await expect(
      service.list("user-1", {
        cursor: "task-3",
        limit: 2,
        projectId: "project-1",
      }),
    ).resolves.toMatchObject({
      items: [
        { id: "task-2", request },
        { id: "task-1", request },
      ],
      nextCursor: "task-1",
    });

    expect(database.generationTask.findFirst).toHaveBeenCalledWith({
      where: {
        id: "task-3",
        projectId: "project-1",
        userId: "user-1",
      },
      select: {
        createdAt: true,
        id: true,
      },
    });
    expect(database.generationTask.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { createdAt: { lt: cursorCreatedAt } },
          {
            createdAt: cursorCreatedAt,
            id: { lt: "task-3" },
          },
        ],
        projectId: "project-1",
        userId: "user-1",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 3,
    });
  });

  it("列表拒绝不属于当前用户和项目的 cursor", async () => {
    database.generationTask.findFirst.mockResolvedValue(null);

    await expect(
      service.list("user-1", {
        cursor: "foreign-task",
        limit: 20,
        projectId: "project-1",
      }),
    ).rejects.toMatchObject({
      response: { code: "INVALID_GENERATION_CURSOR" },
      status: HttpStatus.BAD_REQUEST,
    });
    expect(database.generationTask.findMany).not.toHaveBeenCalled();
  });

  it("老任务从 input、项目、父资产及 compiledPrompt 尽力恢复 request", async () => {
    database.generationTask.findFirst.mockResolvedValue(
      taskRecord({
        compiledPrompt: {
          negativePrompt: "watermark",
          positivePrompt: "legacy compiled prompt",
        },
        input: {
          cfg: 3.5,
          height: 1024,
          steps: 28,
          taskType: "t2i",
          width: 1024,
        },
        parentAssetId: "asset-parent",
        projectId: "project-1",
      }),
    );

    await expect(service.get("user-1", "task-1")).resolves.toMatchObject({
      request: {
        cfg: 3.5,
        height: 1024,
        negativePrompt: "watermark",
        parentAssetId: "asset-parent",
        projectId: "project-1",
        prompt: "legacy compiled prompt",
        steps: 28,
        taskType: "t2i",
        width: 1024,
      },
    });
  });

  it("新任务详情优先返回持久化的原始 request", async () => {
    database.generationTask.findFirst.mockResolvedValue(
      taskRecord({
        compiledPrompt: {
          positivePrompt: "compiled prompt",
          request: {
            ...request,
            projectId: "project-1",
            prompt: "original prompt",
            shapeIds: ["shape-1"],
          },
        },
        input: {
          ...request,
          prompt: "compiled prompt",
        },
        projectId: "project-1",
      }),
    );

    await expect(service.get("user-1", "task-1")).resolves.toMatchObject({
      request: {
        ...request,
        projectId: "project-1",
        prompt: "original prompt",
        shapeIds: ["shape-1"],
      },
    });
  });
});

describe("BullGenerationJobs", () => {
  it("同 fixed jobId 已失败时重试原任务而不是静默跳过", async () => {
    const existing = {
      getState: vi.fn().mockResolvedValue("failed"),
      retry: vi.fn().mockResolvedValue(undefined),
      updateProgress: vi.fn().mockResolvedValue(undefined),
    };
    const queue = {
      add: vi.fn(),
      getJob: vi.fn().mockResolvedValue(existing),
    };
    const jobs = new BullGenerationJobs();
    Object.assign(jobs, { queue });

    await jobs.enqueue("task-1", "user-1");

    expect(existing.retry).toHaveBeenCalledWith("failed", {
      resetAttemptsMade: true,
      resetAttemptsStarted: true,
    });
    expect(queue.add).not.toHaveBeenCalled();
    expect(existing.updateProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "queued",
        taskId: "task-1",
      }),
    );
  });

  it("同 fixed jobId 已完成但数据库仍需补投时原子重试历史任务", async () => {
    const existing = {
      getState: vi.fn().mockResolvedValue("completed"),
      retry: vi.fn().mockResolvedValue(undefined),
      updateProgress: vi.fn().mockResolvedValue(undefined),
    };
    const queue = {
      add: vi.fn(),
      getJob: vi.fn().mockResolvedValue(existing),
    };
    const jobs = new BullGenerationJobs();
    Object.assign(jobs, { queue });

    await jobs.enqueue("task-1", "user-1");

    expect(existing.retry).toHaveBeenCalledWith("completed", {
      resetAttemptsMade: true,
      resetAttemptsStarted: true,
    });
    expect(queue.add).not.toHaveBeenCalled();
    expect(existing.updateProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "queued",
        taskId: "task-1",
      }),
    );
  });
});
