import { FileStatus, Prisma, type PrismaClient } from "@fashion/db";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
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

const IMAGE_SIGNATURE_BYTES = 24;

export function detectImageMime(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value,
    )
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis"].includes(brand)) {
      return "image/heic";
    }
    if (["mif1", "msf1"].includes(brand)) {
      return "image/heif";
    }
  }
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

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

    let detectedMime: string | null;
    try {
      const prefix = await this.storage.readPrefix(
        file.objectKey,
        IMAGE_SIGNATURE_BYTES,
      );
      detectedMime = detectImageMime(prefix);
    } catch (error) {
      throw new ServiceUnavailableException(
        {
          code: "UPLOAD_INSPECTION_UNAVAILABLE",
          message: "暂时无法校验上传内容，请稍后重试",
        },
        { cause: error },
      );
    }
    if (detectedMime !== file.mimeType) {
      await Promise.all([
        this.storage.delete(file.objectKey).catch(() => undefined),
        this.database.fileAsset.update({
          where: { id: file.id },
          data: {
            errorMessage: "文件内容不是有效图片或与声明类型不一致",
            status: FileStatus.FAILED,
          },
        }),
      ]);
      throw new BadRequestException({
        code: "INVALID_IMAGE_CONTENT",
        message: "文件内容不是有效图片或与声明类型不一致",
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
