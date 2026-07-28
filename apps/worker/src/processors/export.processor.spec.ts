import {
  ExportFormat,
  ExportQuality,
  ExportStatus,
} from "@fashion/db";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanupExport,
  cleanupExpiredExports,
  createExportProcessor,
} from "./export.processor";

function exportRecord(overrides: Record<string, unknown> = {}) {
  return {
    collection: null,
    collectionId: null,
    completedAt: null,
    createdAt: new Date("2026-07-28T08:00:00.000Z"),
    designAsset: { url: "https://asset.test/look.png" },
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

describe("export processor", () => {
  const database = {
    exportJob: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const storage = {
    delete: vi.fn(),
    putTemporary: vi.fn(),
  };
  const source = sharp({
    create: {
      background: "#d9cab5",
      channels: 3,
      height: 1_800,
      width: 2_400,
    },
  })
    .png()
    .toBuffer();

  beforeEach(() => {
    vi.clearAllMocks();
    database.exportJob.update.mockResolvedValue(exportRecord());
  });

  it("Free PNG 在 worker 限制分辨率并叠加水印", async () => {
    database.exportJob.findUnique.mockResolvedValue(exportRecord());
    const processExport = createExportProcessor({
      database: database as never,
      download: async () => source,
      now: () => new Date("2026-07-28T08:00:00.000Z"),
      storage,
    });

    await processExport("export-a");

    const output = storage.putTemporary.mock.calls[0]?.[1] as Buffer;
    const metadata = await sharp(output).metadata();
    const corner = await sharp(output)
      .extract({
        height: 120,
        left: (metadata.width ?? 1_600) - 520,
        top: (metadata.height ?? 1_200) - 120,
        width: 520,
      })
      .stats();
    expect(metadata).toMatchObject({ format: "png", width: 1_600 });
    expect(corner.channels[0]?.min).toBeLessThan(80);
    expect(storage.putTemporary).toHaveBeenCalledWith(
      "temporary/exports/user-a/export-a.png",
      expect.any(Buffer),
      "image/png",
    );
  });

  it("Pro JPG 保持原图长边且不叠加水印", async () => {
    database.exportJob.findUnique.mockResolvedValue(
      exportRecord({
        format: ExportFormat.JPG,
        maxEdge: null,
        quality: ExportQuality.HIGH,
        watermark: false,
      }),
    );
    const processExport = createExportProcessor({
      database: database as never,
      download: async () => source,
      storage,
    });

    await processExport("export-a");

    const output = storage.putTemporary.mock.calls[0]?.[1] as Buffer;
    expect(await sharp(output).metadata()).toMatchObject({
      format: "jpeg",
      width: 2_400,
    });
  });

  it("Lookbook PDF 含系列 Look 网格并输出 PDF", async () => {
    database.exportJob.findUnique.mockResolvedValue(
      exportRecord({
        collection: {
          dna: {
            palette: [
              { hex: "#112233", name: "墨蓝" },
              { hex: "#c8a978", name: "沙金" },
            ],
          },
          looks: [
            {
              designAsset: { url: "https://asset.test/1.png" },
              ordinal: 1,
            },
            {
              designAsset: { url: "https://asset.test/2.png" },
              ordinal: 2,
            },
            {
              designAsset: { url: "https://asset.test/3.png" },
              ordinal: 3,
            },
          ],
          name: "静谧结构",
        },
        collectionId: "collection-a",
        designAsset: null,
        designAssetId: null,
        format: ExportFormat.PDF,
      }),
    );
    const processExport = createExportProcessor({
      database: database as never,
      download: async () => source,
      storage,
    });

    await processExport("export-a");

    const output = storage.putTemporary.mock.calls[0]?.[1] as Buffer;
    expect(output.subarray(0, 5).toString()).toBe("%PDF-");
    expect(output.byteLength).toBeGreaterThan(5_000);
    expect(storage.putTemporary).toHaveBeenCalledWith(
      "temporary/exports/user-a/export-a.pdf",
      expect.any(Buffer),
      "application/pdf",
    );
  });

  it("清理任务删除临时对象并标记过期", async () => {
    database.exportJob.findUnique.mockResolvedValue({
      expiresAt: new Date("2026-07-28T07:00:00.000Z"),
      objectKey: "temporary/exports/user-a/export-a.png",
      status: ExportStatus.SUCCEEDED,
    });

    await cleanupExport(
      database as never,
      storage,
      "export-a",
      undefined,
      new Date("2026-07-28T08:00:00.000Z"),
    );

    expect(storage.delete).toHaveBeenCalledWith(
      "temporary/exports/user-a/export-a.png",
    );
    expect(database.exportJob.update).toHaveBeenCalledWith({
      where: { id: "export-a" },
      data: { objectKey: null, status: ExportStatus.EXPIRED },
    });
  });

  it("过期扫描会兜底清理已标记过期但仍残留的对象", async () => {
    database.exportJob.findMany.mockResolvedValue([
      {
        id: "export-a",
        objectKey: "temporary/exports/user-a/export-a.png",
      },
    ]);
    database.exportJob.findUnique.mockResolvedValue({
      expiresAt: new Date("2026-07-28T07:00:00.000Z"),
      objectKey: "temporary/exports/user-a/export-a.png",
      status: ExportStatus.EXPIRED,
    });

    const count = await cleanupExpiredExports(
      database as never,
      storage,
      new Date("2026-07-28T08:00:00.000Z"),
    );

    expect(count).toBe(1);
    expect(storage.delete).toHaveBeenCalledOnce();
  });
});
