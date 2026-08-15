import { ContentModerationStatus, GenerationTaskStatus } from "@fashion/db";
import type { GenerationJobData } from "@fashion/shared";
import type { Job } from "bullmq";
import { describe, expect, it, vi } from "vitest";

import { createGenerationProcessor } from "./generation.processor";

const providerJob = {
  provider: "mock",
  providerJobId: "remote-job-1",
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

describe("generation moderation state transition", () => {
  it("审核拒绝发生在落资产和计次之前", async () => {
    const task = {
      canceledAt: null,
      collectionId: null,
      compiledPrompt: null,
      completedAt: null,
      countedAt: null,
      createdAt: new Date(),
      errorCode: null,
      errorMessage: null,
      id: "task-a",
      input: {
        height: 512,
        prompt: "fashion editorial",
        taskType: "t2i",
        width: 512,
      },
      manualReviewRequired: false,
      moderationCategories: [],
      moderationCheckedAt: null,
      moderationStatus: ContentModerationStatus.PENDING,
      parentAssetId: null,
      projectId: "project-a",
      providerJob,
      startedAt: null,
      status: GenerationTaskStatus.QUEUED,
      taskType: "t2i",
      updatedAt: new Date(),
      userId: "user-a",
      variationAxis: null,
      attemptCount: 0,
      output: null,
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const database = {
      $transaction: vi.fn(),
      collectionLook: { updateMany: vi.fn() },
      designAsset: { findMany: vi.fn() },
      generationTask: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(task)
          .mockResolvedValue({
            attemptCount: task.attemptCount + 1,
            status: GenerationTaskStatus.RUNNING,
          }),
        update: vi.fn().mockResolvedValue({}),
        updateMany,
      },
    };
    const billing = { incrementCount: vi.fn() };
    const moderator = {
      moderate: vi.fn().mockResolvedValue({
        categories: ["violence/graphic"],
        status: "rejected" as const,
      }),
    };
    const job = {
      attemptsMade: 0,
      data: { taskId: task.id, userId: task.userId },
      id: task.id,
      opts: { attempts: 2 },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job<GenerationJobData>;
    const process = createGenerationProcessor({
      ai: {
        getResult: vi.fn().mockResolvedValue({
          cost: providerJob.cost,
          images: [{ url: "https://cdn.test/generated.png" }],
          job: providerJob,
        }),
        getStatus: vi.fn().mockResolvedValue({ status: "completed" }),
        submit: vi.fn(),
      },
      billing,
      database: database as never,
      moderator,
      pollIntervalMs: 1,
    });

    await expect(process(job)).resolves.toMatchObject({
      status: "moderation_failed",
    });

    expect(moderator.moderate).toHaveBeenCalledWith([
      "https://cdn.test/generated.png",
    ]);
    expect(updateMany).toHaveBeenLastCalledWith({
      where: {
        attemptCount: task.attemptCount + 1,
        countedAt: null,
        id: task.id,
        status: GenerationTaskStatus.RUNNING,
      },
      data: expect.objectContaining({
        errorMessage: "该内容不符合平台规范",
        moderationStatus: ContentModerationStatus.REJECTED,
        status: GenerationTaskStatus.MODERATION_FAILED,
      }),
    });
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(database.designAsset.findMany).not.toHaveBeenCalled();
    expect(billing.incrementCount).not.toHaveBeenCalled();
  });

  it("审核服务不可用时最终失败且不落资产、不计费", async () => {
    const task = {
      attemptCount: 0,
      canceledAt: null,
      collectionId: null,
      compiledPrompt: null,
      completedAt: null,
      countedAt: null,
      createdAt: new Date(),
      errorCode: null,
      errorMessage: null,
      id: "task-review",
      input: {
        height: 512,
        prompt: "fashion editorial",
        taskType: "t2i",
        width: 512,
      },
      manualReviewRequired: false,
      moderationCategories: [],
      moderationCheckedAt: null,
      moderationStatus: ContentModerationStatus.PENDING,
      output: null,
      parentAssetId: null,
      projectId: "project-a",
      providerJob,
      startedAt: null,
      status: GenerationTaskStatus.QUEUED,
      taskType: "t2i",
      updatedAt: new Date(),
      userId: "user-a",
      variationAxis: null,
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const database = {
      $transaction: vi.fn(),
      collectionLook: { updateMany: vi.fn() },
      designAsset: { findMany: vi.fn() },
      generationTask: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(task)
          .mockResolvedValue({
            attemptCount: task.attemptCount + 1,
            status: GenerationTaskStatus.RUNNING,
          }),
        update: vi.fn().mockResolvedValue({}),
        updateMany,
      },
    };
    const billing = { incrementCount: vi.fn() };
    const job = {
      attemptsMade: 1,
      data: { taskId: task.id, userId: task.userId },
      id: task.id,
      opts: { attempts: 2 },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job<GenerationJobData>;
    const process = createGenerationProcessor({
      ai: {
        getResult: vi.fn().mockResolvedValue({
          cost: providerJob.cost,
          images: [{ url: "https://cdn.test/generated.png" }],
          job: providerJob,
        }),
        getStatus: vi.fn().mockResolvedValue({ status: "completed" }),
        submit: vi.fn(),
      },
      billing,
      database: database as never,
      moderator: {
        moderate: vi.fn().mockRejectedValue(new Error("moderation offline")),
      },
      pollIntervalMs: 1,
    });

    await expect(process(job)).rejects.toThrow("内容审核服务暂时不可用");
    expect(updateMany).toHaveBeenLastCalledWith({
      where: {
        attemptCount: task.attemptCount + 1,
        id: task.id,
        status: GenerationTaskStatus.RUNNING,
      },
      data: expect.objectContaining({
        errorCode: "CONTENT_MODERATION_UNAVAILABLE",
        status: GenerationTaskStatus.FAILED,
      }),
    });
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(database.designAsset.findMany).not.toHaveBeenCalled();
    expect(billing.incrementCount).not.toHaveBeenCalled();
  });
});
