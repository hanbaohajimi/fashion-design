import {
  DesignAssetOperation,
  SimilarityAnalysisStatus,
  prisma,
} from "@fashion/db";
import { afterAll, describe, expect, it } from "vitest";

import { createCollectionSimilarityProcessor } from "./collection-similarity.processor";

describe("collection similarity persistence integration", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("3 个 Look 生成 3 条矩阵分数并把最低分写回 collection_looks", async () => {
    const fixture = await createFixture();
    const process = createCollectionSimilarityProcessor({
      database: prisma,
      embedder: {
        async embed(url) {
          if (url.endsWith("look-1.png")) return [1, 0];
          if (url.endsWith("look-2.png")) return [0.8, 0.6];
          return [0, 1];
        },
      },
    });

    try {
      await process({
        collectionId: fixture.collectionId,
        designAssetId: fixture.assetIds[2],
      });
      const [looks, pairs] = await Promise.all([
        prisma.collectionLook.findMany({
          where: { collectionId: fixture.collectionId },
          orderBy: { ordinal: "asc" },
        }),
        prisma.collectionLookSimilarity.findMany({
          where: { collectionId: fixture.collectionId },
          orderBy: [{ leftAssetId: "asc" }, { rightAssetId: "asc" }],
        }),
      ]);

      expect(pairs).toHaveLength(3);
      expect(pairs.map((pair) => pair.score).sort()).toEqual([0, 0.6, 0.8]);
      expect(looks).toHaveLength(3);
      expect(looks.map((look) => look.analysisStatus)).toEqual([
        SimilarityAnalysisStatus.READY,
        SimilarityAnalysisStatus.READY,
        SimilarityAnalysisStatus.READY,
      ]);
      expect(looks.map((look) => look.similarityScore)).toEqual([0, 0.6, 0]);
    } finally {
      await prisma.user.delete({ where: { id: fixture.userId } });
    }
  });
});

async function createFixture(): Promise<{
  readonly assetIds: readonly [string, string, string];
  readonly collectionId: string;
  readonly userId: string;
}> {
  const user = await prisma.user.create({
    data: {
      email: `collection-similarity-${crypto.randomUUID()}@example.com`,
      ownedWorkspaces: {
        create: {
          name: "Similarity workspace",
          projects: { create: { name: "Similarity project" } },
        },
      },
    },
    include: {
      ownedWorkspaces: { include: { projects: true } },
    },
  });
  const projectId = user.ownedWorkspaces[0]?.projects[0]?.id;
  if (!projectId) throw new Error("测试项目创建失败");
  const assetIds = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ] as const;
  await prisma.$transaction(
    assetIds.map((id, index) =>
      prisma.designAsset.create({
        data: {
          id,
          operation: DesignAssetOperation.GENERATED,
          projectId,
          rootAssetId: id,
          url: `https://cdn.test/look-${index + 1}.png`,
        },
      }),
    ),
  );
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
      heroAssetId: assetIds[0],
      looks: {
        create: assetIds.map((designAssetId, index) => ({
          designAssetId,
          isHero: index === 0,
          ordinal: index + 1,
        })),
      },
      name: "Similarity collection",
      projectId,
    },
  });
  return {
    assetIds,
    collectionId: collection.id,
    userId: user.id,
  };
}
