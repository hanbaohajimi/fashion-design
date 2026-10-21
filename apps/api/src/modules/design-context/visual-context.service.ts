import {
  amuxClaudeClientConfigFromEnv,
  imageVisualDescriptionSchema,
  visualSummaryFingerprint,
  visualSummarySourceKey,
  type AmuxClaudeImageInput,
} from "@fashion/ai";
import { FabricScope, type PrismaClient } from "@fashion/db";
import {
  VISUAL_SUMMARY_SCHEMA_VERSION,
  type VisualContextCoverage,
  type VisualContextIndexEntry,
  type VisualSummarySource,
} from "@fashion/shared";
import { ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";

import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { requireProjectFile } from "../files/project-file-access";
import { S3FileStorage, type FileStorage } from "../files/storage.service";
import { BullVisualSummaryJobs } from "./visual-summary-queue.service";

export const VISUAL_CONTEXT_DB = Symbol("VISUAL_CONTEXT_DB");
type VisualDatabase = Pick<PrismaClient,
  "project" | "designAsset" | "fileAsset" | "fabric" | "trendItem" | "boardElement" | "imageVisualSummary">;
export interface VisualContextNode { readonly id: string; readonly type: string; readonly payload: unknown; }
interface Source {
  readonly source: VisualSummarySource;
  readonly sourceKey: string;
  readonly assetId: string | null;
  readonly fileAssetId: string | null;
}
export interface VisualContextResult {
  readonly index: readonly VisualContextIndexEntry[];
  readonly images: readonly AmuxClaudeImageInput[];
  readonly imageBindings: readonly { readonly imageIndex: number; readonly nodeId: string;
    readonly assetId: string | null; readonly fileAssetId: string | null }[];
  readonly coverage: VisualContextCoverage;
}
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_IMAGES = 8;
const FAILED_SUMMARY_RETRY_COOLDOWN_MS = 5 * 60_000;
const IMAGE_NODE_TYPES = new Set(["reference", "reference_image", "sketch", "candidate", "fabric", "trend"]);

@Injectable()
export class VisualContextService {
  constructor(
    @Inject(VISUAL_CONTEXT_DB) private readonly database: VisualDatabase,
    @Inject(S3FileStorage) private readonly storage: Pick<FileStorage, "readPrefix">,
    @Inject(BullVisualSummaryJobs) private readonly jobs: Pick<BullVisualSummaryJobs, "enqueue">,
    @Optional() @Inject(ProjectAccessPolicy) private readonly access?: ProjectAccessPolicy,
  ) {}

  async enrich(userId: string, projectId: string, nodes: readonly VisualContextNode[],
    priorityNodeIds: readonly string[] = []): Promise<VisualContextResult> {
    const project = await this.database.project.findUnique({ where: { id: projectId },
      select: { deletedAt: true, workspace: { select: { ownerId: true } } } });
    if (!project || project.deletedAt) throw new NotFoundException("项目不存在");
    const permission = this.access ? await this.access.require(userId, projectId, "read") : null;
    if (!this.access && project.workspace.ownerId !== userId) throw new ForbiddenException("无权读取项目图片");
    const canSchedule = permission?.capabilities.edit ?? true;

    const model = amuxClaudeClientConfigFromEnv().model;
    const sources = new Map<string, Source>();
    const bytesByKey = new Map<string, Promise<Uint8Array>>();
    const cacheByKey = new Map<string, Promise<void>>();
    const load = (key: string) => {
      let value = bytesByKey.get(key);
      if (!value) {
        value = this.readImage(key);
        bytesByKey.set(key, value);
      }
      return value;
    };
    const imageNodes = nodes.filter((node) => IMAGE_NODE_TYPES.has(node.type) || hasImageReference(node.payload));
    const index: VisualContextIndexEntry[] = [];
    // Bound storage/model-cache lookups while still indexing the whole graph.
    for (let start = 0; start < imageNodes.length; start += 4) {
      const entries = await Promise.all(imageNodes.slice(start, start + 4).map(async (node) => {
        const base = { nodeId: node.id, assetId: stringField(node.payload, "assetId"),
          fileAssetId: stringField(node.payload, "fileAssetId"), summary: null, error: null };
        try {
          const resolved = await this.resolveSource(userId, projectId, node.payload);
          if (!resolved) return { ...base, status: "unavailable" as const,
            error: "图片缺失、无权访问或没有可信的存储引用" };
          if ("notReady" in resolved) return { ...base, status: "not_ready" as const,
            error: "图片或 1024 缩略图尚未就绪" };
          sources.set(node.id, resolved);
          const identity = { ...base, assetId: resolved.assetId, fileAssetId: resolved.fileAssetId };
          let row = await this.database.imageVisualSummary.findFirst({
            where: { sourceKey: resolved.sourceKey, model, schemaVersion: VISUAL_SUMMARY_SCHEMA_VERSION },
            orderBy: { updatedAt: "desc" },
          });
          if (!row && !canSchedule) return { ...identity, status: "pending" as const, error: "视觉摘要尚未就绪，请由编辑成员发起分析" };
          if (!row) {
            const bytes = await load(resolved.sourceKey);
            const fingerprint = visualSummaryFingerprint(bytes, model);
            row = await this.database.imageVisualSummary.findUnique({ where: { fingerprint } });
            if (!row) row = await this.database.imageVisualSummary.upsert({
              where: { fingerprint }, update: {},
              create: { fingerprint, sourceKey: resolved.sourceKey, model,
                schemaVersion: VISUAL_SUMMARY_SCHEMA_VERSION, status: "PENDING" },
            });
          }
          const parsed = imageVisualDescriptionSchema.safeParse(row.summary);
          if (row.status === "READY" && parsed.success) return {
            ...identity, status: "ready" as const, summary: parsed.data,
          };
          if (!canSchedule) return { ...identity, status: row.status === "FAILED" ? "failed" as const : "pending" as const, error: row.status === "FAILED" ? "视觉摘要分析失败，请由编辑成员重试" : null };
          if (row.status === "FAILED") {
            if (Date.now() - row.updatedAt.getTime() < FAILED_SUMMARY_RETRY_COOLDOWN_MS) {
              return { ...identity, status: "failed" as const, error: "视觉摘要分析失败，稍后将重试" };
            }
            // One request claims the cooled failure. A new failed attempt refreshes updatedAt,
            // so repeatedly opening context cannot start an unbounded retry loop.
            const retry = await this.database.imageVisualSummary.updateMany({
              where: { fingerprint: row.fingerprint, model, schemaVersion: VISUAL_SUMMARY_SCHEMA_VERSION,
                status: "FAILED", updatedAt: row.updatedAt },
              data: { status: "PENDING", error: null },
            });
            if (retry.count === 0) {
              const current = await this.database.imageVisualSummary.findUnique({ where: { fingerprint: row.fingerprint } });
              const currentSummary = imageVisualDescriptionSchema.safeParse(current?.summary);
              if (current?.status === "READY" && currentSummary.success) return {
                ...identity, status: "ready" as const, summary: currentSummary.data,
              };
              return current?.status === "FAILED"
                ? { ...identity, status: "failed" as const, error: "视觉摘要分析失败，稍后将重试" }
                : { ...identity, status: "pending" as const };
            }
          }
          if (row.status === "READY" && !parsed.success) await this.database.imageVisualSummary.updateMany({
            where: { fingerprint: row.fingerprint, status: "READY", updatedAt: row.updatedAt },
            data: { status: "PENDING", error: null },
          });
          // Also re-enqueue stale pending work after a worker/Redis restart.
          const key = resolved.sourceKey;
          if (!cacheByKey.has(key)) cacheByKey.set(key, this.jobs.enqueue({ source: resolved.source,
            model, schemaVersion: VISUAL_SUMMARY_SCHEMA_VERSION }));
          await cacheByKey.get(key);
          return { ...identity, status: "pending" as const };
        } catch {
          return { ...base, status: "failed" as const, error: "图片读取或视觉摘要任务暂不可用" };
        }
      }));
      index.push(...entries);
    }

    const priorities = new Map(priorityNodeIds.map((id, i) => [id, i]));
    // Filter actual accessible images first: text nodes never consume the image budget.
    const candidates = index.filter((entry) => sources.has(entry.nodeId))
      .sort((a, b) => (priorities.get(a.nodeId) ?? Number.MAX_SAFE_INTEGER) -
        (priorities.get(b.nodeId) ?? Number.MAX_SAFE_INTEGER));
    const images: AmuxClaudeImageInput[] = [];
    const imageBindings: VisualContextResult["imageBindings"][number][] = [];
    for (const entry of candidates) {
      if (images.length >= MAX_IMAGES) break;
      const source = sources.get(entry.nodeId);
      if (!source) continue;
      try {
        const bytes = await load(source.sourceKey);
        imageBindings.push({ imageIndex: images.length, nodeId: entry.nodeId,
          assetId: source.assetId, fileAssetId: source.fileAssetId });
        images.push({ detail: "high", url: `data:image/webp;base64,${Buffer.from(bytes).toString("base64")}` });
      } catch { /* Coverage below explicitly reports images not attached. */ }
    }
    const attachedNodeIds = imageBindings.map((binding) => binding.nodeId);
    return { index, images, imageBindings, coverage: {
      total: index.length, ready: index.filter((entry) => entry.status === "ready").length,
      pending: index.filter((entry) => entry.status === "pending" || entry.status === "not_ready").length,
      failed: index.filter((entry) => entry.status === "failed" || entry.status === "unavailable").length,
      attachedNodeIds, unreadNodeIds: index.filter((entry) => !attachedNodeIds.includes(entry.nodeId)).map((entry) => entry.nodeId),
    } };
  }

  private async readImage(key: string): Promise<Uint8Array> {
    const bytes = await this.storage.readPrefix(key, MAX_IMAGE_BYTES + 1);
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES ||
      Buffer.from(bytes.subarray(0, 4)).toString("ascii") !== "RIFF" ||
      Buffer.from(bytes.subarray(8, 12)).toString("ascii") !== "WEBP") {
      throw new Error("可信缩略图不是有效的 WebP 或超过大小上限");
    }
    return bytes;
  }

  private async resolveSource(userId: string, projectId: string, payload: unknown): Promise<Source | { notReady: true } | null> {
    const assetId = stringField(payload, "assetId");
    if (assetId) {
      const asset = await this.database.designAsset.findUnique({ where: { id: assetId }, include: { sourceFile: true } });
      if (!asset || asset.projectId !== projectId || asset.archivedAt) return null;
      if (asset.sourceFile && (asset.sourceFile.ownerId === userId || this.access)) return this.fileSource(asset.sourceFile, asset.id);
      const sourceKey = visualSummarySourceKey(asset.thumbnailUrl);
      return sourceKey ? { source: { kind: "asset", id: asset.id }, sourceKey,
        assetId: asset.id, fileAssetId: null } : { notReady: true };
    }
    const fabricId = stringField(payload, "fabricId");
    if (fabricId) {
      const fabric = await this.database.fabric.findUnique({ where: { id: fabricId }, include: { mainFile: true } });
      if (!fabric || fabric.status !== "active") return null;
      if (fabric.scope !== FabricScope.PRESET && fabric.ownerId !== userId) {
        if (!this.access) return null;
        try { await requireProjectFile(this.database, this.access, userId, fabric.mainFile.id, projectId); } catch { return null; }
      }
      return this.fileSource(fabric.mainFile, null);
    }
    const trendItemId = stringField(payload, "trendItemId");
    if (trendItemId) {
      const trend = await this.database.trendItem.findUnique({ where: { id: trendItemId }, include: { coverFile: true } });
      if (!trend || trend.status !== "published" || !trend.coverFile) return null;
      return this.fileSource(trend.coverFile, null);
    }
    let fileId = stringField(payload, "fileAssetId");
    const elementId = stringField(payload, "boardElementId");
    if (!fileId && elementId) {
      const element = await this.database.boardElement.findUnique({ where: { id: elementId } });
      if (!element || element.projectId !== projectId || element.deletedAt) return null;
      fileId = element.fileAssetId;
    }
    if (!fileId) return null;
    if (this.access) {
      try { return this.fileSource(await requireProjectFile(this.database, this.access, userId, fileId, projectId), null); } catch { return null; }
    }
    const file = await this.database.fileAsset.findUnique({ where: { id: fileId } });
    return file && file.ownerId === userId ? this.fileSource(file, null) : null;
  }

  private fileSource(file: { id: string; status: string; thumbnail1024Key: string | null }, assetId: string | null): Source | { notReady: true } {
    return file.status === "READY" && file.thumbnail1024Key
      ? { source: { kind: "file", id: file.id }, sourceKey: file.thumbnail1024Key,
        assetId, fileAssetId: file.id } : { notReady: true };
  }
}

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const result = (value as Record<string, unknown>)[key];
  return typeof result === "string" && result.trim() ? result : null;
}
function hasImageReference(value: unknown): boolean {
  return ["assetId", "fileAssetId", "fabricId", "trendItemId", "boardElementId"].some((key) => stringField(value, key));
}
