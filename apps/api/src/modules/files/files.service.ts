import { FileStatus, Prisma, type PrismaClient } from "@fashion/db";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";

import type { SignUploadInput } from "./files.schemas";
import type { FileStorage } from "./storage.service";
import type { ThumbnailJobs } from "./thumbnail-queue.service";

export const FILES_DB = Symbol("FILES_DB");
export const FILE_STORAGE = Symbol("FILE_STORAGE");
export const THUMBNAIL_JOBS = Symbol("THUMBNAIL_JOBS");

type FilesDatabase = Pick<PrismaClient, "fileAsset" | "project">;
type FileRecord = Awaited<ReturnType<FilesDatabase["fileAsset"]["findUnique"]>>;

@Injectable()
export class FilesService {
  constructor(
    @Inject(FILES_DB) private readonly database: FilesDatabase,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(THUMBNAIL_JOBS) private readonly thumbnailJobs: ThumbnailJobs,
  ) {}

  async signUpload(userId: string, input: SignUploadInput) {
    await this.assertProjectOwnership(userId, input.projectId);
    let file = await this.database.fileAsset.findUnique({
      where: {
        ownerId_sha256: {
          ownerId: userId,
          sha256: input.sha256,
        },
      },
    });
    const deduplicated = Boolean(file);

    if (!file) {
      const id = randomUUID();
      try {
        file = await this.database.fileAsset.create({
          data: {
            id,
            mimeType: input.mimeType,
            objectKey: `originals/${userId}/${id}/source`,
            originalName: input.name,
            ownerId: userId,
            sha256: input.sha256,
            sizeBytes: input.size,
          },
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== "P2002"
        ) {
          throw error;
        }
        file = await this.database.fileAsset.findUnique({
          where: {
            ownerId_sha256: {
              ownerId: userId,
              sha256: input.sha256,
            },
          },
        });
      }
    }

    if (!file) {
      throw new Error("文件去重记录创建失败");
    }

    if (file.mimeType !== input.mimeType || file.sizeBytes !== input.size) {
      throw new BadRequestException({
        code: "FILE_HASH_CONFLICT",
        message: "文件摘要已存在，但文件类型或大小不一致",
      });
    }

    const uploadRequired =
      file.status === FileStatus.PENDING || file.status === FileStatus.FAILED;
    if (file.status === FileStatus.FAILED) {
      file = await this.database.fileAsset.update({
        where: { id: file.id },
        data: { errorMessage: null, status: FileStatus.PENDING },
      });
    }

    return {
      deduplicated,
      file: this.toResponse(file),
      upload: uploadRequired
        ? {
            headers: {
              "Content-Type": file.mimeType,
            },
            method: "PUT" as const,
            url: await this.storage.createUploadUrl(
              file.objectKey,
              file.mimeType,
            ),
          }
        : null,
    };
  }

  async complete(userId: string, fileId: string) {
    const file = await this.assertFileOwnership(userId, fileId);
    if (
      file.status === FileStatus.READY ||
      file.status === FileStatus.PROCESSING
    ) {
      return this.toResponse(file);
    }

    const head = await this.storage.head(file.objectKey).catch(() => {
      throw new BadRequestException({
        code: "UPLOAD_NOT_FOUND",
        message: "未找到已直传的原图，请重试上传",
      });
    });
    if (
      head.contentLength !== file.sizeBytes ||
      head.contentType?.toLowerCase() !== file.mimeType
    ) {
      throw new BadRequestException({
        code: "UPLOAD_MISMATCH",
        message: "上传后的文件大小或类型与签名请求不一致",
      });
    }

    const processing = await this.database.fileAsset.update({
      where: { id: file.id },
      data: {
        completedAt: new Date(),
        errorMessage: null,
        status: FileStatus.PROCESSING,
      },
    });
    try {
      await this.thumbnailJobs.enqueue(file.id);
    } catch (error) {
      await this.database.fileAsset.update({
        where: { id: file.id },
        data: {
          errorMessage: "缩略图任务入队失败",
          status: FileStatus.FAILED,
        },
      });
      throw error;
    }
    return this.toResponse(processing);
  }

  async get(userId: string, fileId: string) {
    return this.toResponse(await this.assertFileOwnership(userId, fileId));
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
        message: "无权向该项目上传文件",
      });
    }
  }

  private async assertFileOwnership(userId: string, fileId: string) {
    const file = await this.database.fileAsset.findUnique({
      where: { id: fileId },
    });
    if (!file) {
      throw new NotFoundException({
        code: "FILE_NOT_FOUND",
        message: "文件不存在",
      });
    }
    if (file.ownerId !== userId) {
      throw new ForbiddenException({
        code: "FILE_FORBIDDEN",
        message: "无权访问该文件",
      });
    }
    return file;
  }

  private toResponse(file: NonNullable<FileRecord>) {
    return {
      error: file.errorMessage,
      height: file.height,
      id: file.id,
      mimeType: file.mimeType,
      name: file.originalName,
      size: file.sizeBytes,
      status: file.status,
      thumbnail1024Url: file.thumbnail1024Key
        ? this.storage.publicUrl(file.thumbnail1024Key)
        : null,
      thumbnail256Url: file.thumbnail256Key
        ? this.storage.publicUrl(file.thumbnail256Key)
        : null,
      width: file.width,
    };
  }
}
