import { ExportFormat, ExportQuality, ExportStatus } from "@fashion/db";
import { ForbiddenException } from "@nestjs/common";
import type { ProjectAccessPolicy } from "../studio/project-access.policy";
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
    project: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null, workspace: { ownerId: "user-a" } }) },
    workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(),
    workflowOutbox: { upsert: vi.fn() },
    collection: { findUnique: vi.fn() },
    designAsset: { findUnique: vi.fn() },
    exportJob: {
      findMany: vi.fn(),
      count: vi.fn(),
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
    database.$transaction.mockImplementation(
      (operation: (tx: unknown) => unknown) => operation(database),
    );
    jobs.enqueue.mockResolvedValue(undefined);
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

  it("后台尚未清理时，历史列表仍按实际期限展示已过期导出", async () => {
    database.exportJob.findMany.mockResolvedValue([
      exportRecord({ id: "expired", status: ExportStatus.SUCCEEDED, expiresAt: new Date(Date.now() - 1_000) }),
      exportRecord({ id: "available", status: ExportStatus.SUCCEEDED, expiresAt: new Date(Date.now() + 60_000) }),
      exportRecord({ id: "failed", status: ExportStatus.FAILED, expiresAt: new Date(0) }),
    ]);
    database.exportJob.count.mockResolvedValue(3);
    const result = await service.list("user-a", {
      projectId: "project-a", sourceType: "asset", sourceId: "asset-a", page: 1, limit: 20,
    });
    expect(result.items.map((item) => item.status)).toEqual(["expired", "succeeded", "failed"]);
    expect(database.exportJob.update).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("persists dispatch before attempting Redis and remains queued when Redis is unavailable", async () => {
    jobs.enqueue.mockRejectedValueOnce(new Error("Redis offline"));
    const result = await service.create("user-a", {
      sourceType: "asset",
      assetId: "asset-a",
      format: "png",
      quality: "standard",
    });
    expect(result.status).toBe("queued");
    expect(database.workflowOutbox.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ eventType: "export.dispatch" }),
      }),
    );
    expect(
      database.workflowOutbox.upsert.mock.invocationCallOrder[0],
    ).toBeLessThan(jobs.enqueue.mock.invocationCallOrder[0] ?? 0);
  });

  it("replays one request key and rejects different parameters", async () => {
    database.exportJob.findUnique.mockResolvedValueOnce(null);
    const input = {
      sourceType: "asset",
      assetId: "asset-a",
      format: "png",
      quality: "standard",
    } as const;
    await service.create("user-a", input, "request-key");
    const created = database.exportJob.create.mock.calls[0]?.[0].data;
    database.exportJob.findUnique.mockResolvedValue(exportRecord(created));
    await service.create("user-a", input, "request-key");
    expect(database.exportJob.create).toHaveBeenCalledTimes(1);
    await expect(
      service.create("user-a", { ...input, format: "jpg" }, "request-key"),
    ).rejects.toThrow("该导出编号已用于不同参数");
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

  it("成功任务返回稳定的认证下载入口且不提前签发存储链接", async () => {
    database.exportJob.findUnique.mockResolvedValue(
      exportRecord({
        expiresAt: new Date(Date.now() + 86_400_000),
        fileName: "look.png",
        objectKey: "temporary/exports/user-a/export-a.png",
        status: ExportStatus.SUCCEEDED,
      }),
    );
    const result = await service.get("user-a", "export-a");
    expect(result.downloadUrl).toBe("/api/exports/export-a/content");
    expect(storage.createDownloadUrl).not.toHaveBeenCalled();
  });

  it("保留期仍为24小时，每次下载仅签发最多60秒的存储地址", async () => {
    database.exportJob.findUnique.mockResolvedValue(
      exportRecord({
        expiresAt: new Date(Date.now() + 86_400_000),
        fileName: "look.png",
        objectKey: "temporary/exports/user-a/export-a.png",
        status: ExportStatus.SUCCEEDED,
      }),
    );
    storage.createDownloadUrl.mockResolvedValue(
      "https://download.test/short-signature",
    );
    await expect(service.downloadUrl("user-a", "export-a")).resolves.toBe(
      "https://download.test/short-signature",
    );
    expect(storage.createDownloadUrl).toHaveBeenCalledWith(
      "temporary/exports/user-a/export-a.png",
      60,
      "look.png",
    );
    database.exportJob.findUnique.mockResolvedValue(
      exportRecord({
        expiresAt: new Date(Date.now() + 5_000),
        fileName: "look.png",
        objectKey: "temporary/exports/user-a/export-a.png",
        status: ExportStatus.SUCCEEDED,
      }),
    );
    await service.downloadUrl("user-a", "export-a");
    const seconds = storage.createDownloadUrl.mock.calls[1]?.[1];
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(5);
  });

  it("已取得的认证入口在成员撤销后不能签出新下载地址", async () => {
    const access = { require: vi.fn().mockResolvedValue({ role: "VIEWER" }) };
    const team = new ExportsService(
      database as never,
      jobs,
      storage,
      access as unknown as ProjectAccessPolicy,
    );
    database.exportJob.findUnique.mockResolvedValue(
      exportRecord({
        expiresAt: new Date(Date.now() + 86_400_000),
        fileName: "look.png",
        objectKey: "temporary/exports/user-a/export-a.png",
        status: ExportStatus.SUCCEEDED,
      }),
    );
    expect((await team.get("member", "export-a")).downloadUrl).toBe(
      "/api/exports/export-a/content",
    );
    access.require.mockRejectedValue(new ForbiddenException("member revoked"));
    await expect(team.downloadUrl("member", "export-a")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(access.require).toHaveBeenLastCalledWith(
      "member",
      "project-a",
      "read",
    );
    expect(storage.createDownloadUrl).not.toHaveBeenCalled();
  });

  it("未就绪或已过期的下载入口不会签名", async () => {
    database.exportJob.findUnique.mockResolvedValue(exportRecord());
    await expect(
      service.downloadUrl("user-a", "export-a"),
    ).rejects.toMatchObject({ status: 409 });
    database.exportJob.findUnique.mockResolvedValue(
      exportRecord({
        expiresAt: new Date(Date.now() - 1_000),
        status: ExportStatus.SUCCEEDED,
        objectKey: "temporary/export-a.png",
        fileName: "look.png",
      }),
    );
    database.exportJob.update.mockResolvedValue(
      exportRecord({ status: ExportStatus.EXPIRED }),
    );
    await expect(
      service.downloadUrl("user-a", "export-a"),
    ).rejects.toMatchObject({ status: 410 });
    expect(storage.createDownloadUrl).not.toHaveBeenCalled();
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
