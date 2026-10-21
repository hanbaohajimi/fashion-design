import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { requireProjectFile } from "./project-file-access";
import { FileStatus, Prisma, type PrismaClient } from "@fashion/db";
import {
  BadRequestException,
  ConflictException,
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

function checksumSha256Base64(sha256: string): string {
  return Buffer.from(sha256, "hex").toString("base64");
}

function isObjectNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as {
    readonly $metadata?: { readonly httpStatusCode?: number };
    readonly name?: string;
  };
  return (
    candidate.$metadata?.httpStatusCode === 404 ||
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound"
  );
}

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
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy = new ProjectAccessPolicy(database as unknown as ConstructorParameters<typeof ProjectAccessPolicy>[0]),
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
    let deduplicated = Boolean(file);

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
        deduplicated = Boolean(file);
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

    if (file.status === FileStatus.FAILED) {
      const reset = await this.database.fileAsset.updateMany({
        where: {
          id: file.id,
          ownerId: userId,
          status: FileStatus.FAILED,
          updatedAt: file.updatedAt,
        },
        data: {
          completedAt: null,
          errorMessage: null,
          height: null,
          status: FileStatus.PENDING,
          thumbnail1024Key: null,
          thumbnail256Key: null,
          width: null,
        },
      });
      if (reset.count > 0) {
        const staleThumbnailKeys = [
          file.thumbnail1024Key,
          file.thumbnail256Key,
        ].filter((key): key is string => Boolean(key));
        await Promise.allSettled(
          [...new Set(staleThumbnailKeys)].map((key) =>
            this.storage.delete(key),
          ),
        );
      }
      file = await this.assertFileOwnership(userId, file.id);
      if (reset.count === 0 && file.status === FileStatus.FAILED) {
        throw new ConflictException({
          code: "FILE_RETRY_STATE_CHANGED",
          message: "文件重试状态已发生变化，请重新发起上传",
        });
      }
    }

    const uploadRequired =
      file.status === FileStatus.PENDING || file.status === FileStatus.FAILED;
    if (uploadRequired) {
      // Refresh the lease before issuing a URL, so cleanup cannot claim an active pending upload.
      const lease = await this.database.fileAsset.updateMany({
        where: { id: file.id, ownerId: userId, status: FileStatus.PENDING, updatedAt: file.updatedAt },
        data: { updatedAt: new Date() },
      });
      if (!lease.count) throw new ConflictException({ code: "UPLOAD_STATE_CHANGED", message: "上传状态已变化，请重新获取签名" });
    }
    const checksumSha256 = checksumSha256Base64(file.sha256);

    return {
      deduplicated,
      file: this.toResponse(file),
      upload: uploadRequired
        ? {
            headers: {
              "Content-Type": file.mimeType,
              "x-amz-checksum-sha256": checksumSha256,
            },
            method: "PUT" as const,
            url: await this.storage.createUploadUrl(
              file.objectKey,
              file.mimeType,
              file.sizeBytes,
              checksumSha256,
            ),
          }
        : null,
    };
  }

  async complete(userId: string, fileId: string) {
    const file = await this.assertFileOwnership(userId, fileId);
    if (file.status === FileStatus.READY) {
      return this.toResponse(file);
    }
    if (file.status === FileStatus.PROCESSING) {
      return this.reconcileThumbnailJob(userId, file);
    }

    let head: Awaited<ReturnType<FileStorage["head"]>>;
    try {
      head = await this.storage.head(file.objectKey);
    } catch (error) {
      if (isObjectNotFoundError(error)) {
        throw new BadRequestException({
          code: "UPLOAD_NOT_FOUND",
          message: "未找到已直传的原图，请重试上传",
        });
      }
      throw new ServiceUnavailableException(
        {
          code: "UPLOAD_STORAGE_UNAVAILABLE",
          message: "对象存储暂时不可用，请稍后重试确认上传",
        },
        { cause: error },
      );
    }
    const expectedChecksum = checksumSha256Base64(file.sha256);
    if (
      head.contentLength !== file.sizeBytes ||
      head.contentType?.split(";", 1)[0]?.trim().toLowerCase() !==
        file.mimeType ||
      (head.checksumSha256 !== undefined &&
        head.checksumSha256 !== expectedChecksum)
    ) {
      // Only invalidate the exact pending upload inspected above; never delete a newer retry.
      const invalidated = await this.database.fileAsset.updateMany({
        where: { id: file.id, ownerId: userId, status: FileStatus.PENDING, updatedAt: file.updatedAt },
        data: { status: FileStatus.FAILED, errorMessage: "上传后的文件大小、类型或摘要与签名请求不一致" },
      });
      // Failed objects are reclaimed under the cleanup row lock, without racing a fresh retry.
      if (!invalidated.count) throw new ConflictException({ code: "UPLOAD_STATE_CHANGED", message: "上传状态已变化，请刷新后重试" });
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
      const invalidated = await this.database.fileAsset.updateMany({
        where: {
          id: file.id,
          ownerId: userId,
          status: FileStatus.PENDING,
          updatedAt: file.updatedAt,
        },
        data: {
          errorMessage: "文件内容不是有效图片或与声明类型不一致",
          status: FileStatus.FAILED,
        },
      });
      if (invalidated.count === 0) {
        const current = await this.assertFileOwnership(userId, fileId);
        if (current.status === FileStatus.READY) {
          return this.toResponse(current);
        }
        if (current.status === FileStatus.PROCESSING) {
          return this.reconcileThumbnailJob(userId, current);
        }
        throw new ConflictException({
          code: "UPLOAD_STATE_CHANGED",
          message: "文件状态已发生变化，请重新获取文件状态后再试",
        });
      }
      // Reclaim under the cleanup row lock so an immediate retry cannot lose its new object.
      throw new BadRequestException({
        code: "INVALID_IMAGE_CONTENT",
        message: "文件内容不是有效图片或与声明类型不一致",
      });
    }

    const completedAt = new Date();
    const claim = await this.database.fileAsset.updateMany({
      where: {
        id: file.id,
        ownerId: userId,
        status: FileStatus.PENDING,
        updatedAt: file.updatedAt,
      },
      data: {
        completedAt,
        errorMessage: null,
        status: FileStatus.PROCESSING,
      },
    });
    if (claim.count === 0) {
      const current = await this.assertFileOwnership(userId, fileId);
      if (current.status === FileStatus.READY) {
        return this.toResponse(current);
      }
      if (current.status === FileStatus.PROCESSING) {
        return this.reconcileThumbnailJob(userId, current);
      }
      throw new ConflictException({
        code: "UPLOAD_STATE_CHANGED",
        message: "文件状态已发生变化，请重新获取文件状态后再试",
      });
    }

    const processing = {
      ...file,
      completedAt,
      errorMessage: null,
      status: FileStatus.PROCESSING,
    };
    return this.reconcileThumbnailJob(userId, processing);
  }

  async assertReadable(userId: string, fileId: string, projectId?: string) {
    return requireProjectFile(this.database, this.access, userId, fileId, projectId);
  }

  async get(userId: string, fileId: string) {
    return this.toResponse(await requireProjectFile(this.database, this.access, userId, fileId));
  }

  async thumbnailUrl(
    userId: string,
    fileId: string,
    size: "256" | "1024",
  ): Promise<string> {
    const file = await requireProjectFile(this.database, this.access, userId, fileId);
    const objectKey =
      size === "1024" ? file.thumbnail1024Key : file.thumbnail256Key;
    if (!objectKey) {
      throw new NotFoundException({
        code: "THUMBNAIL_NOT_READY",
        message: "缩略图尚未生成",
      });
    }
    return this.storage.createDownloadUrl(objectKey, 60);
  }

  private async assertProjectOwnership(
    userId: string,
    projectId: string,
  ): Promise<void> {
    await this.access.require(userId, projectId, "edit");
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

  private async reconcileThumbnailJob(
    userId: string,
    file: NonNullable<FileRecord>,
  ) {
    try {
      await this.thumbnailJobs.enqueue(file.id);
    } catch (error) {
      await this.database.fileAsset.updateMany({
        where: {
          completedAt: file.completedAt,
          id: file.id,
          ownerId: userId,
          status: FileStatus.PROCESSING,
        },
        data: {
          errorMessage: "缩略图任务入队状态未知，请重试完成请求",
        },
      });
      throw new ServiceUnavailableException(
        {
          code: "THUMBNAIL_QUEUE_UNAVAILABLE",
          message: "缩略图任务暂时无法入队，请稍后重试完成请求",
        },
        { cause: error },
      );
    }

    await this.database.fileAsset.updateMany({
      where: {
        completedAt: file.completedAt,
        id: file.id,
        ownerId: userId,
        status: FileStatus.PROCESSING,
      },
      data: { errorMessage: null },
    });
    return this.toResponse(await this.assertFileOwnership(userId, file.id));
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
        ? `/api/files/${encodeURIComponent(file.id)}/thumbnail/1024`
        : null,
      thumbnail256Url: file.thumbnail256Key
        ? `/api/files/${encodeURIComponent(file.id)}/thumbnail/256`
        : null,
      width: file.width,
    };
  }
}
