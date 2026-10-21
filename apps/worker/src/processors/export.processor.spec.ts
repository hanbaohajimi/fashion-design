import { ExportFormat, ExportQuality, ExportStatus } from "@fashion/db";
import sharp from "sharp";
import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  const database = {
    studioDocument: { findUnique: vi.fn() },
    designAsset: { findMany: vi.fn() },
    $transaction: vi.fn(),
    workflowOutbox: {
      upsert: vi.fn().mockResolvedValue({ id: "cleanup-event" }),
      update: vi.fn(),
    },
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
    database.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(database),
    );
    database.exportJob.updateMany.mockResolvedValue({ count: 1 });
  });

  it("fails the entire PDF when any required Look image cannot be read", async () => {
    database.exportJob.findUnique.mockResolvedValue(
      exportRecord({
        format: ExportFormat.PDF,
        collection: {
          name: "Collection",
          dna: null,
          looks: [{ ordinal: 1, designAsset: { url: "broken" } }],
        },
      }),
    );
    const processExport = createExportProcessor({
      database: database as never,
      storage,
      download: async () => {
        throw new Error("private-storage-secret");
      },
    });
    await expect(processExport("export-a")).rejects.toMatchObject({
      code: "EXPORT_LOOK_IMAGE_UNAVAILABLE",
    });
    expect(storage.putTemporary).not.toHaveBeenCalled();
  });

  it("rejects an empty collection", async () => {
    database.exportJob.findUnique.mockResolvedValue(
      exportRecord({
        format: ExportFormat.PDF,
        collection: { name: "Empty", dna: null, looks: [] },
      }),
    );
    await expect(
      createExportProcessor({ database: database as never, storage })(
        "export-a",
      ),
    ).rejects.toMatchObject({ code: "EXPORT_COLLECTION_EMPTY" });
  });

  it("never removes Chinese text when the configured font is unavailable", async () => {
    vi.stubEnv("EXPORT_PDF_FONT_PATH", "missing-trial-font.ttf");
    const image = await source;
    database.exportJob.findUnique.mockResolvedValue(
      exportRecord({
        format: ExportFormat.PDF,
        collection: {
          name: "中文系列",
          dna: null,
          looks: [{ ordinal: 1, designAsset: { url: "image" } }],
        },
      }),
    );
    await expect(
      createExportProcessor({
        database: database as never,
        storage,
        download: async () => image,
      })("export-a"),
    ).rejects.toMatchObject({ code: "EXPORT_FONT_UNAVAILABLE" });
    expect(storage.putTemporary).not.toHaveBeenCalled();
  });

  const latinFont = [
    "C:/Windows/Fonts/arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
  ].find(existsSync);
  it.skipIf(!latinFont)(
    "rejects a loadable font whose glyphs cannot represent the Chinese title",
    async () => {
      if (!latinFont) throw new Error("Latin font fixture is unavailable");
      vi.stubEnv("EXPORT_PDF_FONT_PATH", latinFont);
      const image = await source;
      database.exportJob.findUnique.mockResolvedValue(
        exportRecord({
          format: ExportFormat.PDF,
          collection: {
            name: "中文系列",
            dna: null,
            looks: [{ ordinal: 1, designAsset: { url: "image" } }],
          },
        }),
      );
      await expect(
        createExportProcessor({
          database: database as never,
          storage,
          download: async () => image,
        })("export-a"),
      ).rejects.toMatchObject({ code: "EXPORT_FONT_UNAVAILABLE" });
      expect(storage.putTemporary).not.toHaveBeenCalled();
    },
  );

  it("refuses a renderer that no longer owns the lease", async () => {
    database.exportJob.updateMany.mockResolvedValueOnce({ count: 0 });
    database.exportJob.findUnique.mockResolvedValue(
      exportRecord({ status: ExportStatus.RUNNING }),
    );
    await expect(
      createExportProcessor({ database: database as never, storage })(
        "export-a",
      ),
    ).rejects.toMatchObject({ code: "EXPORT_LEASE_UNAVAILABLE" });
    expect(storage.putTemporary).not.toHaveBeenCalled();
  });

  it("旧任务即使记录了 watermark=true 也输出无水印 PNG", async () => {
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
    expect(corner.channels.every((channel) => channel.min > 160)).toBe(true);
    expect(storage.putTemporary).toHaveBeenCalledWith(
      expect.stringMatching(/^temporary\/exports\/user-a\/export-a-.*\.png$/u),
      expect.any(Buffer),
      "image/png",
    );
  });

  it("高清 JPG 保持原图长边且不叠加水印", async () => {
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
    expect(output.toString("latin1").match(/\/Type\s*\/Page\b/gu)).toHaveLength(
      2,
    );
    expect(storage.putTemporary).toHaveBeenCalledWith(
      expect.stringMatching(/^temporary\/exports\/user-a\/export-a-.*\.pdf$/u),
      expect.any(Buffer),
      "application/pdf",
    );
  });

  function techPackRevision(overrides: Record<string, unknown> = {}) {
    return {
      id: "pack-revision",
      projectId: "project-a",
      type: "TECH_PACK",
      revision: 2,
      payload: {
        name: "技术包",
        styleRevisionId: "style-revision",
        views: [{ kind: "front", assetId: "front", label: "正面" }],
      },
      styleRevision: {
        id: "style-revision",
        payload: {
          name: "旧款式名称",
          code: "ARCHIVE-001",
          category: "外套",
          sourceAssetId: "front",
        },
        style: {
          projectId: "project-a",
          code: "RENAMED-002",
          name: "已改名款式",
        },
      },
      ...overrides,
    };
  }

  it("exports the historical style snapshot rather than the renamed current style", async () => {
    database.exportJob.findUnique.mockResolvedValue(
      exportRecord({
        format: ExportFormat.PDF,
        studioRevisionId: "pack-revision",
      }),
    );
    database.studioDocument.findUnique.mockResolvedValue(techPackRevision());
    database.designAsset.findMany.mockResolvedValue([
      { id: "front", url: "https://asset.test/front.png" },
    ]);
    await createExportProcessor({
      database: database as never,
      storage,
      download: async () => source,
    })("export-a");
    expect(database.exportJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fileName: "ARCHIVE-001-tech-pack-r2.pdf",
          status: ExportStatus.SUCCEEDED,
        }),
      }),
    );
    const output = storage.putTemporary.mock.calls[0]?.[1] as Buffer;
    expect(output.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("renders a presentation set as a presentation PDF using the frozen style snapshot", async () => {
    database.exportJob.findUnique.mockResolvedValue(exportRecord({ format: ExportFormat.PDF, studioRevisionId: "presentation-revision" }));
    database.studioDocument.findUnique.mockResolvedValue(techPackRevision({ type: "PRESENTATION_SET", payload: { name: "商品展示包", styleRevisionId: "style-revision", status: "READY", items: [{ kind: "front", assetId: "front", reviewed: true }] } }));
    database.designAsset.findMany.mockResolvedValue([{ id: "front", url: "https://asset.test/front.png" }]);
    await createExportProcessor({ database: database as never, storage, download: async () => source })("export-a");
    expect(database.exportJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ fileName: "ARCHIVE-001-presentation-r2.pdf", status: ExportStatus.SUCCEEDED }) }));
    const output = storage.putTemporary.mock.calls[0]?.[1] as Buffer;
    expect(output.subarray(0, 5).toString()).toBe("%PDF-");
    expect(output.toString("latin1").match(/\/Type\s*\/Page\b/gu)).toHaveLength(2);
  });

  it("rejects a technical package linked to another project before downloading images", async () => {
    database.exportJob.findUnique.mockResolvedValue(
      exportRecord({
        format: ExportFormat.PDF,
        studioRevisionId: "pack-revision",
      }),
    );
    database.studioDocument.findUnique.mockResolvedValue(
      techPackRevision({ projectId: "project-b" }),
    );
    const download = vi.fn();
    await expect(
      createExportProcessor({ database: database as never, storage, download })(
        "export-a",
      ),
    ).rejects.toMatchObject({ code: "TECH_PACK_NOT_FOUND" });
    expect(download).not.toHaveBeenCalled();
    expect(storage.putTemporary).not.toHaveBeenCalled();
  });

  it("rejects a technical package whose payload disagrees with its immutable style link", async () => {
    database.exportJob.findUnique.mockResolvedValue(
      exportRecord({
        format: ExportFormat.PDF,
        studioRevisionId: "pack-revision",
      }),
    );
    database.studioDocument.findUnique.mockResolvedValue(
      techPackRevision({
        payload: { name: "技术包", styleRevisionId: "other-revision" },
      }),
    );
    await expect(
      createExportProcessor({ database: database as never, storage })(
        "export-a",
      ),
    ).rejects.toMatchObject({ code: "TECH_PACK_REVISION_MISMATCH" });
    expect(storage.putTemporary).not.toHaveBeenCalled();
  });

  it("records a safe actionable image error without storage credentials", async () => {
    database.exportJob.findUnique.mockResolvedValue(
      exportRecord({
        format: ExportFormat.PDF,
        studioRevisionId: "pack-revision",
      }),
    );
    database.studioDocument.findUnique.mockResolvedValue(techPackRevision());
    database.designAsset.findMany.mockResolvedValue([
      { id: "front", url: "https://asset.test/front.png" },
    ]);
    const download = vi
      .fn()
      .mockRejectedValue(new Error("private-storage-credential"));
    await expect(
      createExportProcessor({ database: database as never, storage, download })(
        "export-a",
      ),
    ).rejects.toMatchObject({ code: "TECH_PACK_IMAGE_UNAVAILABLE" });
    expect(database.exportJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          errorCode: "TECH_PACK_IMAGE_UNAVAILABLE",
          errorMessage: expect.not.stringContaining(
            "private-storage-credential",
          ),
        }),
      }),
    );
    expect(storage.putTemporary).not.toHaveBeenCalled();
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
