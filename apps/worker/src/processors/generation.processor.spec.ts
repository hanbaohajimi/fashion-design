import {
  AiProviderError,
  type AiProviderJob,
  type AiProviderResult,
} from "@fashion/ai";
import { BillingService } from "@fashion/billing";
import {
  CollectionVariationAxis,
  DesignAssetOperation,
  GenerationTaskStatus,
  prisma,
  type GenerationTask,
} from "@fashion/db";
import type { GenerationJobData } from "@fashion/shared";
import type { Job } from "bullmq";
import { afterAll, describe, expect, it, vi } from "vitest";

import { createGenerationProcessor } from "./generation.processor";

const request = {
  taskType: "t2i" as const,
  prompt: "fashion editorial",
  width: 512,
  height: 512,
  steps: 20,
  cfg: 3.5,
};

const providerJob: AiProviderJob = {
  provider: "mock",
  providerJobId: "remote-job-1",
  model: "mock/image-generator",
  taskType: "t2i",
  submittedAt: "2026-01-01T00:00:00.000Z",
  cost: {
    rawCost: 0.04,
    credits: 4,
    currency: "USD",
    billableMegapixels: 1,
    estimated: true,
  },
};

const providerResult: AiProviderResult = {
  job: providerJob,
  images: [{ url: "https://cdn.test/generated.png" }],
  seed: 42,
  cost: providerJob.cost,
};

describe("Generation processor", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("正常路径从 queued 流转到 succeeded 并且只计次一次", async () => {
    const fixture = await createTask();
    const ai = successfulAi();
    const job = fakeJob(fixture.task);
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
    });

    try {
      await process(job);
      await process(fakeJob(fixture.task));

      const [task, user, assets] = await Promise.all([
        prisma.generationTask.findUniqueOrThrow({
          where: { id: fixture.task.id },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } }),
        prisma.designAsset.findMany({
          where: { generationTaskId: fixture.task.id },
        }),
      ]);
      expect(task.status).toBe(GenerationTaskStatus.SUCCEEDED);
      expect(task.output).toMatchObject({
        images: [
          {
            assetId: expect.any(String),
            url: "https://cdn.test/generated.png",
          },
        ],
      });
      expect(assets).toHaveLength(1);
      expect(assets[0]).toMatchObject({
        operation: DesignAssetOperation.GENERATED,
        parentAssetId: null,
        rootAssetId: assets[0]?.id,
      });
      expect(task.countedAt).not.toBeNull();
      expect(user.generationCount).toBe(1);
      expect(job.updateProgress.mock.calls.map(([value]) => value)).toEqual([
        expect.objectContaining({ status: "running" }),
        expect.objectContaining({ status: "succeeded" }),
      ]);
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("审核不通过时 task=moderation_failed、不给用户计次且不落设计资产", async () => {
    const fixture = await createTask();
    const moderator = {
      moderate: vi.fn().mockResolvedValue({
        categories: ["sexual"],
        status: "rejected" as const,
      }),
    };
    const job = fakeJob(fixture.task);
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: prisma,
      moderator,
      pollIntervalMs: 1,
    });

    try {
      await expect(process(job)).resolves.toMatchObject({
        status: "moderation_failed",
      });
      const [task, user, assets] = await Promise.all([
        prisma.generationTask.findUniqueOrThrow({
          where: { id: fixture.task.id },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } }),
        prisma.designAsset.findMany({
          where: { generationTaskId: fixture.task.id },
        }),
      ]);
      expect(task).toMatchObject({
        countedAt: null,
        errorCode: "CONTENT_MODERATION_FAILED",
        errorMessage: "该内容不符合平台规范",
        manualReviewRequired: false,
        moderationCategories: ["sexual"],
        status: GenerationTaskStatus.MODERATION_FAILED,
      });
      expect(task.output).toBeNull();
      expect(user.generationCount).toBe(0);
      expect(assets).toHaveLength(0);
      expect(job.updateProgress).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "moderation_failed" }),
      );
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("审核服务异常时成功落图并标记人工复查", async () => {
    const fixture = await createTask();
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: prisma,
      moderator: {
        moderate: vi.fn().mockRejectedValue(new Error("moderation timeout")),
      },
      pollIntervalMs: 1,
    });

    try {
      await process(fakeJob(fixture.task));
      const task = await prisma.generationTask.findUniqueOrThrow({
        where: { id: fixture.task.id },
      });
      expect(task.status).toBe(GenerationTaskStatus.SUCCEEDED);
      expect(task.manualReviewRequired).toBe(true);
      expect(task.moderationStatus).toBe("REVIEW_REQUIRED");
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("i2i 成功后新资产继承父资产与根血缘", async () => {
    const fixture = await createTask(GenerationTaskStatus.QUEUED, true);
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
    });

    try {
      await process(fakeJob(fixture.task));
      const child = await prisma.designAsset.findFirstOrThrow({
        where: { generationTaskId: fixture.task.id },
      });
      expect(child).toMatchObject({
        operation: DesignAssetOperation.VARIATION,
        parentAssetId: fixture.parentAssetId,
        rootAssetId: fixture.parentAssetId,
      });
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("系列生成成功后创建唯一 CollectionLook 并投递参考相似度任务", async () => {
    const fixture = await createTask(GenerationTaskStatus.QUEUED, true);
    if (!fixture.parentAssetId) throw new Error("测试 Hero 资产创建失败");
    const parent = await prisma.designAsset.findUniqueOrThrow({
      where: { id: fixture.parentAssetId },
    });
    const collection = await prisma.collection.create({
      data: {
        dna: {
          create: {
            fabrics: [],
            moodWords: [],
            palette: [],
            referenceFileIds: [],
            silhouettes: [],
          },
        },
        heroAssetId: parent.id,
        looks: {
          create: {
            designAssetId: parent.id,
            isHero: true,
            ordinal: 1,
          },
        },
        name: "Worker collection",
        projectId: parent.projectId,
      },
    });
    await prisma.generationTask.update({
      where: { id: fixture.task.id },
      data: {
        collectionId: collection.id,
        variationAxis: CollectionVariationAxis.DETAIL,
      },
    });
    const similarityJobs = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
      similarityJobs,
    });

    try {
      await process(fakeJob(fixture.task));
      const looks = await prisma.collectionLook.findMany({
        where: { collectionId: collection.id },
        orderBy: { ordinal: "asc" },
      });
      expect(looks).toHaveLength(2);
      expect(looks[1]).toMatchObject({
        isHero: false,
        ordinal: 2,
        variationAxis: CollectionVariationAxis.DETAIL,
      });
      expect(similarityJobs.enqueue).toHaveBeenCalledWith(
        collection.id,
        looks[1]?.designAssetId,
      );
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("worker 取到 canceled task 时直接 ack 且不调用 AI", async () => {
    const fixture = await createTask(GenerationTaskStatus.CANCELED);
    const ai = successfulAi();
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
    });

    try {
      await expect(process(fakeJob(fixture.task))).resolves.toEqual({
        skipped: true,
        status: "canceled",
        taskId: fixture.task.id,
      });
      expect(ai.submit).not.toHaveBeenCalled();
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: fixture.userId },
      });
      expect(user.generationCount).toBe(0);
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("生成结果返回前被取消时不落成功结果也不计次", async () => {
    const fixture = await createTask();
    const ai = successfulAi();
    ai.getResult.mockImplementation(async () => {
      await prisma.generationTask.update({
        where: { id: fixture.task.id },
        data: {
          canceledAt: new Date(),
          completedAt: new Date(),
          status: GenerationTaskStatus.CANCELED,
        },
      });
      return providerResult;
    });
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
    });

    try {
      await expect(process(fakeJob(fixture.task))).resolves.toMatchObject({
        skipped: true,
        status: "canceled",
      });
      const [task, user] = await Promise.all([
        prisma.generationTask.findUniqueOrThrow({
          where: { id: fixture.task.id },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } }),
      ]);
      expect(task.status).toBe(GenerationTaskStatus.CANCELED);
      expect(task.output).toBeNull();
      expect(user.generationCount).toBe(0);
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("最终失败时 task=failed 且 generation_count 不增加", async () => {
    const fixture = await createTask();
    const ai = successfulAi();
    ai.getResult.mockRejectedValue(
      new AiProviderError({
        code: "PROVIDER_UNAVAILABLE",
        provider: "mock",
        message: "Provider unavailable",
        retryable: true,
      }),
    );
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
    });

    try {
      await expect(process(fakeJob(fixture.task, 1))).rejects.toBeInstanceOf(
        AiProviderError,
      );
      const [task, user] = await Promise.all([
        prisma.generationTask.findUniqueOrThrow({
          where: { id: fixture.task.id },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } }),
      ]);
      expect(task.status).toBe(GenerationTaskStatus.FAILED);
      expect(user.generationCount).toBe(0);
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("重试复用已入库 provider job，最终成功只计次一次", async () => {
    const fixture = await createTask();
    const ai = successfulAi();
    ai.getResult
      .mockRejectedValueOnce(
        new AiProviderError({
          code: "PROVIDER_UNAVAILABLE",
          provider: "mock",
          message: "temporary failure",
          retryable: true,
        }),
      )
      .mockResolvedValueOnce(providerResult);
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
    });

    try {
      await expect(process(fakeJob(fixture.task, 0))).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
      });
      await process(fakeJob(fixture.task, 1));

      const [task, user] = await Promise.all([
        prisma.generationTask.findUniqueOrThrow({
          where: { id: fixture.task.id },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } }),
      ]);
      expect(task.status).toBe(GenerationTaskStatus.SUCCEEDED);
      expect(task.attemptCount).toBe(2);
      expect(user.generationCount).toBe(1);
      expect(ai.submit).toHaveBeenCalledOnce();
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("120 秒策略超时后自动标记 failed 且不计次", async () => {
    const fixture = await createTask();
    const ai = successfulAi();
    ai.submit.mockImplementation(
      async (_input: unknown, signal?: AbortSignal) =>
        new Promise<AiProviderJob>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      timeoutMs: 10,
    });

    try {
      await expect(process(fakeJob(fixture.task))).rejects.toThrow(
        "生成任务超过 120 秒",
      );
      const [task, user] = await Promise.all([
        prisma.generationTask.findUniqueOrThrow({
          where: { id: fixture.task.id },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } }),
      ]);
      expect(task.status).toBe(GenerationTaskStatus.FAILED);
      expect(task.errorCode).toBe("GENERATION_TIMEOUT");
      expect(user.generationCount).toBe(0);
    } finally {
      await cleanup(fixture.userId);
    }
  });
});

function successfulAi() {
  return {
    submit: vi.fn().mockResolvedValue(providerJob),
    getStatus: vi.fn().mockResolvedValue({ status: "completed" }),
    getResult: vi.fn().mockResolvedValue(providerResult),
  };
}

function approvedModerator() {
  return {
    moderate: vi.fn().mockResolvedValue({
      categories: [],
      status: "approved" as const,
    }),
  };
}

function fakeJob(
  task: GenerationTask,
  attemptsMade = 0,
): Job<GenerationJobData> & {
  updateProgress: ReturnType<typeof vi.fn>;
} {
  return {
    attemptsMade,
    data: { taskId: task.id, userId: task.userId },
    id: task.id,
    opts: { attempts: 2 },
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as never;
}

async function createTask(
  status: GenerationTaskStatus = GenerationTaskStatus.QUEUED,
  withParent = false,
): Promise<{
  task: GenerationTask;
  userId: string;
  parentAssetId: string | null;
}> {
  const user = await prisma.user.create({
    data: {
      email: `generation-worker-${crypto.randomUUID()}@example.com`,
      generationLimit: 100,
      ownedWorkspaces: {
        create: {
          name: "Generation worker workspace",
          projects: { create: { name: "Generation worker project" } },
        },
      },
    },
    include: {
      ownedWorkspaces: { include: { projects: true } },
    },
  });
  const projectId = user.ownedWorkspaces[0]?.projects[0]?.id;
  if (!projectId) throw new Error("测试项目创建失败");
  const parentAssetId = withParent ? crypto.randomUUID() : null;
  if (parentAssetId) {
    await prisma.designAsset.create({
      data: {
        id: parentAssetId,
        operation: DesignAssetOperation.GENERATED,
        projectId,
        rootAssetId: parentAssetId,
        url: "https://cdn.test/parent.png",
      },
    });
  }
  const taskInput = withParent
    ? {
        ...request,
        referenceImageUrl: "https://cdn.test/parent.png",
        strength: 0.5,
        taskType: "i2i" as const,
      }
    : request;
  const task = await prisma.generationTask.create({
    data: {
      input: taskInput,
      parentAssetId,
      projectId,
      status,
      taskType: taskInput.taskType,
      userId: user.id,
      ...(status === GenerationTaskStatus.CANCELED
        ? { canceledAt: new Date(), completedAt: new Date() }
        : {}),
    },
  });
  return { parentAssetId, task, userId: user.id };
}

async function cleanup(userId: string): Promise<void> {
  await prisma.user.delete({ where: { id: userId } });
}
