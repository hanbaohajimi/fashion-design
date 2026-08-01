import type { PrismaClient } from "@fashion/db";
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { S3FileStorage } from "../files/storage.service";

export const GENERATION_MASK_DB = Symbol("GENERATION_MASK_DB");
type MaskDatabase = Pick<PrismaClient, "project">;
const MASK_DOWNLOAD_TTL_SECONDS = 30 * 60;

@Injectable()
export class GenerationMaskService {
  constructor(
    @Inject(GENERATION_MASK_DB) private readonly database: MaskDatabase,
    @Inject(S3FileStorage) private readonly storage: S3FileStorage,
  ) {}

  async sign(
    userId: string,
    input: {
      readonly checksumSha256: string;
      readonly projectId: string;
      readonly width: number;
      readonly height: number;
      readonly size: number;
    },
  ) {
    await this.assertProjectOwnership(userId, input.projectId);
    const maskId = randomUUID();
    const objectKey = `temporary/masks/${userId}/${maskId}.png`;
    return {
      expiresAt: new Date(
        Date.now() + MASK_DOWNLOAD_TTL_SECONDS * 1000,
      ).toISOString(),
      maskId,
      maskUrl: await this.storage.createDownloadUrl(
        objectKey,
        MASK_DOWNLOAD_TTL_SECONDS,
      ),
      upload: {
        headers: {
          "Content-Type": "image/png",
          "x-amz-checksum-sha256": input.checksumSha256,
        },
        method: "PUT" as const,
        url: await this.storage.createUploadUrl(
          objectKey,
          "image/png",
          input.checksumSha256,
        ),
      },
    };
  }

  private async assertProjectOwnership(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const project = await this.database.project.findUnique({
      where: { id: projectId },
      select: {
        deletedAt: true,
        workspace: { select: { ownerId: true } },
      },
    });
    if (!project || project.deletedAt) {
      throw new NotFoundException({
        code: "PROJECT_NOT_FOUND",
        message: "项目不存在",
      });
    }
    if (project.workspace.ownerId !== userId) {
      throw new ForbiddenException({
        code: "PROJECT_FORBIDDEN",
        message: "无权为该项目上传临时掩码",
      });
    }
  }
}
