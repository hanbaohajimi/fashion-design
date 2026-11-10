import { DesignAssetOperation, ExportStatus, Prisma, type PrismaClient } from "@fashion/db";
import { GoneException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { privateStorageObjectKey, type GeneratedFileDomain, type ProjectGeneratedFile, type ProjectGeneratedFilePage } from "@fashion/shared";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { S3FileStorage } from "../files/storage.service";
import { visibleStudioAssets } from "../studio/studio-asset-visibility";
import { decodeGeneratedFileCursor, fileView, generatedFileBoundary, mediaLabels, mergeGeneratedFiles, operationLabels, type GeneratedFileQuery } from "./generated-file-query";

export const PROJECT_GENERATED_FILES_DB = Symbol("PROJECT_GENERATED_FILES_DB");

@Injectable()
export class ProjectGeneratedFilesService {
  constructor(@Inject(PROJECT_GENERATED_FILES_DB) private readonly db: PrismaClient,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy,
    @Inject(S3FileStorage) private readonly storage: S3FileStorage) {}

  async list(userId: string, projectId: string, input: GeneratedFileQuery): Promise<ProjectGeneratedFilePage> {
    await this.access.require(userId, projectId, "read");
    const cursor = decodeGeneratedFileCursor(input.cursor, projectId, input);
    const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }], take = input.limit + 1;
    const q = input.q, contains = { contains: q, mode: "insensitive" as const };
    const assetWhere: Prisma.DesignAssetWhereInput = { AND: [visibleStudioAssets(projectId), { operation: { not: DesignAssetOperation.IMPORTED } },
      generatedFileBoundary(cursor, "asset"), ...(q ? [{ OR: [{ id: contains }, { designStep: { is: { intent: contains } } },
        { operation: { in: Object.entries(operationLabels).filter(([, label]) => label.includes(q)).map(([key]) => key as DesignAssetOperation) } }] }] : [])] };
    const mediaWhere: Prisma.RunwayMediaWhereInput = { projectId, AND: [generatedFileBoundary(cursor, "runway"),
      { OR: [{ source: { equals: Prisma.AnyNull } }, { source: { path: ["input"], equals: Prisma.AnyNull } }, { NOT: { source: { path: ["input"], equals: true } } }] },
      ...(input.kind === "all" ? [] : [{ mimeType: { startsWith: `${input.kind}/` } }]),
      ...(q ? [{ OR: [{ id: contains }, { originalName: contains }, { run: { show: { title: contains } } }, { kind: { in: Object.entries(mediaLabels).filter(([, label]) => label.includes(q)).map(([kind]) => kind) } }] }] : [])] };
    const exportWhere: Prisma.ExportJobWhereInput = { projectId, status: { in: [ExportStatus.SUCCEEDED, ExportStatus.EXPIRED] },
      AND: [generatedFileBoundary(cursor, "export"), ...(input.kind === "document" ? [{ format: "PDF" as const }] : input.kind === "image" ? [{ format: { in: ["PNG" as const, "JPG" as const] } }] : []),
        ...(q ? [{ OR: [{ id: contains }, { fileName: contains }, { collection: { name: contains } }] }] : [])] };
    const [assets, media, exports] = await Promise.all([
      ["all", "image"].includes(input.kind) ? this.db.designAsset.findMany({ where: assetWhere, orderBy, take, select: { id: true, operation: true, createdAt: true, archivedAt: true, width: true, height: true, url: true, thumbnailUrl: true, designStep: { select: { intent: true, tool: true } } } }) : [],
      input.kind !== "document" ? this.db.runwayMedia.findMany({ where: mediaWhere, orderBy, take, select: { id: true, kind: true, mimeType: true, createdAt: true, width: true, height: true, durationMs: true, sizeBytes: true, originalName: true, runId: true, run: { select: { showId: true, show: { select: { title: true, archived: true } } } } } }) : [],
      ["all", "image", "document"].includes(input.kind) ? this.db.exportJob.findMany({ where: exportWhere, orderBy, take, select: { id: true, createdAt: true, expiresAt: true, status: true, fileName: true, mimeType: true, sizeBytes: true, format: true, objectKey: true, designAssetId: true, studioRevisionId: true, collectionId: true } }) : [],
    ]);
    const base = `/${encodeURIComponent(projectId)}`;
    const rows: ProjectGeneratedFile[] = [
      ...assets.map(row => ({ ...fileView("asset", row.id, row.createdAt), title: row.designStep?.intent.trim().slice(0, 160) || operationLabels[row.operation] || "生成图片",
        operation: operationLabels[row.operation] ?? "生成图片", archived: Boolean(row.archivedAt), width: row.width, height: row.height,
        previewUrl: `/api/design-assets/${encodeURIComponent(row.id)}/thumbnail`, contentUrl: `/api/design-assets/${encodeURIComponent(row.id)}/content` })),
      ...media.map(row => ({ ...fileView("runway", row.id, row.createdAt), kind: row.mimeType.startsWith("video/") ? "video" as const : row.mimeType.startsWith("audio/") ? "audio" as const : "image" as const,
        title: `${row.run.show.title} ${mediaLabels[row.kind] ?? row.kind}`, operation: mediaLabels[row.kind] ?? row.kind, mimeType: row.mimeType,
        archived: row.run.show.archived, width: row.width, height: row.height, sizeBytes: row.sizeBytes, durationMs: row.durationMs,
        previewUrl: row.mimeType.startsWith("image/") ? `/api/projects/${encodeURIComponent(projectId)}/runway/media/${encodeURIComponent(row.id)}/content` : null,
        contentUrl: `/api/projects/${encodeURIComponent(projectId)}/runway/media/${encodeURIComponent(row.id)}/content`,
        sourceHref: `${base}/studio?tab=runway&showId=${encodeURIComponent(row.run.showId)}&runId=${encodeURIComponent(row.runId)}` })),
      ...exports.map(row => {
        const expired = row.status === "EXPIRED" || Boolean(row.expiresAt && row.expiresAt.getTime() <= Date.now());
        const ready = !expired && Boolean(row.objectKey && row.expiresAt && row.fileName);
        return { ...fileView("export", row.id, row.createdAt), kind: row.format === "PDF" ? "document" as const : "image" as const, title: row.fileName || `${row.format} 导出文件`, operation: "导出文件",
          status: expired ? "expired" as const : ready ? "ready" as const : "unavailable" as const, mimeType: row.mimeType, sizeBytes: row.sizeBytes, expiresAt: row.expiresAt?.toISOString() ?? null,
          contentUrl: ready ? `/api/exports/${encodeURIComponent(row.id)}/content` : null, sourceHref: row.designAssetId ? `${base}/studio?tab=styles&assetId=${encodeURIComponent(row.designAssetId)}` : row.collectionId ? `${base}?collectionId=${encodeURIComponent(row.collectionId)}` : null };
      }),
    ];
    const result = mergeGeneratedFiles(rows, projectId, input);
    const assetIds = result.items.filter(row => row.domain === "asset").map(row => row.resourceId);
    const documentIds = exports.filter(row => result.items.some(item => item.id === `export:${row.id}`)).flatMap(row => row.studioRevisionId ? [row.studioRevisionId] : []);
    const [nodes, documents] = await Promise.all([
      assetIds.length ? this.db.workflowNode.findMany({ where: { projectId, kind: "asset", OR: assetIds.map(id => ({ payload: { path: ["assetId"], equals: id } })) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, payload: true } }) : [],
      documentIds.length ? this.db.studioDocument.findMany({ where: { projectId, id: { in: documentIds } }, select: { id: true, type: true, documentId: true, styleRevisionId: true } }) : [],
    ]);
    for (const item of result.items) {
      if (item.domain === "asset") item.nodeId = nodes.find(node => (node.payload as Record<string, unknown>)?.assetId === item.resourceId)?.id ?? null;
      if (item.domain === "export") {
        const document = documents.find(row => row.id === exports.find(row => row.id === item.resourceId)?.studioRevisionId);
        if (document) item.sourceHref = `${base}/studio?tab=${document.type === "TECH_PACK" ? "tech" : "presentation"}&documentId=${encodeURIComponent(document.documentId)}&documentRevisionId=${encodeURIComponent(document.id)}${document.styleRevisionId ? `&styleRevisionId=${encodeURIComponent(document.styleRevisionId)}` : ""}`;
      }
    }
    return result;
  }

  async download(userId: string, projectId: string, domain: GeneratedFileDomain, id: string) {
    await this.access.require(userId, projectId, "read");
    let key: string, fileName = "", expiry = 60, expiresAt: Date | null = null;
    if (domain === "asset") {
      const asset = await this.db.designAsset.findFirst({ where: { AND: [visibleStudioAssets(projectId), { id, operation: { not: DesignAssetOperation.IMPORTED } }] } });
      if (!asset) throw new NotFoundException("生成文件不存在或不可访问");
      const storedKey = privateStorageObjectKey(asset.url, { endpoint: process.env.S3_ENDPOINT, bucket: process.env.S3_BUCKET, cdnOrigin: process.env.S3_CDN_ORIGIN });
      if (!storedKey) throw new NotFoundException("历史外部图片未保存在项目中，暂不能下载原文件。");
      key = storedKey;
      const head = await this.fileHead(key);
      const extension: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/avif": "avif", "image/heic": "heic" };
      fileName = `${operationLabels[asset.operation] ?? "生成图片"}-${id}.${extension[head.contentType ?? ""] ?? "bin"}`;
    } else if (domain === "runway") {
      const media = await this.db.runwayMedia.findFirst({ where: { id, projectId } });
      if (!media || (media.source as Record<string, unknown>)?.input === true) throw new NotFoundException("生成文件不存在或不可访问");
      key = media.objectKey; fileName = media.originalName; await this.fileHead(key);
    } else {
      const job = await this.db.exportJob.findFirst({ where: { id, projectId } });
      if (!job) throw new NotFoundException("生成文件不存在或不可访问");
      if (job.status === "EXPIRED" || job.expiresAt && job.expiresAt.getTime() <= Date.now()) throw new GoneException("导出文件已过期，请回到来源重新导出。");
      if (job.status !== "SUCCEEDED" || !job.objectKey || !job.fileName || !job.expiresAt) throw new NotFoundException("导出文件尚未就绪");
      key = job.objectKey; fileName = job.fileName; expiry = Math.min(60, Math.floor((job.expiresAt.getTime() - Date.now()) / 1000));
      expiresAt = job.expiresAt;
      if (expiry < 1) throw new GoneException("导出文件已过期，请回到来源重新导出。");
      await this.fileHead(key);
    }
    if (expiresAt) { expiry = Math.min(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000)); if (expiry < 1) throw new GoneException("导出文件已过期，请回到来源重新导出。"); }
    return { url: await this.storage.createDownloadUrl(key, expiry, fileName), fileName };
  }

  private async fileHead(key: string) {
    try { const head = await this.storage.head(key); if (head.contentLength < 1) throw new Error("Empty file"); return head; }
    catch { throw new ServiceUnavailableException("文件暂时无法读取，请稍后重试；生成记录仍已保留。"); }
  }
}
