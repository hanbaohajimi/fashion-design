import {
  ExportFormat,
  ExportStatus,
  type PrismaClient,
} from "@fashion/db";
import { EXPORT_RETENTION_MS, PLATFORM_NAME } from "@fashion/shared";
import { existsSync } from "node:fs";
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
    await database.exportJob.update({
      where: { id: exportId },
      data: {
        errorCode: null,
        errorMessage: null,
        startedAt: now(),
        status: ExportStatus.RUNNING,
      },
    });

    try {
      const exportJob = await database.exportJob.findUnique({
        where: { id: exportId },
        include: exportInclude,
      });
      if (!exportJob) {
        throw exportFailure(
          "EXPORT_NOT_FOUND",
          "导出任务不存在或已被清理",
        );
      }

      const rendered =
        exportJob.format === ExportFormat.PDF
          ? await renderLookbook(exportJob, (stored) =>
              downloadStored(stored, storage, download),
            )
          : await renderImage(exportJob, (stored) =>
              downloadStored(stored, storage, download),
            );
      const extension = exportJob.format.toLowerCase();
      const objectKey = `temporary/exports/${exportJob.userId}/${exportJob.id}.${extension}`;
      await storage.putTemporary(
        objectKey,
        rendered.body,
        rendered.mimeType,
      );

      const completedAt = now();
      const expiresAt = new Date(
        completedAt.getTime() + EXPORT_RETENTION_MS,
      );
      await database.exportJob.update({
        where: { id: exportJob.id },
        data: {
          completedAt,
          expiresAt,
          fileName: rendered.fileName,
          mimeType: rendered.mimeType,
          objectKey,
          sizeBytes: rendered.body.byteLength,
          status: ExportStatus.SUCCEEDED,
        },
      });
      return { expiresAt, objectKey };
    } catch (error) {
      const failure = toExportFailure(error);
      await database.exportJob
        .update({
          where: { id: exportId },
          data: {
            errorCode: failure.code,
            errorMessage: failure.message,
            status: ExportStatus.FAILED,
          },
        })
        .catch(() => undefined);
      throw error;
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
    throw exportFailure(
      "EXPORT_STORAGE_UNAVAILABLE",
      "无法读取私有设计资产",
    );
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
    },
    data: {
      errorCode: "EXPORT_RENDER_FAILED",
      errorMessage: message.slice(0, 1_000),
      status: ExportStatus.FAILED,
    },
  });
}

async function renderImage(
  exportJob: {
    readonly designAsset: { readonly url: string } | null;
    readonly format: ExportFormat;
    readonly id: string;
    readonly maxEdge: number | null;
    readonly watermark: boolean;
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
  let prepared: Buffer = await pipeline.toBuffer();
  if (exportJob.watermark) {
    prepared = await applyWatermark(prepared);
  }

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

async function applyWatermark(source: Buffer): Promise<Buffer> {
  const metadata = await sharp(source).metadata();
  const imageWidth = metadata.width ?? 1_600;
  const imageHeight = metadata.height ?? 1_200;
  const overlayWidth = Math.min(
    imageWidth,
    Math.max(80, Math.min(520, Math.round(imageWidth * 0.44))),
  );
  const overlayHeight = Math.min(
    imageHeight,
    Math.max(18, Math.round(overlayWidth * 0.13)),
  );
  const fontSize = Math.max(7, Math.round(overlayHeight * 0.34));
  const svg = Buffer.from(`
    <svg width="${overlayWidth}" height="${overlayHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" rx="4" fill="rgba(10,10,10,0.68)"/>
      <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
        fill="#ffffff" font-family="Arial, sans-serif" font-size="${fontSize}"
        font-weight="700" letter-spacing="1.4">FASHION DESIGN · FREE</text>
    </svg>
  `);
  return sharp(source)
    .composite([{ input: svg, gravity: "southeast" }])
    .toBuffer();
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
    readonly watermark: boolean;
  },
  download: (url: string) => Promise<Buffer>,
) {
  if (!exportJob.collection) {
    throw exportFailure("EXPORT_COLLECTION_MISSING", "待导出的系列已不存在");
  }
  const collection = exportJob.collection;
  const lookImages = await Promise.all(
    collection.looks.map(async (look) => {
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
        return null;
      }
    }),
  );
  const body = await createLookbookPdf({
    collectionName: collection.name,
    looks: collection.looks.map((look, index) => ({
      image: lookImages[index] ?? null,
      garmentTypeLabel: look.garmentTypeLabel,
      ordinal: look.ordinal,
    })),
    palette: parsePalette(collection.dna?.palette),
    watermark: exportJob.watermark,
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
  readonly watermark: boolean;
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
  const bodyFont = useCjkFont(document);
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
  document
    .fontSize(31)
    .text(pdfDisplayText(input.collectionName, bodyFont), 42, 88, {
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
  if (input.watermark) drawPdfWatermark(document, bodyFont);

  const looksPerPage = 4;
  for (let start = 0; start < input.looks.length; start += looksPerPage) {
    document.addPage();
    document
      .font(bodyFont)
      .fillColor("#161616")
      .fontSize(10)
      .text(
        `${pdfDisplayText(input.collectionName, bodyFont)} / LOOKS ${start + 1}-${Math.min(start + looksPerPage, input.looks.length)}`,
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
          .text(pdfDisplayText(look.garmentTypeLabel, bodyFont), x, 526, {
            align: "right",
            width,
          });
      }
    });
    if (input.watermark) drawPdfWatermark(document, bodyFont);
  }

  const range = document.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page += 1) {
    document.switchToPage(page);
    document
      .fillColor("#77736c")
      .fontSize(8)
      .text(
        `${PLATFORM_NAME}  ·  ${String(page + 1).padStart(2, "0")} / ${String(range.count).padStart(2, "0")}`,
        42,
        540,
        { align: "right", height: 12, lineBreak: false, width: 758 },
      );
    document.font(bodyFont);
  }
  document.end();
  return finished;
}

function drawPdfWatermark(
  document: PDFKit.PDFDocument,
  bodyFont: string,
): void {
  document.save();
  document
    .fillOpacity(0.11)
    .fillColor("#111111")
    .font("Helvetica-Bold")
    .fontSize(40)
    .text("FREE EXPORT", 205, 284, {
      align: "center",
      characterSpacing: 5,
      lineBreak: false,
      width: 432,
    });
  document.restore();
  document.font(bodyFont);
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

function useCjkFont(document: PDFKit.PDFDocument): string {
  const configured = process.env.EXPORT_PDF_FONT_PATH?.trim();
  const candidates = [
    configured,
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
      return fontName;
    } catch {
      continue;
    }
  }
  document.font("Helvetica");
  return "Helvetica";
}

function pdfDisplayText(value: string, fontName: string): string {
  return fontName !== "Helvetica"
    ? value
    : value.replace(/[^\u0020-\u007e]/gu, "").trim() || "COLLECTION";
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

function exportFailure(code: string, message: string): Error & { code: string } {
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
