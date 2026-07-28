import {
  AccountPlan,
  ExportFormat,
  ExportQuality,
  ExportStatus,
} from "@fashion/db";
import { ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExportsService } from "./exports.service";

function exportRecord(overrides: Record<string, unknown> = {}) {
  return {
    collectionId: null,
    completedAt: null,
    createdAt: new Date("2026-07-28T08:00:00.000Z"),
    designAssetId: "asset-a",
    errorCode: null,
    errorMessage: null,
    expiresAt: null,
    fileName: null,
    format: ExportFormat.PNG,
    id: "export-a",
    maxEdge: 1_600,
    mimeType: null,
    objectKey: null,
    projectId: "project-a",
    quality: ExportQuality.STANDARD,
    sizeBytes: null,
    startedAt: null,
    status: ExportStatus.QUEUED,
    updatedAt: new Date("2026-07-28T08:00:00.000Z"),
    userId: "user-a",
    watermark: true,
    ...overrides,
  };
}

describe("ExportsService", () => {
  const database = {
    collection: { findUnique: vi.fn() },
    designAsset: { findUnique: vi.fn() },
    exportJob: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: { findUnique: vi.fn() },
  };
  const jobs = { enqueue: vi.fn() };
  const storage = {
    createDownloadUrl: vi.fn(),
    createUploadUrl: vi.fn(),
    delete: vi.fn(),
    head: vi.fn(),
    publicUrl: vi.fn(),
    readPrefix: vi.fn(),
  };
  const service = new ExportsService(
    database as never,
    jobs,
    storage,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    database.user.findUnique.mockResolvedValue({ plan: AccountPlan.FREE });
    database.designAsset.findUnique.mockResolvedValue({
      projectId: "project-a",
      project: {
        deletedAt: null,
        workspace: { ownerId: "user-a" },
      },
    });
    database.exportJob.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        exportRecord({
          ...data,
          id: "export-a",
          createdAt: new Date("2026-07-28T08:00:00.000Z"),
        }),
    );
  });

  it("Free 单图导出强制长边上限与水印并进入异步队列", async () => {
    const result = await service.create("user-a", {
      assetId: "asset-a",
      format: "png",
      quality: "standard",
      sourceType: "asset",
    });

    expect(result).toMatchObject({
      format: "png",
      maxEdge: 1_600,
      status: "queued",
      watermark: true,
    });
    expect(database.exportJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        designAssetId: "asset-a",
        maxEdge: 1_600,
        watermark: true,
      }),
    });
    expect(jobs.enqueue).toHaveBeenCalledWith("export-a");
  });

  it("Free 请求原图高清时返回升级提示", async () => {
    await expect(
      service.create("user-a", {
        assetId: "asset-a",
        format: "jpg",
        quality: "high",
        sourceType: "asset",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.exportJob.create).not.toHaveBeenCalled();
  });

  it("Pro 原图高清不限制长边且不加水印", async () => {
    database.user.findUnique.mockResolvedValue({ plan: AccountPlan.PRO });

    const result = await service.create("user-a", {
      assetId: "asset-a",
      format: "jpg",
      quality: "high",
      sourceType: "asset",
    });

    expect(result).toMatchObject({
      format: "jpg",
      maxEdge: null,
      quality: "high",
      watermark: false,
    });
  });

  it("成功任务返回最长 24 小时的签名下载地址", async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000);
    database.exportJob.findUnique.mockResolvedValue(
      exportRecord({
        completedAt: new Date(),
        expiresAt,
        fileName: "look.png",
        mimeType: "image/png",
        objectKey: "temporary/exports/user-a/export-a.png",
        sizeBytes: 128,
        status: ExportStatus.SUCCEEDED,
      }),
    );
    storage.createDownloadUrl.mockResolvedValue("https://download.test/signed");

    const result = await service.get("user-a", "export-a");

    expect(result.downloadUrl).toBe("https://download.test/signed");
    expect(storage.createDownloadUrl).toHaveBeenCalledWith(
      "temporary/exports/user-a/export-a.png",
      expect.any(Number),
      "look.png",
    );
    expect(storage.createDownloadUrl.mock.calls[0]?.[1]).toBeLessThanOrEqual(
      86_400,
    );
  });

  it("过期后不再签名并允许重新请求", async () => {
    database.exportJob.findUnique.mockResolvedValue(
      exportRecord({
        expiresAt: new Date(Date.now() - 1_000),
        objectKey: "temporary/exports/user-a/export-a.png",
        status: ExportStatus.SUCCEEDED,
      }),
    );
    database.exportJob.update.mockResolvedValue(
      exportRecord({ status: ExportStatus.EXPIRED }),
    );

    const result = await service.get("user-a", "export-a");

    expect(result).toMatchObject({
      downloadUrl: null,
      retryAllowed: true,
      status: "expired",
    });
    expect(storage.createDownloadUrl).not.toHaveBeenCalled();
  });
});
