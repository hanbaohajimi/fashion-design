import { FileStatus, Prisma } from "@fashion/db";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SignUploadInput } from "./files.schemas";
import { FilesService } from "./files.service";
import { BullThumbnailJobs } from "./thumbnail-queue.service";

const input: SignUploadInput = {
  mimeType: "image/png",
  name: "look.png",
  projectId: "project-a",
  sha256: "a".repeat(64),
  size: 1024,
};

function fileRecord(overrides: Record<string, unknown> = {}) {
  return {
    completedAt: null,
    createdAt: new Date("2026-01-01"),
    errorMessage: null,
    height: null,
    id: "file-1",
    mimeType: "image/png",
    objectKey: "originals/user-a/file-1/source",
    originalName: "look.png",
    ownerId: "user-a",
    sha256: "a".repeat(64),
    sizeBytes: 1024,
    status: FileStatus.PENDING,
    thumbnail1024Key: null,
    thumbnail256Key: null,
    updatedAt: new Date("2026-01-01"),
    width: null,
    ...overrides,
  };
}

describe("FilesService", () => {
  const database = {
    fileAsset: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
    },
  };
  const storage = {
    createDownloadUrl: vi.fn(),
    createUploadUrl: vi.fn(),
    delete: vi.fn(),
    head: vi.fn(),
    publicUrl: vi.fn((key: string) => `https://cdn.test/${key}`),
    readPrefix: vi.fn(),
  };
  const jobs = { enqueue: vi.fn() };
  const service = new FilesService(database as never, storage, jobs);

  beforeEach(() => {
    vi.clearAllMocks();
    jobs.enqueue.mockReset();
    jobs.enqueue.mockResolvedValue(undefined);
    database.project.findUnique.mockResolvedValue({
      deletedAt: null,
      workspace: { ownerId: "user-a" },
    });
    storage.createUploadUrl.mockResolvedValue("https://upload.test/signed");
    storage.delete.mockResolvedValue(undefined);
    database.fileAsset.updateMany.mockResolvedValue({ count: 1 });
    storage.readPrefix.mockResolvedValue(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it("为新图片创建记录并返回直传 URL", async () => {
    database.fileAsset.findUnique.mockResolvedValue(null);
    database.fileAsset.create.mockResolvedValue(fileRecord());

    const result = await service.signUpload("user-a", input);
    const checksumSha256 = Buffer.from(input.sha256, "hex").toString("base64");

    expect(result.deduplicated).toBe(false);
    expect(result.upload?.method).toBe("PUT");
    expect(result.upload?.headers).toEqual({
      "Content-Type": "image/png",
      "x-amz-checksum-sha256": checksumSha256,
    });
    expect(storage.createUploadUrl).toHaveBeenCalledWith(
      "originals/user-a/file-1/source",
      "image/png",
      checksumSha256,
    );
    expect(database.fileAsset.create).toHaveBeenCalledOnce();
  });

  it("SHA256 命中 READY 文件时不创建记录也不重新上传", async () => {
    database.fileAsset.findUnique.mockResolvedValue(
      fileRecord({
        status: FileStatus.READY,
        thumbnail1024Key: "thumbs/file-1/1024.webp",
      }),
    );

    const result = await service.signUpload("user-a", input);

    expect(result.deduplicated).toBe(true);
    expect(result.upload).toBeNull();
    expect(result.file.thumbnail1024Url).toBe(
      "/api/files/file-1/thumbnail/1024",
    );
    expect(database.fileAsset.create).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("并发创建命中唯一约束时返回已存在的去重文件", async () => {
    database.fileAsset.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(fileRecord({ status: FileStatus.READY }));
    database.fileAsset.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique conflict", {
        clientVersion: "7.9.0",
        code: "P2002",
      }),
    );

    const result = await service.signUpload("user-a", input);

    expect(result.deduplicated).toBe(true);
    expect(result.upload).toBeNull();
  });

  it("FAILED 文件重新签名时用版本 CAS 重置上传状态", async () => {
    const failed = fileRecord({
      completedAt: new Date("2026-01-02"),
      errorMessage: "旧任务失败",
      height: 100,
      status: FileStatus.FAILED,
      thumbnail1024Key: "old/1024.webp",
      thumbnail256Key: "old/256.webp",
      width: 200,
    });
    const pending = fileRecord({
      updatedAt: new Date("2026-01-03"),
    });
    database.fileAsset.findUnique
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(pending);

    const result = await service.signUpload("user-a", input);

    expect(database.fileAsset.updateMany).toHaveBeenCalledWith({
      where: {
        id: "file-1",
        ownerId: "user-a",
        status: FileStatus.FAILED,
        updatedAt: failed.updatedAt,
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
    expect(result.file.status).toBe(FileStatus.PENDING);
    expect(result.upload).not.toBeNull();
    expect(storage.delete).toHaveBeenCalledWith("old/1024.webp");
    expect(storage.delete).toHaveBeenCalledWith("old/256.webp");
  });

  it("FAILED 重置 CAS 失配时不删除仍可能被其他请求引用的缩略图", async () => {
    const failed = fileRecord({
      completedAt: new Date("2026-01-02"),
      status: FileStatus.FAILED,
      thumbnail1024Key: "old/1024.webp",
      thumbnail256Key: "old/256.webp",
    });
    database.fileAsset.findUnique
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(fileRecord({ status: FileStatus.READY }));
    database.fileAsset.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await service.signUpload("user-a", input);

    expect(result.file.status).toBe(FileStatus.READY);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("FAILED 重置 CAS 后仍为 FAILED 时不签发无法完成的上传 URL", async () => {
    const failed = fileRecord({
      completedAt: new Date("2026-01-02"),
      status: FileStatus.FAILED,
      thumbnail256Key: "old/256.webp",
    });
    database.fileAsset.findUnique
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(
        fileRecord({
          ...failed,
          errorMessage: "并发任务更新了失败详情",
          updatedAt: new Date("2026-01-04"),
        }),
      );
    database.fileAsset.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.signUpload("user-a", input)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(storage.createUploadUrl).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("用户 A 不能向用户 B 的项目签名上传", async () => {
    database.project.findUnique.mockResolvedValue({
      deletedAt: null,
      workspace: { ownerId: "user-b" },
    });

    await expect(service.signUpload("user-a", input)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("完成直传后入队，PROCESSING 重试会对账补投且不重复校验原图", async () => {
    const pending = fileRecord();
    const processing = fileRecord({
      completedAt: new Date("2026-01-02"),
      status: FileStatus.PROCESSING,
    });
    database.fileAsset.findUnique
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(processing);
    storage.head.mockResolvedValue({
      contentLength: 1024,
      contentType: "image/png",
    });

    const result = await service.complete("user-a", "file-1");

    expect(result.status).toBe(FileStatus.PROCESSING);
    expect(jobs.enqueue).toHaveBeenCalledOnce();

    await service.complete("user-a", "file-1");
    expect(jobs.enqueue).toHaveBeenCalledTimes(2);
    expect(storage.head).toHaveBeenCalledOnce();
    expect(storage.readPrefix).toHaveBeenCalledOnce();
  });

  it("并发完成请求认领失败后会对账已进入 PROCESSING 的任务", async () => {
    const processing = fileRecord({
      completedAt: new Date("2026-01-02"),
      status: FileStatus.PROCESSING,
    });
    database.fileAsset.findUnique
      .mockResolvedValueOnce(fileRecord())
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(processing);
    database.fileAsset.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValue({ count: 1 });
    storage.head.mockResolvedValue({
      contentLength: 1024,
      contentType: "image/png",
    });

    const result = await service.complete("user-a", "file-1");

    expect(result.status).toBe(FileStatus.PROCESSING);
    expect(jobs.enqueue).toHaveBeenCalledOnce();
  });

  it("拒绝与签名请求大小不一致的已上传对象", async () => {
    database.fileAsset.findUnique.mockResolvedValue(fileRecord());
    storage.head.mockResolvedValue({
      contentLength: 8,
      contentType: "image/png",
    });

    await expect(service.complete("user-a", "file-1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("拒绝对象存储返回的 SHA256 与签名请求不一致", async () => {
    database.fileAsset.findUnique.mockResolvedValue(fileRecord());
    storage.head.mockResolvedValue({
      checksumSha256: Buffer.from("b".repeat(64), "hex").toString("base64"),
      contentLength: 1024,
      contentType: "image/png",
    });

    await expect(service.complete("user-a", "file-1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.readPrefix).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("对象存储暂时不可用时返回 503 而不是误报未上传", async () => {
    database.fileAsset.findUnique.mockResolvedValue(fileRecord());
    storage.head.mockRejectedValue(new Error("socket timeout"));

    const failure = await service
      .complete("user-a", "file-1")
      .catch((error) => error);

    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect(failure.getResponse()).toMatchObject({
      code: "UPLOAD_STORAGE_UNAVAILABLE",
    });
  });

  it("对象存储明确返回 404 时仍提示原图未上传", async () => {
    database.fileAsset.findUnique.mockResolvedValue(fileRecord());
    storage.head.mockRejectedValue({
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    });

    const failure = await service
      .complete("user-a", "file-1")
      .catch((error) => error);

    expect(failure).toBeInstanceOf(BadRequestException);
    expect(failure.getResponse()).toMatchObject({ code: "UPLOAD_NOT_FOUND" });
  });

  it("拒绝 MIME 伪装为图片但 magic bytes 不是图片的文件", async () => {
    database.fileAsset.findUnique.mockResolvedValue(fileRecord());
    storage.head.mockResolvedValue({
      contentLength: 1024,
      contentType: "image/png",
    });
    storage.readPrefix.mockResolvedValue(new TextEncoder().encode("%PDF-1.7"));

    const failure = await service
      .complete("user-a", "file-1")
      .catch((error) => error);

    expect(failure).toBeInstanceOf(BadRequestException);
    expect(failure.getResponse()).toMatchObject({
      code: "INVALID_IMAGE_CONTENT",
    });
    expect(storage.delete).toHaveBeenCalledWith(
      "originals/user-a/file-1/source",
    );
    expect(database.fileAsset.updateMany).toHaveBeenCalledWith({
      where: {
        id: "file-1",
        ownerId: "user-a",
        status: FileStatus.PENDING,
        updatedAt: new Date("2026-01-01"),
      },
      data: {
        errorMessage: "文件内容不是有效图片或与声明类型不一致",
        status: FileStatus.FAILED,
      },
    });
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("INVALID 检查失去版本 CAS 时不删除新上传对象", async () => {
    database.fileAsset.findUnique
      .mockResolvedValueOnce(fileRecord())
      .mockResolvedValueOnce(fileRecord({ updatedAt: new Date("2026-01-02") }));
    database.fileAsset.updateMany.mockResolvedValue({ count: 0 });
    storage.head.mockResolvedValue({
      contentLength: 1024,
      contentType: "image/png",
    });
    storage.readPrefix.mockResolvedValue(new TextEncoder().encode("%PDF-1.7"));

    await expect(service.complete("user-a", "file-1")).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(storage.delete).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("入队响应不确定时保持 PROCESSING 并允许 complete 重试补投", async () => {
    const pending = fileRecord();
    const processing = fileRecord({
      completedAt: new Date("2026-01-02"),
      errorMessage: "缩略图任务入队状态未知，请重试完成请求",
      status: FileStatus.PROCESSING,
    });
    database.fileAsset.findUnique
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(processing);
    storage.head.mockResolvedValue({
      contentLength: 1024,
      contentType: "image/png",
    });
    jobs.enqueue.mockRejectedValueOnce(new Error("redis response lost"));

    await expect(service.complete("user-a", "file-1")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    const uncertainWrite =
      database.fileAsset.updateMany.mock.calls[
        database.fileAsset.updateMany.mock.calls.length - 1
      ]?.[0];
    expect(uncertainWrite).toMatchObject({
      where: {
        id: "file-1",
        ownerId: "user-a",
        status: FileStatus.PROCESSING,
      },
      data: {
        errorMessage: "缩略图任务入队状态未知，请重试完成请求",
      },
    });
    expect(uncertainWrite?.data).not.toHaveProperty("status");

    const retried = await service.complete("user-a", "file-1");

    expect(retried.status).toBe(FileStatus.PROCESSING);
    expect(jobs.enqueue).toHaveBeenCalledTimes(2);
    expect(
      database.fileAsset.updateMany.mock.calls.some(
        ([argument]) => argument.data?.status === FileStatus.FAILED,
      ),
    ).toBe(false);
  });

  it("用户 A 不能读取用户 B 的文件", async () => {
    database.fileAsset.findUnique.mockResolvedValue(
      fileRecord({ ownerId: "user-b" }),
    );

    await expect(service.get("user-a", "file-1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe("BullThumbnailJobs", () => {
  it("同 fixed jobId 已失败时重试原缩略图任务", async () => {
    const existing = {
      getState: vi.fn().mockResolvedValue("failed"),
      retry: vi.fn().mockResolvedValue(undefined),
    };
    const queue = {
      add: vi.fn(),
      getJob: vi.fn().mockResolvedValue(existing),
    };
    const jobs = new BullThumbnailJobs();
    Object.assign(jobs, { queue });

    await jobs.enqueue("file-1");

    expect(existing.retry).toHaveBeenCalledWith("failed", {
      resetAttemptsMade: true,
      resetAttemptsStarted: true,
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("同 fixed jobId 已完成但数据库仍需处理时删除旧任务并重建", async () => {
    const existing = {
      getState: vi.fn().mockResolvedValue("completed"),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const queue = {
      add: vi.fn().mockResolvedValue(undefined),
      getJob: vi.fn().mockResolvedValue(existing),
    };
    const jobs = new BullThumbnailJobs();
    Object.assign(jobs, { queue });

    await jobs.enqueue("file-1");

    expect(existing.remove).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledWith(
      "generate",
      { fileId: "file-1" },
      expect.objectContaining({
        attempts: 5,
        jobId: "file-1",
      }),
    );
  });

  it("同 fixed jobId 正在等待或执行时不重复添加", async () => {
    const existing = {
      getState: vi.fn().mockResolvedValue("waiting"),
    };
    const queue = {
      add: vi.fn(),
      getJob: vi.fn().mockResolvedValue(existing),
    };
    const jobs = new BullThumbnailJobs();
    Object.assign(jobs, { queue });

    await jobs.enqueue("file-1");

    expect(queue.add).not.toHaveBeenCalled();
  });

  it("queue.add 响应丢失但任务已存在时按成功对账", async () => {
    const reconciled = {
      getState: vi.fn().mockResolvedValue("waiting"),
    };
    const queue = {
      add: vi.fn().mockRejectedValue(new Error("redis response lost")),
      getJob: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(reconciled),
    };
    const jobs = new BullThumbnailJobs();
    Object.assign(jobs, { queue });

    await expect(jobs.enqueue("file-1")).resolves.toBeUndefined();
    expect(queue.getJob).toHaveBeenCalledTimes(2);
  });
});
