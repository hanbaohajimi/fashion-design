import { Prisma, type PrismaClient } from "@fashion/db";
import { imageTransformSchema, type ImageTransformJob } from "@fashion/shared";
import type { Job } from "bullmq";
import sharp from "sharp";
import type { ThumbnailStorage } from "../storage";

export function createImageTransformProcessor(
  database: PrismaClient,
  storage: ThumbnailStorage,
) {
  return async (job: Job<ImageTransformJob>) => {
    const attemptId = job.data.attemptId;
    const saved = await database.imageTransformResult.findUnique({
      where: { attemptId },
    });
    if (saved?.assetId) return;
    try {
      const attempt = await database.workflowAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
      const snapshot = attempt.requestSnapshot as Record<
        string,
        Prisma.JsonValue
      >;
      const params = imageTransformSchema.parse(snapshot.params);
      const asset = await database.designAsset.findFirstOrThrow({
        where: {
          id: String(snapshot.transformAssetId),
          projectId: attempt.projectId,
          archivedAt: null,
          project: { deletedAt: null },
        },
      });
      if (!asset.url.startsWith("s3://")) throw new Error("原图尚未保存");
      const bytes = await storage.get(asset.url.slice(5));
      let pipeline = sharp(bytes, { limitInputPixels: 32_000_000 }).rotate();
      if (params.crop) pipeline = pipeline.extract(params.crop);
      const result = await pipeline
        .resize(params.width, params.height, { fit: "fill" })
        .png()
        .toBuffer();
      const id = `transform-${attemptId}`;
      const key = `transforms/${attempt.projectId}/${id}.png`;
      const thumb = `transforms/${attempt.projectId}/${id}.webp`;
      await storage.put(key, result, "image/png");
      await storage.put(
        thumb,
        await sharp(result)
          .resize({
            width: 1024,
            height: 1024,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp()
          .toBuffer(),
        "image/webp",
      );
      await database.$transaction(async (tx) => {
        await tx.designAsset.upsert({
          where: { id },
          update: {},
          create: {
            id,
            projectId: asset.projectId,
            parentAssetId: asset.id,
            rootAssetId: asset.rootAssetId,
            operation: "TRANSFORM",
            url: `s3://${key}`,
            thumbnailUrl: `s3://${thumb}`,
            width: params.width,
            height: params.height,
            designStep: {
              create: {
                projectId: asset.projectId,
                inputSnapshot: { sourceAssetId: asset.id, params },
                tool: "transform_image",
                actor: "user",
                intent: params.prompt,
              },
            },
          },
        });
        await tx.imageTransformResult.upsert({
          where: { attemptId },
          create: { attemptId, assetId: id },
          update: { assetId: id, error: null },
        });
      });
    } catch (error) {
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1))
        await database.imageTransformResult.upsert({
          where: { attemptId: job.data.attemptId },
          create: {
            attemptId: job.data.attemptId,
            error: error instanceof Error ? error.message : "图片处理失败",
          },
          update: {
            error: error instanceof Error ? error.message : "图片处理失败",
          },
        });
      throw error;
    }
  };
}
