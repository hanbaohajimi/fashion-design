import { renderTechPackPdf } from "./tech-pack-pdf";
import { renderPresentationPdf } from "./presentation-pdf";
import { studioStyleSchema, studioTechPackSchema, studioPresentationSchema } from "@fashion/shared";
import {
  ExportFormat,
  ExportStatus,
  appendWorkflowOutbox,
  type PrismaClient,
} from "@fashion/db";
import { EXPORT_RETENTION_MS, PLATFORM_NAME } from "@fashion/shared";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import PDFDocument from "pdfkit";
import sharp from "sharp";

import type { ExportStorage, ThumbnailStorage } from "../storage";

interface PaletteColor {
  readonly hex: string;
  readonly name: string;
}

interface ExportProcessorDependencies {
  readonly database: PrismaClient;
  readonly download?: (url: string) => Promise<Buffer>;
  readonly now?: () => Date;
  readonly storage: ExportStorage & Partial<ThumbnailStorage>;
}

const exportInclude = {
  collection: {
    include: {
      dna: true,
      looks: {
        include: {
          designAsset: {
            select: { url: true },
          },
        },
        orderBy: { ordinal: "asc" as const },
      },
    },
  },
  designAsset: {
    select: { url: true },
  },
} as const;

export function createExportProcessor({
  database,
  download = downloadUrl,
  now = () => new Date(),
  storage,
}: ExportProcessorDependencies) {
  return async (
    exportId: string,
  ): Promise<{ expiresAt: Date; objectKey: string }> => {
    const leaseToken = randomUUID();
    const started = now();
    const deadline = started.getTime() + 5 * 60_000;
    const claimed = await database.exportJob.updateMany({
      where: {
        id: exportId,
        OR: [
          { status: ExportStatus.QUEUED },
          { status: ExportStatus.FAILED },
          {
            status: ExportStatus.RUNNING,
            OR: [
              { leaseExpiresAt: { lte: started } },
              {
                leaseExpiresAt: null,
                updatedAt: { lt: new Date(started.getTime() - 60_000) },
              },
            ],
          },
        ],
      },
      data: {
        errorCode: null,
        errorMessage: null,
        startedAt: now(),
        status: ExportStatus.RUNNING,
        leaseToken,
        leaseExpiresAt: new Date(started.getTime() + 60_000),
      },
    });
    if (!claimed.count) {
      const current = await database.exportJob.findUnique({
        where: { id: exportId },
      });
      if (
        current?.status === ExportStatus.SUCCEEDED &&
        current.objectKey &&
        current.expiresAt
      )
        return { objectKey: current.objectKey, expiresAt: current.expiresAt };
      throw exportFailure(
        "EXPORT_LEASE_UNAVAILABLE",
        "导出任务已由其他执行处理或已结束",
      );
    }
    let leaseLost = false;
    let heartbeatFlight: Promise<unknown> | undefined;
    const heartbeat = setInterval(() => {
      if (heartbeatFlight) return;
      heartbeatFlight = database.exportJob
        .updateMany({
          where: { id: exportId, leaseToken, status: ExportStatus.RUNNING },
          data: {
            leaseExpiresAt: new Date(
              Math.min(deadline, now().getTime() + 60_000),
            ),
          },
        })
        .then((result) => {
          if (!result.count) leaseLost = true;
        })
        .catch(() => {
          leaseLost = true;
        })
        .finally(() => {
          heartbeatFlight = undefined;
        });
    }, 20_000);
    heartbeat.unref();
    let writtenKey: string | undefined;

    try {
      const exportJob = await database.exportJob.findUnique({
        where: { id: exportId },
        include: exportInclude,
      });
      if (!exportJob) {
        throw exportFailure("EXPORT_NOT_FOUND", "导出任务不存在或已被清理");
      }

      const rendered = exportJob.studioRevisionId
        ? await renderStudioTechPack(
            exportJob.studioRevisionId,
            exportJob.projectId,
            database,
            (stored) => downloadStored(stored, storage, download),
          )
        : exportJob.format === ExportFormat.PDF
          ? await renderLookbook(exportJob, (stored) =>
              downloadStored(stored, storage, download),
            )
          : await renderImage(exportJob, (stored) =>
              downloadStored(stored, storage, download),
            );
      const extension = exportJob.format.toLowerCase();
      if (leaseLost || now().getTime() >= deadline)
        throw exportFailure("EXPORT_TIMEOUT", "导出超过处理期限，请重试");
      const objectKey = `temporary/exports/${exportJob.userId}/${exportJob.id}-${leaseToken}.${extension}`;
      writtenKey = objectKey;
      await database.$transaction((tx) =>
        appendWorkflowOutbox(tx, {
          projectId: exportJob.projectId,
          eventKey: `export:${exportJob.id}:${leaseToken}:cleanup`,
          eventType: "export.cleanup",
          payload: { exportId: exportJob.id, objectKey },
        }).then((event) =>
          tx.workflowOutbox.update({
            where: { id: event.id },
            data: {
              availableAt: new Date(now().getTime() + EXPORT_RETENTION_MS),
            },
          }),
        ),
      );
      await storage.putTemporary(objectKey, rendered.body, rendered.mimeType);

      const completedAt = now();
      const expiresAt = new Date(completedAt.getTime() + EXPORT_RETENTION_MS);
      const committed = await database.exportJob.updateMany({
        where: {
          id: exportJob.id,
          leaseToken,
          status: ExportStatus.RUNNING,
          leaseExpiresAt: { gt: completedAt },
        },
        data: {
          completedAt,
          expiresAt,
          fileName: rendered.fileName,
          mimeType: rendered.mimeType,
          objectKey,
          sizeBytes: rendered.body.byteLength,
          status: ExportStatus.SUCCEEDED,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      if (!committed.count)
        throw exportFailure("EXPORT_LEASE_LOST", "导出执行已被恢复任务替代");
      return { expiresAt, objectKey };
    } catch (error) {
      const failure = toExportFailure(error);
      await database.exportJob
        .updateMany({
          where: { id: exportId, leaseToken, status: ExportStatus.RUNNING },
          data: {
            errorCode: failure.code,
            errorMessage: failure.message,
            status: ExportStatus.FAILED,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        })
        .catch(() => undefined);
      // Unique per-lease keys prevent an old renderer from deleting or overwriting a newer result.
      if (writtenKey) {
        const current = await database.exportJob
          .findUnique({
            where: { id: exportId },
            select: { objectKey: true, status: true },
          })
          .catch(() => null);
        if (current && current.objectKey !== writtenKey)
          await storage.delete(writtenKey).catch(() => undefined);
      }
      throw error;
    } finally {
      clearInterval(heartbeat);
      await heartbeatFlight;
    }
  };
}

async function downloadStored(
  stored: string,
  storage: Partial<ThumbnailStorage>,
  download: (url: string) => Promise<Buffer>,
): Promise<Buffer> {
  if (!stored.startsWith("s3://")) return download(stored);
  if (!storage.get) {
    throw exportFailure("EXPORT_STORAGE_UNAVAILABLE", "无法读取私有设计资产");
  }
  return storage.get(stored.slice("s3://".length));
}

export async function cleanupExport(
  database: PrismaClient,
  storage: ExportStorage,
  exportId: string,
  scheduledObjectKey?: string,
  now = new Date(),
): Promise<void> {
  const exportJob = await database.exportJob.findUnique({
    where: { id: exportId },
    select: { expiresAt: true, objectKey: true, status: true },
  });
  if (!exportJob) {
    if (scheduledObjectKey) await storage.delete(scheduledObjectKey);
    return;
  }
  if (
    exportJob.status !== ExportStatus.EXPIRED &&
    exportJob.expiresAt &&
    exportJob.expiresAt > now
  ) {
    return;
  }
  const objectKey = exportJob.objectKey ?? scheduledObjectKey;
  if (objectKey) {
    await storage.delete(objectKey);
  }
  await database.exportJob.update({
    where: { id: exportId },
    data: {
      objectKey: null,
      status: ExportStatus.EXPIRED,
    },
  });
}

export async function cleanupExpiredExports(
  database: PrismaClient,
  storage: ExportStorage,
  now = new Date(),
): Promise<number> {
  const expired = await database.exportJob.findMany({
    where: {
      expiresAt: { lte: now },
      objectKey: { not: null },
      status: { in: [ExportStatus.SUCCEEDED, ExportStatus.EXPIRED] },
    },
    select: { id: true, objectKey: true },
    take: 100,
  });
  const results = await Promise.allSettled(
    expired.map((exportJob) =>
      cleanupExport(
        database,
        storage,
        exportJob.id,
        exportJob.objectKey ?? undefined,
        now,
      ),
    ),
  );
  return results.filter((result) => result.status === "fulfilled").length;
}

export async function markExportFailed(
  database: PrismaClient,
  exportId: string,
  message: string,
): Promise<void> {
  await database.exportJob.updateMany({
    where: {
      id: exportId,
      status: { in: [ExportStatus.QUEUED, ExportStatus.RUNNING] },
      OR: [{ leaseToken: null }, { leaseExpiresAt: { lte: new Date() } }],
    },
    data: {
      errorCode: "EXPORT_RENDER_FAILED",
      errorMessage: message.slice(0, 1_000),
      status: ExportStatus.FAILED,
    },
  });
}

async function renderStudioTechPack(
  revisionId: string,
  projectId: string,
  database: PrismaClient,
  download: (url: string) => Promise<Buffer>,
) {
  const revision = await database.studioDocument.findUnique({
    where: { id: revisionId },
    include: { styleRevision: { include: { style: true } } },
  });
  if (
    !revision ||
    !["TECH_PACK", "PRESENTATION_SET"].includes(revision.type) ||
    !revision.styleRevision ||
    revision.projectId !== projectId ||
    revision.styleRevision.style.projectId !== projectId
  ) {
    throw exportFailure("TECH_PACK_NOT_FOUND", "技术包修订或款式已不存在");
  }
  const presentation = revision.type === "PRESENTATION_SET";
  const payload = presentation ? studioPresentationSchema.parse(revision.payload) : studioTechPackSchema.parse(revision.payload);
  if (payload.styleRevisionId !== revision.styleRevision.id) {
    throw exportFailure(
      "TECH_PACK_REVISION_MISMATCH",
      "技术包绑定的款式修订不一致",
    );
  }
  // Historical exports use the immutable style snapshot, even after the style is renamed.
  const style = studioStyleSchema.parse(revision.styleRevision.payload);
  const items = "items" in payload ? payload.items : payload.views;
  const ids = [...new Set(items.map((view) => view.assetId))];
  const assets = await database.designAsset.findMany({
    where: { id: { in: ids }, projectId: revision.projectId },
  });
  if (assets.length !== ids.length) {
    throw exportFailure("TECH_PACK_IMAGE_MISSING", "技术包引用的图片不可用");
  }
  const images = await Promise.all(
    assets.map(async (asset) => {
      try {
        return { id: asset.id, body: await download(asset.url) };
      } catch {
        throw exportFailure(
          "TECH_PACK_IMAGE_UNAVAILABLE",
          "技术包视图图片无法读取，请检查原图后重新导出",
        );
      }
    }),
  );
  const body = await (presentation ? renderPresentationPdf : renderTechPackPdf)(
    {
      payload,
      revision: revision.revision,
      styleCode: style.code,
      styleName: style.name,
      images,
    },
    useCjkFont,
  );
  return {
    body,
    fileName:
      safeFileName(style.code) + (presentation ? "-presentation-r" : "-tech-pack-r") + revision.revision + ".pdf",
    mimeType: "application/pdf",
  };
}

async function renderImage(
  exportJob: {
    readonly designAsset: { readonly url: string } | null;
    readonly format: ExportFormat;
    readonly id: string;
    readonly maxEdge: number | null;
  },
  download: (url: string) => Promise<Buffer>,
) {
  if (!exportJob.designAsset) {
    throw exportFailure("EXPORT_ASSET_MISSING", "待导出的原始 Look 已不存在");
  }
  const source = await download(exportJob.designAsset.url);
  let pipeline = sharp(source, { failOn: "error" }).rotate();
  if (exportJob.maxEdge) {
    pipeline = pipeline.resize({
      fit: "inside",
      height: exportJob.maxEdge,
      width: exportJob.maxEdge,
      withoutEnlargement: true,
    });
  }
  const prepared = await pipeline.toBuffer();

  const format = exportJob.format;
  const body =
    format === ExportFormat.PNG
      ? await sharp(prepared).png({ compressionLevel: 9 }).toBuffer()
      : await sharp(prepared)
          .flatten({ background: "#f5f2eb" })
          .jpeg({ chromaSubsampling: "4:4:4", quality: 92 })
          .toBuffer();
  return {
    body,
    fileName: `look-${exportJob.id.slice(0, 8)}.${format.toLowerCase()}`,
    mimeType: format === ExportFormat.PNG ? "image/png" : "image/jpeg",
  };
}

async function renderLookbook(
  exportJob: {
    readonly collection: {
      readonly dna: { readonly palette: unknown } | null;
      readonly looks: readonly {
        readonly designAsset: { readonly url: string };
        readonly garmentTypeLabel: string | null;
        readonly ordinal: number;
      }[];
      readonly name: string;
    } | null;
    readonly id: string;
  },
  download: (url: string) => Promise<Buffer>,
) {
  if (!exportJob.collection) {
    throw exportFailure("EXPORT_COLLECTION_MISSING", "待导出的系列已不存在");
  }
  const collection = exportJob.collection;
  if (!collection.looks.length)
    throw exportFailure("EXPORT_COLLECTION_EMPTY", "系列尚无可导出的 Look");
  const lookImages: Buffer[] = [];
  for (let start = 0; start < collection.looks.length; start += 2) {
    const images = await Promise.all(
      collection.looks.slice(start, start + 2).map(async (look) => {
        try {
          const source = await download(look.designAsset.url);
          return await sharp(source)
            .rotate()
            .resize({
              fit: "inside",
              height: 1_600,
              width: 1_200,
              withoutEnlargement: true,
            })
            .flatten({ background: "#f5f2eb" })
            .jpeg({ quality: 90 })
            .toBuffer();
        } catch {
          throw exportFailure(
            "EXPORT_LOOK_IMAGE_UNAVAILABLE",
            `LOOK ${look.ordinal} 图片无法读取或解码，请检查原图后重新导出`,
          );
        }
      }),
    );
    lookImages.push(...images);
  }
  const body = await createLookbookPdf({
    collectionName: collection.name,
    looks: collection.looks.map((look, index) => ({
      image: lookImages[index] ?? null,
      garmentTypeLabel: look.garmentTypeLabel,
      ordinal: look.ordinal,
    })),
    palette: parsePalette(collection.dna?.palette),
  });
  return {
    body,
    fileName: `${safeFileName(collection.name)}-lookbook.pdf`,
    mimeType: "application/pdf",
  };
}

async function createLookbookPdf(input: {
  readonly collectionName: string;
  readonly looks: readonly {
    readonly garmentTypeLabel: string | null;
    readonly image: Buffer | null;
    readonly ordinal: number;
  }[];
  readonly palette: readonly PaletteColor[];
}): Promise<Buffer> {
  const document = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    info: {
      Author: PLATFORM_NAME,
      Subject: "Collection Lookbook",
      Title: input.collectionName,
    },
    layout: "landscape",
    margin: 42,
    size: "A4",
  });
  const bodyFont = useCjkFont(
    document,
    input.collectionName +
      input.looks.map((look) => look.garmentTypeLabel ?? "").join(""),
  );
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

  document.addPage();
  document
    .fillColor("#161616")
    .fontSize(10)
    .text("COLLECTION / LOOKBOOK", 42, 42, { characterSpacing: 1.8 });
  document.fontSize(31).text(input.collectionName, 42, 88, {
    width: 650,
  });
  document
    .fillColor("#66645f")
    .fontSize(10)
    .text(`${String(input.looks.length).padStart(2, "0")} LOOKS`, 42, 151);
  drawPalette(document, input.palette, 42, 198);
  document
    .fillColor("#66645f")
    .fontSize(9)
    .text("DNA / COLOR PALETTE", 42, 276, { characterSpacing: 1.4 });

  const looksPerPage = 4;
  for (let start = 0; start < input.looks.length; start += looksPerPage) {
    document.addPage();
    document
      .font(bodyFont)
      .fillColor("#161616")
      .fontSize(10)
      .text(
        `${input.collectionName} / LOOKS ${start + 1}-${Math.min(start + looksPerPage, input.looks.length)}`,
        42,
        28,
      );
    input.looks.slice(start, start + looksPerPage).forEach((look, index) => {
      const column = index % 4;
      const x = 42 + column * 190;
      const y = 60;
      const width = 170;
      const height = 455;
      document.rect(x, y, width, height).fill("#eeeae2");
      if (look.image) {
        document.image(look.image, x, y, {
          align: "center",
          fit: [width, height],
          valign: "center",
        });
      } else {
        document
          .fillColor("#77736c")
          .fontSize(9)
          .text("IMAGE UNAVAILABLE", x, y + height / 2 - 6, {
            align: "center",
            width,
          });
      }
      document
        .fillColor("#161616")
        .fontSize(9)
        .text(`LOOK ${String(look.ordinal).padStart(2, "0")}`, x, 526, {
          width,
        });
      if (look.garmentTypeLabel) {
        document
          .font(bodyFont)
          .fillColor("#66645f")
          .fontSize(8)
          .text(look.garmentTypeLabel, x, 526, {
            align: "right",
            width,
          });
      }
    });
  }

  const range = document.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page += 1) {
    document.switchToPage(page);
    document
      .fillColor("#77736c")
      .fontSize(8)
      .text(
        `${String(page + 1).padStart(2, "0")} / ${String(range.count).padStart(2, "0")}`,
        42,
        540,
        { align: "right", height: 12, lineBreak: false, width: 758 },
      );
    document.font(bodyFont);
  }
  document.end();
  return finished;
}

function drawPalette(
  document: PDFKit.PDFDocument,
  palette: readonly PaletteColor[],
  x: number,
  y: number,
): void {
  const colors =
    palette.length > 0
      ? palette.slice(0, 8)
      : [{ hex: "#d9d5cb", name: "UNDEFINED" }];
  colors.forEach((color, index) => {
    document.rect(x + index * 72, y, 64, 54).fill(color.hex);
    document
      .fillColor("#4f4d48")
      .fontSize(7)
      .text(color.hex.toUpperCase(), x + index * 72, y + 60, {
        width: 64,
      });
  });
}

function parsePalette(value: unknown): readonly PaletteColor[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      typeof item === "object" &&
      item !== null &&
      "hex" in item &&
      typeof item.hex === "string" &&
      /^#[0-9a-f]{6}$/iu.test(item.hex)
    ) {
      return [
        {
          hex: item.hex,
          name:
            "name" in item && typeof item.name === "string" ? item.name : "",
        },
      ];
    }
    return [];
  });
}

function useCjkFont(document: PDFKit.PDFDocument, text = ""): string {
  const requiredCharacters = [
    ...new Set(
      [...text].filter((character) => (character.codePointAt(0) ?? 0) > 127),
    ),
  ];
  const configured = process.env.EXPORT_PDF_FONT_PATH?.trim();
  const candidates = configured
    ? [configured]
    : [
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/Deng.ttf",
        "C:/Windows/Fonts/msyh.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
      ].filter((candidate): candidate is string => Boolean(candidate));
  for (const [index, fontPath] of candidates.entries()) {
    if (!existsSync(fontPath)) continue;
    const fontName = `LookbookCJK${index}`;
    try {
      const family = process.env.EXPORT_PDF_FONT_FAMILY?.trim();
      if (family && /\.ttc$/iu.test(fontPath)) {
        document.registerFont(fontName, fontPath, family);
      } else {
        document.registerFont(fontName, fontPath);
      }
      document.font(fontName);
      // PDFKit's embedded font wraps fontkit; loading a Latin font alone is insufficient.
      const embedded = (
        document as PDFKit.PDFDocument & {
          _font?: {
            font?: { hasGlyphForCodePoint?: (codePoint: number) => boolean };
          };
        }
      )._font?.font;
      if (
        requiredCharacters.some(
          (character) =>
            !embedded?.hasGlyphForCodePoint?.(character.codePointAt(0) ?? 0),
        )
      )
        continue;
      return fontName;
    } catch {
      continue;
    }
  }
  document.font("Helvetica");
  if (requiredCharacters.length)
    throw exportFailure(
      "EXPORT_FONT_UNAVAILABLE",
      "导出字体无法完整显示所需文字，请配置支持相应字符的 EXPORT_PDF_FONT_PATH",
    );
  return "Helvetica";
}

export function validateExportFont(): void {
  const document = new PDFDocument({ autoFirstPage: false });
  useCjkFont(document, "服装设计中文");
  document.end();
}

function safeFileName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-")
    .replace(/\s+/gu, "-")
    .slice(0, 80);
  return sanitized || "collection";
}

async function downloadUrl(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw exportFailure(
      "EXPORT_SOURCE_DOWNLOAD_FAILED",
      `原图读取失败（HTTP ${response.status}）`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

function exportFailure(
  code: string,
  message: string,
): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function toExportFailure(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    return {
      code:
        "code" in error && typeof error.code === "string"
          ? error.code
          : "EXPORT_RENDER_FAILED",
      message: error.message.slice(0, 1_000),
    };
  }
  return { code: "EXPORT_RENDER_FAILED", message: "导出渲染失败" };
}
