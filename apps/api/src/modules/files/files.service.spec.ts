import { FileStatus } from "@fashion/db";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SignUploadInput } from "./files.schemas";
import { FilesService } from "./files.service";

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
    },
    project: {
      findUnique: vi.fn(),
    },
  };
  const storage = {
    createDownloadUrl: vi.fn(),
    createUploadUrl: vi.fn(),
    head: vi.fn(),
    publicUrl: vi.fn((key: string) => `https://cdn.test/${key}`),
  };
  const jobs = { enqueue: vi.fn() };
  const service = new FilesService(database as never, storage, jobs);

  beforeEach(() => {
    vi.clearAllMocks();
    database.project.findUnique.mockResolvedValue({
      deletedAt: null,
      workspace: { ownerId: "user-a" },
    });
    storage.createUploadUrl.mockResolvedValue("https://upload.test/signed");
  });

  it("为新图片创建记录并返回直传 URL", async () => {
    database.fileAsset.findUnique.mockResolvedValue(null);
    database.fileAsset.create.mockResolvedValue(fileRecord());

    const result = await service.signUpload("user-a", input);

    expect(result.deduplicated).toBe(false);
    expect(result.upload?.method).toBe("PUT");
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
    expect(result.file.thumbnail1024Url).toContain("1024.webp");
    expect(database.fileAsset.create).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
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

  it("完成直传后校验 HEAD 并且只入队一次", async () => {
    const pending = fileRecord();
    database.fileAsset.findUnique.mockResolvedValueOnce(pending);
    storage.head.mockResolvedValue({
      contentLength: 1024,
      contentType: "image/png",
    });
    database.fileAsset.update.mockResolvedValue(
      fileRecord({ status: FileStatus.PROCESSING }),
    );

    const result = await service.complete("user-a", "file-1");

    expect(result.status).toBe(FileStatus.PROCESSING);
    expect(jobs.enqueue).toHaveBeenCalledOnce();

    database.fileAsset.findUnique.mockResolvedValueOnce(
      fileRecord({ status: FileStatus.PROCESSING }),
    );
    await service.complete("user-a", "file-1");
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

  it("用户 A 不能读取用户 B 的文件", async () => {
    database.fileAsset.findUnique.mockResolvedValue(
      fileRecord({ ownerId: "user-b" }),
    );

    await expect(service.get("user-a", "file-1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
