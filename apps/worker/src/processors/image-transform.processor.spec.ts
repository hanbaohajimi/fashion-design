import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@fashion/db";
import type { ImageTransformJob } from "@fashion/shared";
import type { Job } from "bullmq";
import sharp from "sharp";
import { createImageTransformProcessor } from "./image-transform.processor";

async function setup() {
  const bytes = await sharp({
    create: { width: 64, height: 96, channels: 4, background: "#234b36" },
  })
    .png()
    .toBuffer();
  let saved: { assetId?: string; error?: string } | null = null;
  const assetUpsert = vi.fn().mockResolvedValue({});
  const resultUpsert = vi
    .fn()
    .mockImplementation(
      async (input: { create: { assetId?: string; error?: string } }) => {
        saved = input.create;
        return saved;
      },
    );
  const tx = {
    designAsset: { upsert: assetUpsert },
    imageTransformResult: { upsert: resultUpsert },
  };
  const database = {
    workflowAttempt: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({
          id: "attempt",
          projectId: "project",
          requestSnapshot: {
            transformAssetId: "source",
            params: { width: 96, height: 64, rotate: 90, flipHorizontal: true },
          },
        }),
    },
    designAsset: {
      findFirstOrThrow: vi
        .fn()
        .mockResolvedValue({
          id: "source",
          projectId: "project",
          rootAssetId: "root",
          url: "s3://source.png",
        }),
    },
    imageTransformResult: {
      findUnique: vi.fn().mockImplementation(async () => saved),
      upsert: resultUpsert,
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (action: (value: typeof tx) => Promise<void>) =>
        action(tx),
      ),
  };
  const storage = {
    get: vi.fn().mockResolvedValue(bytes),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const process = createImageTransformProcessor(
    database as unknown as PrismaClient,
    storage,
  );
  const job = {
    data: { attemptId: "attempt" },
    attemptsMade: 0,
    opts: { attempts: 1 },
  } as Job<ImageTransformJob>;
  return { database, storage, process, job, assetUpsert, resultUpsert };
}

describe("图片新版本保存", () => {
  it("保留父图、根图及操作参数，原图不被覆写，重复作业不重复写入", async () => {
    const state = await setup();
    await state.process(state.job);
    expect(state.assetUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          id: "transform-attempt",
          projectId: "project",
          parentAssetId: "source",
          rootAssetId: "root",
          operation: "TRANSFORM",
          width: 96,
          height: 64,
          designStep: {
            create: expect.objectContaining({
              inputSnapshot: {
                sourceAssetId: "source",
                params: expect.objectContaining({
                  rotate: 90,
                  flipHorizontal: true,
                }),
              },
            }),
          },
        }),
      }),
    );
    expect(state.database.designAsset.findFirstOrThrow).toHaveBeenCalledWith({
      where: {
        id: "source",
        projectId: "project",
        archivedAt: null,
        project: { deletedAt: null },
      },
    });
    const keys = state.storage.put.mock.calls.map((call) => call[0]);
    expect(keys).toEqual([
      "transforms/project/transform-attempt.png",
      "transforms/project/transform-attempt.webp",
    ]);
    expect(
      await sharp(state.storage.put.mock.calls[0]?.[1] as Buffer).metadata(),
    ).toMatchObject({ width: 96, height: 64, format: "png" });
    await state.process(state.job);
    expect(state.storage.put).toHaveBeenCalledTimes(2);
    expect(state.assetUpsert).toHaveBeenCalledTimes(1);
  });

  it("存储失败不报告成功，重试可完成同一版本并清除失败记录", async () => {
    const state = await setup();
    state.storage.put.mockRejectedValueOnce(new Error("存储暂不可用"));
    await expect(state.process(state.job)).rejects.toThrow("存储暂不可用");
    expect(state.assetUpsert).not.toHaveBeenCalled();
    expect(state.resultUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        create: { attemptId: "attempt", error: "存储暂不可用" },
      }),
    );
    await state.process(state.job);
    expect(state.assetUpsert).toHaveBeenCalledOnce();
    expect(state.resultUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: { assetId: "transform-attempt", error: null },
      }),
    );
  });

  it("自动重试尚未耗尽时不写终态，损坏输入不写新资产", async () => {
    const state = await setup();
    state.storage.get.mockResolvedValue(Buffer.from("invalid"));
    await expect(
      state.process({
        ...state.job,
        opts: { attempts: 3 },
      } as Job<ImageTransformJob>),
    ).rejects.toThrow();
    expect(state.resultUpsert).not.toHaveBeenCalled();
    expect(state.assetUpsert).not.toHaveBeenCalled();
    expect(state.storage.put).not.toHaveBeenCalled();
  });
});
