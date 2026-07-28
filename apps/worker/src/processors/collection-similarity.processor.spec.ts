import { SimilarityAnalysisStatus } from "@fashion/db";
import { describe, expect, it, vi } from "vitest";

import {
  cosineSimilarity,
  createCollectionSimilarityProcessor,
} from "./collection-similarity.processor";

describe("collection similarity processor", () => {
  it("用内存中的 CLIP 特征计算两两余弦值并持久化矩阵与最低分", async () => {
    const looks = [
      {
        designAsset: { url: "https://cdn.test/look-1.png" },
        designAssetId: "asset-a",
      },
      {
        designAsset: { url: "https://cdn.test/look-2.png" },
        designAssetId: "asset-b",
      },
      {
        designAsset: { url: "https://cdn.test/look-3.png" },
        designAssetId: "asset-c",
      },
    ];
    const collectionLook = {
      count: vi.fn().mockResolvedValue(3),
      findMany: vi.fn().mockResolvedValue(looks),
      findUnique: vi.fn().mockResolvedValue({ designAssetId: "asset-c" }),
      update: vi.fn(),
      updateMany: vi.fn(),
    };
    const collectionLookSimilarity = {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    };
    const database = {
      $transaction: vi.fn(
        async (
          callback: (transaction: {
            $queryRaw: ReturnType<typeof vi.fn>;
            collectionLook: typeof collectionLook;
            collectionLookSimilarity: typeof collectionLookSimilarity;
          }) => Promise<void>,
        ) =>
          callback({
            $queryRaw: vi.fn(),
            collectionLook,
            collectionLookSimilarity,
          }),
      ),
      collectionLook,
      collectionLookSimilarity,
    };
    const embedder = {
      embed: vi.fn(async (url: string) => {
        if (url.includes("look-1")) return [1, 0];
        if (url.includes("look-2")) return [0.8, 0.6];
        return [0, 1];
      }),
    };
    const process = createCollectionSimilarityProcessor({
      database: database as never,
      embedder,
    });

    const result = await process({
      collectionId: "collection-1",
      designAssetId: "asset-c",
    });

    expect(result).toEqual({
      collectionId: "collection-1",
      lookCount: 3,
      pairCount: 3,
    });
    expect(collectionLook.updateMany).toHaveBeenCalledWith({
      where: { collectionId: "collection-1" },
      data: { analysisStatus: SimilarityAnalysisStatus.RUNNING },
    });
    expect(collectionLookSimilarity.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          leftAssetId: "asset-a",
          rightAssetId: "asset-b",
          score: 0.8,
        }),
        expect.objectContaining({
          leftAssetId: "asset-a",
          rightAssetId: "asset-c",
          score: 0,
        }),
        expect.objectContaining({
          leftAssetId: "asset-b",
          rightAssetId: "asset-c",
          score: 0.6,
        }),
      ]),
    });
    expect(collectionLook.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          analysisStatus: SimilarityAnalysisStatus.READY,
          similarityScore: 0,
        },
        where: {
          collectionId_designAssetId: {
            collectionId: "collection-1",
            designAssetId: "asset-a",
          },
        },
      }),
    );
  });

  it("拒绝维度不一致或零向量，避免写入伪相似度", () => {
    expect(() => cosineSimilarity([1], [1, 2])).toThrow("CLIP 特征维度不一致");
    expect(() => cosineSimilarity([0, 0], [1, 0])).toThrow(
      "CLIP 特征不能为零向量",
    );
  });
});
