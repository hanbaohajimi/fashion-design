import {
  resolveGenerationImageInputs,
  type AiGenerationRequest,
} from "@fashion/ai";
import type { PrismaClient } from "@fashion/db";
import {
  privateStorageObjectKey,
  type GenerationImageSources,
} from "@fashion/shared";
import { BadRequestException } from "@nestjs/common";
import { requireProjectFile } from "../files/project-file-access";
import type { ProjectAccessPolicy } from "../studio/project-access.policy";

/** Freeze authorized object identities so queued jobs do not depend on temporary URLs. */
export async function captureGenerationImageSources(
  database: Pick<PrismaClient, "designAsset" | "fileAsset" | "project">,
  access: ProjectAccessPolicy,
  userId: string,
  projectId: string | undefined,
  request: AiGenerationRequest,
): Promise<GenerationImageSources | undefined> {
  const entries: GenerationImageSources["entries"] = [];
  for (const url of new Set(resolveGenerationImageInputs(request).urls)) {
    // Inpaint freezes its source and mask separately before producing aligned copies.
    if (request.taskType === "inpaint" && url === request.referenceImageUrl)
      continue;
    const objectKey = privateStorageObjectKey(url, {
      endpoint: process.env.S3_ENDPOINT,
      bucket: process.env.S3_BUCKET,
      cdnOrigin: process.env.ASSET_CDN_ORIGIN,
    });
    if (!objectKey) continue; // External references retain the normal loader restrictions.
    const asset = projectId
      ? await database.designAsset.findFirst({
          where: {
            projectId,
            archivedAt: null,
            OR: [
              { url: `s3://${objectKey}` },
              { thumbnailUrl: `s3://${objectKey}` },
            ],
          },
          select: { id: true },
        })
      : null;
    if (!asset) {
      const file = await database.fileAsset.findFirst({
        where: {
          OR: [
            { objectKey },
            { thumbnail256Key: objectKey },
            { thumbnail1024Key: objectKey },
          ],
        },
        include: {
          fabricMainImages: {
            where: { scope: "PRESET", status: "active" },
            select: { id: true },
          },
          trendCovers: { where: { status: "published" }, select: { id: true } },
        },
      });
      if (
        !file ||
        file.status !== "READY" ||
        !file.mimeType.startsWith("image/")
      ) {
        throw new BadRequestException(
          "生成参考图片不可用，请重新选择已上传的图片或当前项目素材",
        );
      }
      if (!file.fabricMainImages.length && !file.trendCovers.length) {
        await requireProjectFile(database, access, userId, file.id, projectId);
      }
    }
    entries.push({ url, objectKey });
  }
  return entries.length ? { version: 1, entries } : undefined;
}
