import type { PrismaClient } from "@fashion/db";
import { Inject, Injectable } from "@nestjs/common";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { randomUUID } from "node:crypto";

import { S3FileStorage } from "../files/storage.service";

export const GENERATION_MASK_DB = Symbol("GENERATION_MASK_DB");
type MaskDatabase = Pick<PrismaClient, "project" | "workspaceMember">;
const MASK_DOWNLOAD_TTL_SECONDS = 30 * 60;

@Injectable()
export class GenerationMaskService {
  constructor(
    @Inject(GENERATION_MASK_DB) database: MaskDatabase,
    @Inject(S3FileStorage) private readonly storage: S3FileStorage,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy = new ProjectAccessPolicy(database),
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
    await this.access.require(userId, input.projectId, "edit");
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
          input.size,
          input.checksumSha256,
        ),
      },
    };
  }

}
