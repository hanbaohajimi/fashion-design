import { GenerationTaskStatus, SimilarityAnalysisStatus } from "@fashion/db";
import type { GenerationJobData } from "@fashion/shared";
import type { Job } from "bullmq";
import { describe, expect, it, vi } from "vitest";

import { createGenerationProcessor } from "./generation.processor";

function createHarness(imageCount = 1) {
  const providerJob = {
    provider: "mock",
    providerJobId: "remote-a",
    model: "mock/image-generator",
    taskType: "t2i" as const,
    submittedAt: "2026-01-01T00:00:00.000Z",
    cost: {
      rawCost: 0.04,
      credits: 4,
      currency: "USD" as const,
      billableMegapixels: 1,
      estimated: true as const,
    },
  };
  const task = {
    id: "task-a",
    userId: "user-a",
    projectId: "project-a",
    collectionId: "collection-a",
    parentAssetId: null,
    attemptCount: 0,
    status: GenerationTaskStatus.QUEUED as GenerationTaskStatus,
    updatedAt: new Date(),
    startedAt: null,
    providerJob,
    input: {
      height: 512,
      width: 512,
      prompt: "fashion editorial",
      taskType: "t2i",
    },
    taskType: "t2i",
    variationAxis: null,
    garmentTypeCode: null,
    garmentTypeLabel: null,
    slotKey: null,
  };
  const assets: Array<{ id: string }> = [];
  const looks = [
    {
      designAssetId: "ready-asset",
      generationTaskId: "older-task",
      analysisStatus: SimilarityAnalysisStatus.READY,
    },
    {
      designAssetId: "pending-asset",
      generationTaskId: "older-task",
      analysisStatus: SimilarityAnalysisStatus.PENDING,
    },
    {
      designAssetId: "running-asset",
      generationTaskId: task.id,
      analysisStatus: SimilarityAnalysisStatus.RUNNING,
    },
  ];
  const database = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([]),
    generationTask: {
      findUnique: vi.fn(async () => ({ ...task })),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn(async ({ where, data }) => {
        if (
          where.status !== task.status ||
          where.attemptCount !== task.attemptCount
        ) {
          return { count: 0 };
        }
        if (data.status) task.status = data.status;
        if (data.attemptCount) task.attemptCount += data.attemptCount.increment;
        return { count: 1 };
      }),
    },
    designAsset: {
      create: vi.fn(async ({ data }) => {
        assets.push({ id: data.id });
      }),
      findMany: vi.fn(async () => [...assets]),
    },
    collectionLook: {
      aggregate: vi.fn().mockResolvedValue({ _max: { ordinal: 1 } }),
      create: vi.fn(async ({ data }) => {
        looks.push({
          designAssetId: data.designAssetId,
          generationTaskId: task.id,
          analysisStatus: data.analysisStatus,
        });
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        for (const look of looks) {
          if (
            (!where.analysisStatus ||
              look.analysisStatus === where.analysisStatus) &&
            (!where.designAsset ||
              look.generationTaskId === where.designAsset.generationTaskId) &&
            (!where.designAssetId ||
              where.designAssetId.in.includes(look.designAssetId))
          ) {
            look.analysisStatus = data.analysisStatus;
          }
        }
        return { count: 1 };
      }),
    },
    workflowAttempt: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "attempt-a",
          projectId: task.projectId,
          executionId: "execution-a",
        },
      ]),
    },
    workflowOutbox: { upsert: vi.fn().mockResolvedValue({}) },
  };
  database.$transaction.mockImplementation(
    async (operation: (transaction: typeof database) => Promise<unknown>) =>
      operation(database),
  );
  const billing = { incrementCount: vi.fn().mockResolvedValue({}) };
  const similarityJobs = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const visualSummaryJobs = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const job = {
    attemptsMade: 0,
    data: { taskId: task.id, userId: task.userId },
    opts: { attempts: 2 },
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<GenerationJobData>;
  const ai = {
    getResult: vi.fn().mockResolvedValue({
      cost: providerJob.cost,
      images: Array.from({ length: imageCount }, (_, index) => ({
        url: `https://cdn.test/generated-${index}.png`,
      })),
      job: providerJob,
    }),
    getStatus: vi.fn().mockResolvedValue({ status: "completed" }),
    submit: vi.fn(),
  };
  const process = createGenerationProcessor({
    database: database as never,
    ai,
    billing,
    moderator: {
      moderate: vi
        .fn()
        .mockResolvedValue({ status: "approved", categories: [] }),
    },
    similarityJobs,
    visualSummaryJobs,
  });
  return {
    assets,
    ai,
    billing,
    database,
    job,
    looks,
    process,
    similarityJobs,
    task,
    visualSummaryJobs,
  };
}

describe("generation postprocessing", () => {
  it.each(["资产查询", "队列投递", "失败状态回写"])(
    "%s 失败不改变已经提交的生成成功结果，重复投递不重复计费",
    async (failure) => {
      const h = createHarness();
      if (failure === "资产查询") {
        h.database.designAsset.findMany.mockRejectedValueOnce(
          new Error("数据库暂时不可用"),
        );
      } else {
        h.similarityJobs.enqueue.mockRejectedValueOnce(
          new Error("队列暂时不可用"),
        );
        if (failure === "失败状态回写") {
          h.database.collectionLook.updateMany.mockRejectedValueOnce(
            new Error("数据库暂时不可用"),
          );
        }
      }

      await expect(h.process(h.job)).resolves.toEqual({
        status: "succeeded",
        taskId: h.task.id,
      });

      expect(h.task.status).toBe(GenerationTaskStatus.SUCCEEDED);
      expect(h.assets).toHaveLength(1);
      expect(h.billing.incrementCount).toHaveBeenCalledOnce();
      expect(h.visualSummaryJobs.enqueue).toHaveBeenCalledWith({
        kind: "asset",
        id: h.assets[0]?.id,
      });
      expect(h.job.updateProgress).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "succeeded" }),
      );
      expect(h.database.workflowOutbox.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            payload: expect.objectContaining({ status: "SUCCEEDED" }),
          }),
        }),
      );

      await expect(h.process(h.job)).resolves.toEqual({
        skipped: true,
        status: "succeeded",
        taskId: h.task.id,
      });
      expect(h.billing.incrementCount).toHaveBeenCalledOnce();
      expect(h.ai.getResult).toHaveBeenCalledOnce();
      expect(h.assets).toHaveLength(1);
    },
  );

  it("投递失败只标记本次尚未开始分析的 Look，保留已就绪和运行中的结果", async () => {
    const h = createHarness();
    h.similarityJobs.enqueue.mockRejectedValueOnce(new Error("队列暂时不可用"));

    await h.process(h.job);

    expect(h.looks).toEqual([
      {
        designAssetId: "ready-asset",
        generationTaskId: "older-task",
        analysisStatus: SimilarityAnalysisStatus.READY,
      },
      {
        designAssetId: "pending-asset",
        generationTaskId: "older-task",
        analysisStatus: SimilarityAnalysisStatus.PENDING,
      },
      {
        designAssetId: "running-asset",
        generationTaskId: h.task.id,
        analysisStatus: SimilarityAnalysisStatus.RUNNING,
      },
      {
        designAssetId: h.assets[0]?.id,
        generationTaskId: h.task.id,
        analysisStatus: SimilarityAnalysisStatus.FAILED,
      },
    ]);
  });

  it("多图投递部分失败时等待全部结果，仅标记明确失败的图片", async () => {
    const h = createHarness(2);
    let completeFirst: (() => void) | undefined;
    h.similarityJobs.enqueue
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            completeFirst = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error("第二张图片投递失败"));

    const processing = h.process(h.job);
    await vi.waitFor(() =>
      expect(h.similarityJobs.enqueue).toHaveBeenCalledTimes(2),
    );
    expect(h.database.collectionLook.updateMany).not.toHaveBeenCalled();
    completeFirst?.();

    await expect(processing).resolves.toEqual({
      status: "succeeded",
      taskId: h.task.id,
    });
    expect(
      h.looks.find((look) => look.designAssetId === h.assets[0]?.id)
        ?.analysisStatus,
    ).toBe(SimilarityAnalysisStatus.PENDING);
    expect(
      h.looks.find((look) => look.designAssetId === h.assets[1]?.id)
        ?.analysisStatus,
    ).toBe(SimilarityAnalysisStatus.FAILED);
    expect(h.billing.incrementCount).toHaveBeenCalledOnce();
  });

  it("成功投递相似度分析后保留待分析状态", async () => {
    const h = createHarness();

    await expect(h.process(h.job)).resolves.toEqual({
      status: "succeeded",
      taskId: h.task.id,
    });

    expect(h.similarityJobs.enqueue).toHaveBeenCalledExactlyOnceWith(
      h.task.collectionId,
      h.assets[0]?.id,
    );
    expect(h.database.collectionLook.updateMany).not.toHaveBeenCalled();
    expect(h.looks.at(-1)?.analysisStatus).toBe(
      SimilarityAnalysisStatus.PENDING,
    );
  });
});
