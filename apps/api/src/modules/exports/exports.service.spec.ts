import { ExportFormat, ExportQuality, ExportStatus } from "@fashion/db";
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
  const service = new ExportsService(database as never, jobs, storage);

  beforeEach(() => {
    vi.clearAllMocks();
    database.user.findUnique.mockResolvedValue({ id: "user-a" });
    database.designAsset.findUnique.mockResolvedValue({
      projectId: "project-a",
      project: {
        deletedAt: null,
        workspace: { ownerId: "user-a" },
      },
    });
    database.collection.findUnique.mockResolvedValue({
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

  it("导出能力不再包含套餐或水印限制", async () => {
    await expect(service.capabilities("user-a")).resolves.toEqual({
      downloadLinkHours: 24,
    });
  });

  it("标准单图统一使用标准尺寸且不加水印", async () => {
    const result = await service.create("user-a", {
      assetId: "asset-a",
      format: "png",
      quality: "standard",
      sourceType: "asset",
    });

    expect(result).toMatchObject({
      format: "png",
      maxEdge: 2_048,
      status: "queued",
    });
    expect(result).not.toHaveProperty("watermark");
    expect(database.exportJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        designAssetId: "asset-a",
        maxEdge: 2_048,
        watermark: false,
      }),
    });
    expect(jobs.enqueue).toHaveBeenCalledWith("export-a");
  });

  it("所有用户均可导出原图高清且不加水印", async () => {
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
    });
    expect(database.exportJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ maxEdge: null, watermark: false }),
    });
  });

  it("系列 PDF 统一不加水印", async () => {
    const result = await service.create("user-a", {
      collectionId: "collection-a",
      format: "pdf",
      quality: "standard",
      sourceType: "collection",
    });

    expect(result).toMatchObject({ format: "pdf", maxEdge: 2_048 });
    expect(result).not.toHaveProperty("watermark");
    expect(database.exportJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        collectionId: "collection-a",
        watermark: false,
      }),
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
