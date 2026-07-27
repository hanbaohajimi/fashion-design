import { GenerationTaskStatus } from "@fashion/db";
import { HttpStatus } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GenerationLimitExceededException } from "../billing/billing.errors";
import { GenerationService } from "./generation.service";

const request = {
  taskType: "t2i" as const,
  prompt: "fashion editorial",
  width: 1024,
  height: 1024,
  steps: 28,
  cfg: 3.5,
};

function taskRecord(
  overrides: Record<string, unknown> = {},
) {
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
    generationTask: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  };
  const jobs = {
    cancel: vi.fn(),
    enqueue: vi.fn(),
  };
  const billing = {
    canGenerate: vi.fn(),
  };
  const compiler = {
    compile: vi.fn(),
  };
  const service = new GenerationService(
    database as never,
    jobs,
    billing as never,
    compiler as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    billing.canGenerate.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 100,
      used: 0,
    });
    database.generationTask.create.mockResolvedValue({ id: "task-1" });
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
        input: {
          ...request,
          negativePrompt: "watermark",
        },
        compiledPrompt: expect.objectContaining({
          positivePrompt: "fashion editorial",
        }),
        status: GenerationTaskStatus.QUEUED,
        taskType: "t2i",
        userId: "user-1",
      },
      select: { id: true },
    });
    expect(jobs.enqueue).toHaveBeenCalledWith("task-1", "user-1");
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
    expect(createData.compiledPrompt).toMatchObject({
      positivePrompt: "fashion editorial",
    });
  });

  it("入队失败时把 task 标为 failed", async () => {
    jobs.enqueue.mockRejectedValue(new Error("redis unavailable"));
    database.generationTask.update.mockResolvedValue(
      taskRecord({ status: GenerationTaskStatus.FAILED }),
    );

    await expect(service.create("user-1", request)).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
    expect(database.generationTask.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: expect.objectContaining({
        errorCode: "QUEUE_UNAVAILABLE",
        status: GenerationTaskStatus.FAILED,
      }),
    });
  });

  it("取消 queued task 后更新数据库并移除队列任务", async () => {
    database.generationTask.findFirst.mockResolvedValue(taskRecord());
    database.generationTask.update.mockResolvedValue(
      taskRecord({
        canceledAt: new Date(),
        completedAt: new Date(),
        status: GenerationTaskStatus.CANCELED,
      }),
    );

    const result = await service.cancel("user-1", "task-1");

    expect(result.status).toBe("canceled");
    expect(jobs.cancel).toHaveBeenCalledWith("task-1");
  });

  it("Redis 暂时不可用时仍以数据库 canceled 状态为准", async () => {
    database.generationTask.findFirst.mockResolvedValue(taskRecord());
    database.generationTask.update.mockResolvedValue(
      taskRecord({ status: GenerationTaskStatus.CANCELED }),
    );
    jobs.cancel.mockRejectedValue(new Error("redis unavailable"));

    await expect(service.cancel("user-1", "task-1")).resolves.toMatchObject({
      status: "canceled",
    });
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
    });
  });
});
