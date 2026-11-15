import { GenerationTaskStatus } from "@fashion/db";
import { ForbiddenException, HttpStatus } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectAccessPolicy } from "../studio/project-access.policy";
import { GenerationLimitExceededException } from "../billing/billing.errors";
import { BullGenerationJobs } from "./generation-queue.service";
import { GenerationService } from "./generation.service";

const request = {
  taskType: "t2i" as const,
  prompt: "fashion editorial",
  width: 1024,
  height: 1024,
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
    project: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null, workspace: { ownerId: "user-1" } }), findFirst: vi.fn().mockResolvedValue(null) },
    workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    workflowAttempt: { findMany: vi.fn() },
    workflowOutbox: { upsert: vi.fn() },
    designAsset: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    fileAsset: { findUnique: vi.fn() },
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
    database.$transaction.mockImplementation(
      async (operation: (transaction: typeof database) => Promise<unknown>) =>
        operation(database),
    );
    database.workflowAttempt.findMany.mockResolvedValue([]);
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
          transaction: {
            project: typeof database.project;
            workspaceMember: typeof database.workspaceMember;
            generationTask: typeof database.generationTask;
            $queryRaw: typeof database.$queryRaw;
          },
          quota: {
            allowed: boolean;
            limit: number;
            remaining: number;
            used: number;
          },
        ) => Promise<unknown>,
      ) =>
        operation(
          {
            project: database.project,
            workspaceMember: database.workspaceMember,
            generationTask: database.generationTask,
            $queryRaw: database.$queryRaw,
          },
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

  it("charges the project owner while separating two editors' identical request keys", async () => {
    const access = {
      require: vi
        .fn()
        .mockResolvedValue({ ownerId: "owner", capabilities: { edit: true } }),
    };
    const team = new GenerationService(
      database as never,
      jobs,
      billing as never,
      compiler as never,
      storage as never,
      access as unknown as ProjectAccessPolicy,
    );
    await team.createFromAgent(
      "editor-a",
      { ...request, projectId: "project-1" },
      "same-key",
      "请生成",
    );
    await team.createFromAgent(
      "editor-b",
      { ...request, projectId: "project-1" },
      "same-key",
      "请生成",
    );
    const records = database.generationTask.create.mock.calls.map(
      ([args]) => args.data,
    );
    expect(records.map((item) => item.userId)).toEqual(["owner", "owner"]);
    expect(records[0]?.id).not.toBe(records[1]?.id);
    expect(records.map((item) => item.compiledPrompt.executionActor)).toEqual([
      "editor-a",
      "editor-b",
    ]);
    expect(compiler.compile).toHaveBeenCalledWith("editor-a", "project-1", "请生成", undefined, { modelCalls: "skip" });
    expect(compiler.compile).toHaveBeenCalledWith("editor-b", "project-1", "请生成", undefined, { modelCalls: "skip" });
    expect(billing.canGenerate).toHaveBeenCalledWith("owner");
    expect(billing.withLockedGenerationQuota).toHaveBeenCalledWith(
      "owner",
      expect.any(Function),
    );
    expect(jobs.enqueue).toHaveBeenNthCalledWith(1, "task-1", "owner");
  });

  it("衣架入口冻结全部参考与搭配快照，使用既有额度队列但不调用提示词模型", async () => {
    database.designAsset.findMany.mockResolvedValue([
      { id: "model", projectId: "project-1", url: "s3://model.png" },
      { id: "garment", projectId: "project-1", url: "s3://garment.png" },
    ]);
    database.designAsset.findUnique.mockResolvedValue({ id: "model", projectId: "project-1", url: "s3://model.png" });
    storage.createDownloadUrl.mockImplementation(async (key: string) => `https://private.example/${key}?signature=temporary`);
    await service.createForWardrobe("user-1", { projectId: "project-1", sourceAssetIds: ["model", "garment"], prompt: "模特试穿，保留原始模特身份与姿势。某件原始素材说明：不要人物", snapshotId: "snapshot-1" }, "wardrobe-test");
    expect(compiler.compile).not.toHaveBeenCalled();
    expect(jobs.enqueue).toHaveBeenCalledWith("task-1", "user-1");
    expect(database.generationTask.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      input: expect.objectContaining({ referenceImageUrls: ["https://private.example/model.png?signature=temporary", "https://private.example/garment.png?signature=temporary"] }),
      compiledPrompt: expect.objectContaining({ presentationPolicy: expect.objectContaining({ mode: "on_model", matchedSignals: ["wardrobe-outfit-tryon"] }) }),
      designStep: { create: expect.objectContaining({ actor: "wardrobe", tool: "wardrobe-tryon", inputSnapshot: expect.objectContaining({ parameters: expect.objectContaining({ outfitSnapshotId: "snapshot-1" }), sources: expect.arrayContaining([expect.objectContaining({ assetId: "model" }), expect.objectContaining({ assetId: "garment" })]) }) }) },
    }) }));
  });

  it("衣架入口拒绝任何不属于当前项目的参考，且不会检查额度或调用队列", async () => {
    database.designAsset.findMany.mockResolvedValue([{ id: "model", projectId: "project-1", url: "s3://model.png" }]);
    await expect(service.createForWardrobe("user-1", { projectId: "project-1", sourceAssetIds: ["model", "foreign"], prompt: "模特试穿" }, "wardrobe-foreign")).rejects.toThrow("当前项目");
    expect(billing.canGenerate).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("衣架准备约束不再被通用商品提示的人台或衣架选项覆盖", async () => {
    database.designAsset.findMany.mockResolvedValue([{ id: "garment", projectId: "project-1", url: "s3://garment.png" }]);
    database.designAsset.findUnique.mockResolvedValue({ id: "garment", projectId: "project-1", url: "s3://garment.png" });
    storage.createDownloadUrl.mockResolvedValue("https://private.example/garment.png");
    await service.createForWardrobe("user-1", { projectId: "project-1", sourceAssetIds: ["garment"], prompt: "把设计稿转为自然悬挂的独立衣服候选，保持面料", transparent: true }, "wardrobe-cutout");
    const input = database.generationTask.create.mock.calls[0]?.[0]?.data.input as { prompt: string; background: string };
    expect(input.background).toBe("transparent");
    expect(input.prompt).toContain("genuine transparent alpha");
    expect(input.prompt).toContain("Display hardware is rendered separately");
    expect(input.prompt).not.toContain("ghost mannequin");
    expect(input.prompt).not.toContain("flat lay");
    expect(input.prompt).toContain("保持面料");
  });

  it("checks editor permission before an idempotency replay, quota check or compilation", async () => {
    const access = {
      require: vi.fn().mockRejectedValue(new ForbiddenException("revoked")),
    };
    const team = new GenerationService(
      database as never,
      jobs,
      billing as never,
      compiler as never,
      storage as never,
      access as unknown as ProjectAccessPolicy,
    );
    await expect(
      team.createFromAgent(
        "viewer",
        { ...request, projectId: "project-1" },
        "old-key",
        "请生成",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.generationTask.findUnique).not.toHaveBeenCalled();
    expect(billing.canGenerate).not.toHaveBeenCalled();
    expect(compiler.compile).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("拒绝编译期间已撤销编辑权限的生成请求，不落库或入队", async () => {
    const access = { require: vi.fn()
      .mockResolvedValueOnce({ ownerId: "owner" })
      .mockRejectedValue(new ForbiddenException("revoked during compilation")) };
    const team = new GenerationService(database as never, jobs, billing as never, compiler as never, storage as never, access as unknown as ProjectAccessPolicy);
    await expect(team.createFromAgent("editor", { ...request, projectId: "project-1" }, "new-key", "请生成")).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.generationTask.create).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("revalidates membership when reading a task and blocks read-only cancellation", async () => {
    const access = {
      require: vi.fn().mockRejectedValue(new ForbiddenException("revoked")),
    };
    const team = new GenerationService(
      database as never,
      jobs,
      billing as never,
      compiler as never,
      storage as never,
      access as unknown as ProjectAccessPolicy,
    );
    database.generationTask.findFirst.mockResolvedValue(
      taskRecord({ projectId: "project-1", userId: "owner" }),
    );
    await expect(team.get("former-editor", "task-1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(team.cancel("viewer", "task-1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(access.require).toHaveBeenCalledWith(
      "former-editor",
      "project-1",
      "read",
    );
    expect(access.require).toHaveBeenCalledWith("viewer", "project-1", "edit");
    expect(database.generationTask.updateMany).not.toHaveBeenCalled();
    expect(jobs.cancel).not.toHaveBeenCalled();
  });

  it("keeps tasks without a project private even when the shared-project policy is installed", async () => {
    const access = { require: vi.fn() };
    const team = new GenerationService(
      database as never,
      jobs,
      billing as never,
      compiler as never,
      storage as never,
      access as unknown as ProjectAccessPolicy,
    );
    database.generationTask.findFirst.mockResolvedValue(
      taskRecord({ projectId: null }),
    );
    await expect(team.get("other-user", "task-1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(team.cancel("other-user", "task-1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(access.require).not.toHaveBeenCalled();
    expect(jobs.cancel).not.toHaveBeenCalled();
  });

  it("writes workflow cancellation receipt before removing the queued job", async () => {
    database.generationTask.findFirst
      .mockResolvedValueOnce(taskRecord())
      .mockResolvedValueOnce(
        taskRecord({ status: GenerationTaskStatus.CANCELED }),
      );
    database.workflowAttempt.findMany.mockResolvedValue([
      { id: "attempt-1", projectId: "project-1", executionId: "execution-1" },
    ]);
    await service.cancel("user-1", "task-1");
    expect(database.$transaction).toHaveBeenCalledOnce();
    expect(database.workflowOutbox.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventKey: "generation:task-1:attempt-1:terminal" },
        create: expect.objectContaining({
          projectId: "project-1",
          eventType: "generation.terminal",
          executionId: "execution-1",
          payload: { status: "CANCELED", assetIds: [], errorCode: null },
        }),
      }),
    );
    expect(
      database.workflowOutbox.upsert.mock.invocationCallOrder[0],
    ).toBeLessThan(jobs.cancel.mock.invocationCallOrder[0] ?? 0);
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
          negativePrompt: "",
          prompt: request.prompt,
        }),
        compiledPrompt: expect.objectContaining({
          presentationPolicy: {
            matchedSignals: [],
            mode: "preserve_source",
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

  it("resumes an admitted queued task without compiling or creating a new task", async () => {
    database.generationTask.findUnique.mockResolvedValue({
      id: "task-1",
      userId: "user-1",
      status: GenerationTaskStatus.QUEUED,
    });
    await service.resumeQueuedTask("user-1", "task-1");
    expect(jobs.enqueue).toHaveBeenCalledWith("task-1", "user-1");
    expect(database.generationTask.create).not.toHaveBeenCalled();
    expect(compiler.compile).not.toHaveBeenCalled();
    expect(billing.withLockedGenerationQuota).not.toHaveBeenCalled();
    database.generationTask.findUnique.mockResolvedValue({
      id: "task-1",
      userId: "user-1",
      status: GenerationTaskStatus.SUCCEEDED,
    });
    await service.resumeQueuedTask("user-1", "task-1");
    expect(jobs.enqueue).toHaveBeenCalledOnce();
    await expect(
      service.resumeQueuedTask("other-user", "task-1"),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
  });

  it("uses the frozen Agent input even if the live board changes before replay", async () => {
    const frozen = {
      enhancement: "keywords" as const,
      mode: "board_guided" as const,
      version: 1 as const,
      positivePrompt: "frozen coat",
      negativePrompt: "watermark",
      palette: ["#112233"],
      notes: ["保留立领"],
      avoidLabels: [],
      paletteReferences: [],
      styleReferences: [],
      silhouetteReferences: [],
      fabricReferences: [],
      fabricInputs: [],
      patternReferences: [],
      detailReferences: [],
    };
    compiler.compile.mockRejectedValue(
      new Error("live board must not be read"),
    );
    const input = { ...request, projectId: "project-1", shapeIds: ["shape-1"] };
    await service.createFromAgent(
      "user-1",
      input,
      "frozen-key",
      "请生成",
      frozen,
    );
    const persisted =
      database.generationTask.create.mock.calls[0]?.[0].data.compiledPrompt;
    database.generationTask.findUnique.mockResolvedValue({
      id: "task-1",
      userId: "user-1",
      status: GenerationTaskStatus.QUEUED,
      compiledPrompt: persisted,
    });
    await service.createFromAgent(
      "user-1",
      input,
      "frozen-key",
      "请生成",
      frozen,
    );
    expect(compiler.compile).not.toHaveBeenCalled();
    expect(database.generationTask.create).toHaveBeenCalledOnce();
    expect(persisted).toMatchObject({
      positivePrompt: "frozen coat",
      palette: ["#112233"],
    });
    expect(jobs.enqueue).toHaveBeenCalledTimes(2);
  });

  it("Agent 已生成结构化提示词时要求编译器跳过重复模型调用", async () => {
    await service.createFromAgent(
      "user-1",
      { ...request, projectId: "project-1", shapeIds: ["shape-1"] },
      "agent-request-1",
      "请生成",
    );

    expect(compiler.compile).toHaveBeenCalledWith(
      "user-1",
      "project-1",
      "请生成",
      ["shape-1"],
      { modelCalls: "skip" },
    );
  });

  it("creates an immutable design step with an Agent task in the same transaction", async () => {
    const sources = [
      {
        elementId: "note-1",
        role: "note",
        title: "设计要求",
        text: "保留立领",
      },
    ];
    compiler.compile.mockResolvedValue({
      sources,
      palette: ["#112233"],
      notes: ["保留立领"],
      avoidLabels: [],
      fabricReferences: [],
      positivePrompt: "compiled coat",
      negativePrompt: "watermark",
      version: 1,
      mode: "board_guided",
      enhancement: "keywords",
    });
    await service.createFromAgent(
      "user-1",
      { ...request, projectId: "project-1" },
      "step-key",
      "修改袖口",
    );
    expect(database.generationTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          designStep: {
            create: expect.objectContaining({
              projectId: "project-1",
              actor: "agent",
              tool: "t2i",
              intent: "修改袖口",
              inputSnapshot: expect.objectContaining({
                version: 1,
                sources: sources.map((source) => ({ ...source, role: "reference" })),
                constraints: expect.objectContaining({
                  palette: ["#112233"],
                  notes: ["保留立领"],
                }),
              }),
            }),
          },
        }),
      }),
    );
  });

  it("普通生图只提交用户输入，不追加人物、展示方式、默认负向词或保留要求", async () => {
    await service.create("user-1", { ...request, negativePrompt: "blurry", prompt: "设计一件黑色廓形夹克" });
    const data = database.generationTask.create.mock.calls[0]?.[0].data;
    expect(data.input.prompt).toBe("设计一件黑色廓形夹克");
    expect(data.input.negativePrompt).toBe("blurry");
    expect(data.input.referencePolicy).toBe("instruction");
    expect(data.compiledPrompt.presentationPolicy).toEqual({ matchedSignals: [], mode: "preserve_source", version: 1 });
  });

  it("局部重绘不把色卡资料自动转成强制配色提示词", async () => {
    await service.create("user-1", { taskType: "inpaint", prompt: "将领口改成窄驳领", width: 768, height: 1024,
      referenceImageUrl: "https://signed.test/source.png", maskImageUrl: "https://signed.test/mask.png",
      palette: [{ hex: "#C8AB84", name: "OAT" }] });
    const data = database.generationTask.create.mock.calls[0]?.[0].data;
    expect(data.input.prompt).toBe("将领口改成窄驳领");
    expect(data.input.negativePrompt).toBe("");
    expect(data.input.palette).toEqual([{ hex: "#C8AB84", name: "OAT" }]);
  });

  it("多参考局部编辑固定父图首位，签名私有蒙版并记录全部来源", async () => {
    database.designAsset.findMany.mockResolvedValue([
      { id: "mask", projectId: "project-1", url: "s3://mask.png" },
      { id: "texture", projectId: "project-1", url: "s3://texture.png" },
      { id: "source", projectId: "project-1", url: "s3://source.png" },
    ]);
    database.designAsset.findUnique.mockResolvedValue({
      id: "source", projectId: "project-1", url: "s3://source.png",
    });
    storage.createDownloadUrl.mockImplementation(async (key: string) => `https://private.example/${key}`);
    await service.createFromAgent("user-1", {
      taskType: "inpaint", projectId: "project-1", parentAssetId: "source",
      referenceImageUrl: "s3://source.png",
      referenceImageUrls: ["s3://source.png", "s3://texture.png"],
      maskImageUrl: "s3://mask.png", prompt: "按细网参考仅修正袖部",
      width: 1024, height: 1536,
    }, "inpaint-references", "修正袖部");
    const data = database.generationTask.create.mock.calls[0]?.[0].data;
    expect(data.input).toMatchObject({
      referenceImageUrl: "https://private.example/source.png",
      referenceImageUrls: ["https://private.example/source.png", "https://private.example/texture.png"],
      maskImageUrl: "https://private.example/mask.png",
    });
    expect(data.compiledPrompt.inpaintSource).toEqual({ version: 1, sourceObjectKey: "source.png", maskObjectKey: "mask.png" });
    expect(data.designStep.create.inputSnapshot.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: "source", role: "edit_source" }),
      expect.objectContaining({ assetId: "texture", role: "detail_ref" }),
      expect.objectContaining({ assetId: "mask", title: "局部编辑蒙版" }),
    ]));
  });

  it("上传文件蒙版保存稳定私有键，过期签名不成为执行依赖", async () => {
    vi.stubEnv("S3_ENDPOINT", "https://private.example");
    vi.stubEnv("S3_BUCKET", "assets");
    database.designAsset.findUnique.mockResolvedValue({ projectId: "project-1", url: "s3://source.png" });
    database.designAsset.findFirst.mockResolvedValue(null);
    database.fileAsset.findUnique.mockResolvedValue({ id: "mask-file", ownerId: "user-1", status: "READY", mimeType: "image/png", objectKey: "files/蒙版.png" });
    storage.createDownloadUrl.mockImplementation(async (key: string) => `https://private.example/${key}`);
    try {
      await service.createFromAgent("user-1", { taskType: "inpaint", projectId: "project-1", parentAssetId: "source", referenceImageUrl: "s3://source.png", maskImageUrl: "https://private.example/assets/files/%E8%92%99%E7%89%88.png?X-Amz-Expires=1", width: 1024, height: 1024, prompt: "只改袖口" }, "file-mask", "只改袖口");
      const data = database.generationTask.create.mock.calls[0]?.[0].data;
      expect(data.compiledPrompt.inpaintSource).toEqual({ version: 1, sourceObjectKey: "source.png", maskObjectKey: "files/蒙版.png" });
      expect(data.input.maskImageUrl).toBe("https://private.example/files/蒙版.png");
    } finally { vi.unstubAllEnvs(); }
  });

  it.each(["missing", "processing", "foreign"])("拒绝不可用的私有蒙版：%s", async kind => {
    database.designAsset.findUnique.mockResolvedValue({ projectId: "project-1", url: "s3://source.png" });
    database.designAsset.findFirst.mockResolvedValue(null);
    database.fileAsset.findUnique.mockResolvedValue(kind === "missing" ? null : { id: "mask-file", ownerId: kind === "foreign" ? "another-user" : "user-1", status: kind === "processing" ? "PROCESSING" : "READY", mimeType: "image/png" });
    database.project.findFirst.mockResolvedValue(null);
    await expect(service.createFromAgent("user-1", { taskType: "inpaint", projectId: "project-1", parentAssetId: "source", referenceImageUrl: "s3://source.png", maskImageUrl: "s3://private-mask.png", width: 1024, height: 1024, prompt: "只改袖口" }, `invalid-${kind}`, "只改袖口")).rejects.toThrow();
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(database.generationTask.create).not.toHaveBeenCalled();
  });

  it.each(["foreign-reference", "foreign-mask", "wrong-first", "external-url", "missing-project"])(
    "多参考局部编辑在任务重放和计费前拒绝不合法输入：%s", async (kind) => {
      database.designAsset.findMany.mockResolvedValue([
        { id: "source", projectId: "project-1", url: "s3://source.png" },
        ...(kind === "foreign-reference" ? [] : [{ id: "texture", projectId: "project-1", url: "s3://texture.png" }]),
        ...(kind === "foreign-mask" ? [] : [{ id: "mask", projectId: "project-1", url: "s3://mask.png" }]),
      ]);
      database.generationTask.findUnique.mockResolvedValue(taskRecord());
      await expect(service.createFromAgent("user-1", {
        taskType: "inpaint",
        ...(kind === "missing-project" ? {} : { projectId: "project-1" }),
        parentAssetId: "source", referenceImageUrl: "s3://source.png",
        referenceImageUrls: kind === "wrong-first"
          ? ["s3://texture.png", "s3://source.png"]
          : ["s3://source.png", kind === "external-url" ? "https://outside.example/texture.png" : "s3://texture.png"],
        maskImageUrl: "s3://mask.png", prompt: "修正袖部", width: 1024, height: 1536,
      }, "inpaint-invalid", "修正袖部")).rejects.toThrow();
      expect(database.designAsset.findMany).toHaveBeenCalledTimes(kind === "external-url" || kind === "missing-project" ? 0 : 1);
      if (kind !== "external-url" && kind !== "missing-project") expect(database.designAsset.findMany).toHaveBeenCalledWith({
        where: { projectId: "project-1", archivedAt: null, url: { in: expect.any(Array) } },
      });
      expect(database.generationTask.findUnique).not.toHaveBeenCalled();
      expect(billing.canGenerate).not.toHaveBeenCalled();
      expect(jobs.enqueue).not.toHaveBeenCalled();
    },
  );

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
    expect(createData.input.prompt).toBe("让模特试穿这件黑色夹克");
    expect(createData.input.negativePrompt).toBe("");
    expect(createData.compiledPrompt.presentationPolicy).toEqual({
      matchedSignals: [],
      mode: "preserve_source",
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
      { ...request, prompt: "生成一件短款通勤夹克", shapeIds: ["selected-note"] },
      "note-model-intent",
      "根据画布备注生成",
    );

    const createData =
      database.generationTask.create.mock.calls.at(0)?.[0].data;
    expect(createData.input.prompt).toContain("短发亚裔女模特");
    expect(createData.input.prompt).not.toContain("without any human wearer");
    expect(createData.input.negativePrompt).not.toContain("fashion model");
    expect(createData.compiledPrompt.presentationPolicy).toEqual({
      matchedSignals: [],
      mode: "preserve_source",
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
    expect(createData.input.prompt).toBe("不要模特试穿，只展示服装单品");
    expect(createData.compiledPrompt.presentationPolicy).toEqual({
      matchedSignals: [],
      mode: "preserve_source",
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
    expect(createData.input.prompt).toBe("设计一条红色连衣裙");
    expect(createData.compiledPrompt.presentationPolicy.mode).toBe("preserve_source");
  });

  it("在生成任务同一事务中记录面料身份，不保存默认用途或权重", async () => {
    compiler.compile.mockResolvedValue({
      enhancement: "keywords",
      sources: [{ elementId: "board-element-1", fabricId: "fabric-1", role: "reference", title: "面料", tags: ["cotton blend", "plain"] }],
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
                role: null,
                tagsSnapshot: ["cotton blend", "plain"],
                weight: null,
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

  it("按显式素材顺序传递参考，不再从旧用途通道或权重选图", async () => {
    compiler.compile.mockResolvedValueOnce({
      version: 1, enhancement: "keywords", mode: "board_guided", positivePrompt: "保持图1版型，使用图2纹理", negativePrompt: "",
      orderedReferences: [
        { elementId: "a", imageUrl: "https://signed.test/a.png", order: 0, labels: [] },
        { elementId: "b", imageUrl: "https://signed.test/b.png", order: 1, labels: [] },
      ],
      styleReferences: [{ elementId: "ignored", imageUrl: "https://signed.test/ignored.png", labels: [] }],
    });
    await service.create("user-1", { ...request, projectId: "project-1", shapeIds: ["a", "b"] });
    const data = database.generationTask.create.mock.calls[0]?.[0].data;
    expect(data.input.referencePolicy).toBe("instruction");
    expect(data.input.referenceImages).toEqual([
      { order: 0, url: "https://signed.test/a.png" }, { order: 1, url: "https://signed.test/b.png" },
    ]);
    expect(data.compiledPrompt.styleReferences).toEqual([]);
    expect(JSON.stringify(data.input)).not.toContain("ignored.png");
    expect(JSON.stringify(data.input)).not.toContain("weight");
  });

  it("只有旧用途通道时不补写新的参考，避免历史标签影响本次生成", async () => {
    compiler.compile.mockResolvedValueOnce({ version: 1, enhancement: "keywords", mode: "text_only", positivePrompt: "新要求", negativePrompt: "",
      styleReferences: [{ imageUrl: "https://signed.test/old.png", weight: 0.7, role: "style_ref", labels: [] }] });
    await service.create("user-1", request);
    const data = database.generationTask.create.mock.calls[0]?.[0].data;
    expect(data.input.referenceImages).toBeUndefined();
    expect(data.input.referenceImageUrl).toBeUndefined();
    expect(data.input.prompt).toBe(request.prompt);
  });

  it("显式参考不被画布编译出的参考列表覆盖", async () => {
    compiler.compile.mockResolvedValueOnce({ enhancement: "keywords", mode: "board_guided", positivePrompt: "new design", negativePrompt: "",
      version: 1, styleReferences: [{ imageUrl: "https://signed.test/implicit.png", labels: [] }] });
    const explicit = [{ order: 0, url: "https://signed.test/explicit.png", role: "detail_ref" as const, weight: 0.4 }];
    await service.create("user-1", { ...request, referenceImages: explicit });
    expect(database.generationTask.create.mock.calls[0]?.[0].data.input.referenceImages).toEqual(explicit.map(({ order, url }) => ({ order, url })));
  });

  it("编译参考超过16张时明确拒绝，不截掉后面的参考继续入队", async () => {
    compiler.compile.mockResolvedValueOnce({ enhancement: "keywords", mode: "board_guided", positivePrompt: "new design", negativePrompt: "", version: 1,
      orderedReferences: Array.from({ length: 17 }, (_, i) => ({ elementId: `ref-${i}`, order: i, imageUrl: `https://signed.test/ref-${i}.png`, labels: [] })) });
    await expect(service.create("user-1", request)).rejects.toThrow("最多16张");
    expect(database.generationTask.create).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it.each([{ urls: [] }, { urls: ["https://signed.test/explicit.png"] }])("显式旧列表$urls保留用户选择，不注入画布参考", async ({ urls }) => {
    compiler.compile.mockResolvedValueOnce({ enhancement: "keywords", mode: "board_guided", positivePrompt: "new design", negativePrompt: "", version: 1,
      styleReferences: [{ imageUrl: "https://signed.test/implicit.png", labels: [] }] });
    await service.create("user-1", { ...request, referenceImageUrls: urls });
    const input = database.generationTask.create.mock.calls[0]?.[0].data.input;
    expect(input.referenceImageUrls).toEqual(urls);
    expect(input.referenceImages).toBeUndefined();
  });

  it("刷新母图签名时同步更新完整参考列表中的别名，不重复占用名额", async () => {
    const source = "https://private.example/source.png?signature=expired";
    database.designAsset.findUnique.mockResolvedValue({ id: "asset-parent", projectId: "project-1", url: "s3://source.png" });
    storage.createDownloadUrl.mockResolvedValue("https://private.example/source.png?signature=fresh");
    await service.create("user-1", { ...request, taskType: "i2i", projectId: "project-1", parentAssetId: "asset-parent", referenceImageUrl: source,
      referenceImageUrls: [source, "https://private.example/detail.png"],
      referenceImages: [{ order: 0, url: source, role: "silhouette_ref", weight: 0.9 }, { order: 1, url: "https://private.example/detail.png", role: "detail_ref", weight: 0.5 }],
    });
    const input = database.generationTask.create.mock.calls[0]?.[0].data.input;
    expect(input.referenceImageUrl).toBe("https://private.example/source.png?signature=fresh");
    expect(input.referenceImageUrls[0]).toBe(input.referenceImageUrl);
    expect(input.referenceImages[0]).toEqual({ order: 0, url: input.referenceImageUrl });
  });

  it.each(["edit", "feedback"])("%s超过含原图与标记图的总量时在编译和入队前拒绝", async (intent) => {
    await expect(service.create("user-1", { ...request, taskType: "i2i", referenceImageUrl: "https://signed.test/source.png",
      ...(intent === "feedback" ? { imageEdit: { intent: "feedback" as const } } : {}),
      referenceImageUrls: Array.from({ length: intent === "feedback" ? 15 : 16 }, (_, index) => `https://signed.test/ref-${index}.png`),
    })).rejects.toThrow("最多16张");
    expect(compiler.compile).not.toHaveBeenCalled();
    expect(database.generationTask.create).not.toHaveBeenCalled();
    expect(billing.withLockedGenerationQuota).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("局部重绘多次刷新原图签名时同步结构化用途，不额外上传旧原图", async () => {
    const source = "https://private.example/source.png?signature=old";
    database.designAsset.findUnique.mockResolvedValue({ id: "asset-parent", projectId: "project-1", url: "s3://source.png" });
    let version = 0;
    storage.createDownloadUrl.mockImplementation(async (key: string) => `https://private.example/${key}?signature=${++version}`);
    await service.create("user-1", { ...request, taskType: "inpaint", projectId: "project-1", parentAssetId: "asset-parent", referenceImageUrl: source,
      maskImageUrl: "https://cdn.test/mask.png", referenceImages: [{ order: 0, url: source, role: "silhouette_ref", weight: 0.9 }, { order: 1, url: "https://private.example/detail.png", role: "detail_ref", weight: 0.5 }],
    });
    const input = database.generationTask.create.mock.calls[0]?.[0].data.input;
    expect(input.referenceImages[0].url).toBe(input.referenceImageUrl);
    expect(input.referenceImageUrl).not.toBe(source);
    expect(input.referenceImages[1]).toEqual({ order: 1, url: "https://private.example/detail.png" });
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
    expect(input?.prompt).not.toContain("normalized fashion collection prompt");
    expect(input?.prompt).not.toContain("系列变化硬约束（必须逐条执行）");
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

  it("恢复老任务 request 时剔除 GPT Image 2 不支持的旧参数", async () => {
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
        height: 1024,
        negativePrompt: "watermark",
        parentAssetId: "asset-parent",
        projectId: "project-1",
        prompt: "legacy compiled prompt",
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
