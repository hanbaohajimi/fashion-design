import {
  Prisma,
  SimilarityAnalysisStatus,
  type PrismaClient,
} from "@fashion/db";
import type { CollectionSimilarityJobData } from "@fashion/shared";

import type { ImageEmbedder } from "../clip-embedder";

type SimilarityDatabase = Pick<
  PrismaClient,
  "$transaction" | "collectionLook" | "collectionLookSimilarity"
>;

export interface CollectionSimilarityProcessorDependencies {
  readonly database: SimilarityDatabase;
  readonly embedder: ImageEmbedder;
}

export function createCollectionSimilarityProcessor({
  database,
  embedder,
}: CollectionSimilarityProcessorDependencies) {
  return async (
    job: CollectionSimilarityJobData,
  ): Promise<{
    collectionId: string;
    lookCount: number;
    pairCount: number;
  }> => {
    const requestedLook = await database.collectionLook.findUnique({
      where: {
        collectionId_designAssetId: {
          collectionId: job.collectionId,
          designAssetId: job.designAssetId,
        },
      },
      select: { designAssetId: true },
    });
    if (!requestedLook) {
      throw new Error("系列 Look 不存在，无法计算参考相似度");
    }

    await database.collectionLook.updateMany({
      where: { collectionId: job.collectionId },
      data: { analysisStatus: SimilarityAnalysisStatus.RUNNING },
    });

    const looks = await database.collectionLook.findMany({
      where: { collectionId: job.collectionId },
      orderBy: { ordinal: "asc" },
      select: {
        designAsset: { select: { url: true } },
        designAssetId: true,
      },
    });
    const embeddings = new Map<string, readonly number[]>();
    for (const look of looks) {
      embeddings.set(
        look.designAssetId,
        await embedder.embed(look.designAsset.url),
      );
    }

    const pairs: Array<{
      collectionId: string;
      leftAssetId: string;
      rightAssetId: string;
      score: number;
    }> = [];
    const minimumByAsset = new Map<string, number>();
    for (let leftIndex = 0; leftIndex < looks.length; leftIndex += 1) {
      const left = looks[leftIndex];
      if (!left) continue;
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < looks.length;
        rightIndex += 1
      ) {
        const right = looks[rightIndex];
        if (!right) continue;
        const score = cosineSimilarity(
          requireEmbedding(embeddings, left.designAssetId),
          requireEmbedding(embeddings, right.designAssetId),
        );
        const [leftAssetId, rightAssetId] = [
          left.designAssetId,
          right.designAssetId,
        ].sort();
        if (!leftAssetId || !rightAssetId) {
          throw new Error("系列 Look 标识无效");
        }
        pairs.push({
          collectionId: job.collectionId,
          leftAssetId,
          rightAssetId,
          score,
        });
        setMinimum(minimumByAsset, left.designAssetId, score);
        setMinimum(minimumByAsset, right.designAssetId, score);
      }
    }

    await database.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "collections" WHERE "id" = ${job.collectionId} FOR UPDATE`,
      );
      const currentLookCount = await transaction.collectionLook.count({
        where: { collectionId: job.collectionId },
      });
      if (currentLookCount !== looks.length) {
        throw new Error("系列 Look 集合已变化，重新计算参考相似度");
      }
      await transaction.collectionLookSimilarity.deleteMany({
        where: { collectionId: job.collectionId },
      });
      if (pairs.length > 0) {
        await transaction.collectionLookSimilarity.createMany({
          data: pairs,
        });
      }
      await Promise.all(
        looks.map((look) =>
          transaction.collectionLook.update({
            where: {
              collectionId_designAssetId: {
                collectionId: job.collectionId,
                designAssetId: look.designAssetId,
              },
            },
            data: {
              analysisStatus: SimilarityAnalysisStatus.READY,
              similarityScore: minimumByAsset.get(look.designAssetId) ?? null,
            },
          }),
        ),
      );
    });

    return {
      collectionId: job.collectionId,
      lookCount: looks.length,
      pairCount: pairs.length,
    };
  };
}

export async function markCollectionSimilarityFailed(
  database: Pick<PrismaClient, "collectionLook">,
  job: CollectionSimilarityJobData,
): Promise<void> {
  await database.collectionLook.updateMany({
    where: {
      collectionId: job.collectionId,
      analysisStatus: SimilarityAnalysisStatus.RUNNING,
    },
    data: { analysisStatus: SimilarityAnalysisStatus.FAILED },
  });
}

export function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length === 0 || left.length !== right.length) {
    throw new Error("CLIP 特征维度不一致");
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === undefined || rightValue === undefined) {
      throw new Error("CLIP 特征包含无效值");
    }
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  const denominator = Math.sqrt(leftMagnitude * rightMagnitude);
  if (denominator === 0) {
    throw new Error("CLIP 特征不能为零向量");
  }
  return Math.max(-1, Math.min(1, dot / denominator));
}

function requireEmbedding(
  embeddings: ReadonlyMap<string, readonly number[]>,
  assetId: string,
): readonly number[] {
  const embedding = embeddings.get(assetId);
  if (!embedding) {
    throw new Error("CLIP 特征缺失");
  }
  return embedding;
}

function setMinimum(
  scores: Map<string, number>,
  assetId: string,
  score: number,
): void {
  const current = scores.get(assetId);
  scores.set(assetId, current === undefined ? score : Math.min(current, score));
}
