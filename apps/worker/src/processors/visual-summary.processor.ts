import {
  amuxClaudeClientConfigFromEnv,
  describeImage,
  imageVisualDescriptionSchema,
  visualSummaryFingerprint,
  visualSummarySourceKey,
  type AmuxClaudeJsonClient,
} from "@fashion/ai";
import { type PrismaClient } from "@fashion/db";
import { VISUAL_SUMMARY_SCHEMA_VERSION, type VisualSummaryJobData } from "@fashion/shared";

import type { ThumbnailStorage } from "../storage";

type VisualDatabase = Pick<PrismaClient, "designAsset" | "fileAsset" | "imageVisualSummary">;
interface Dependencies {
  readonly database: VisualDatabase;
  readonly storage: Pick<ThumbnailStorage, "get">;
  readonly client: AmuxClaudeJsonClient;
}
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const STALE_ANALYSIS_MS = 12 * 60 * 1_000;

export function createVisualSummaryProcessor({ database, storage, client }: Dependencies) {
  return async (data: VisualSummaryJobData): Promise<void> => {
    // Jobs produced by an older deployment must not write a new-model cache entry.
    if (data.schemaVersion !== VISUAL_SUMMARY_SCHEMA_VERSION ||
      data.model !== amuxClaudeClientConfigFromEnv().model) return;
    let sourceKey: string | null = null;
    if (data.source.kind === "file") {
      const file = await database.fileAsset.findUnique({ where: { id: data.source.id } });
      if (!file || file.status !== "READY" || !file.thumbnail1024Key) {
        throw new Error("视觉摘要的图片尚未就绪");
      }
      sourceKey = file.thumbnail1024Key;
    } else {
      const asset = await database.designAsset.findUnique({ where: { id: data.source.id } });
      if (!asset || asset.archivedAt) return;
      sourceKey = visualSummarySourceKey(asset.thumbnailUrl);
    }
    if (!sourceKey) throw new Error("视觉摘要缺少可信的缩略图");
    let fingerprint: string | undefined;
    let claimed = false;
    const claimedAt = new Date();
    try {
      const bytes = await storage.get(sourceKey);
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES ||
        bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
        bytes.subarray(8, 12).toString("ascii") !== "WEBP") {
        throw new Error("视觉摘要缩略图无效或超过大小上限");
      }
      fingerprint = visualSummaryFingerprint(bytes, data.model, data.schemaVersion);
      const cached = await database.imageVisualSummary.upsert({
        where: { fingerprint }, update: {},
        create: { fingerprint, sourceKey, status: "PENDING", model: data.model, schemaVersion: data.schemaVersion },
      });
      if (cached.status === "READY" && imageVisualDescriptionSchema.safeParse(cached.summary).success) return;
      if (cached.status === "RUNNING" && Date.now() - cached.updatedAt.getTime() < STALE_ANALYSIS_MS) {
        throw new Error("相同图片的视觉摘要正在分析");
      }
      const claim = await database.imageVisualSummary.updateMany({
        where: { fingerprint, status: cached.status, updatedAt: cached.updatedAt },
        data: { status: "RUNNING", error: null, updatedAt: claimedAt },
      });
      if (claim.count === 0) throw new Error("视觉摘要已被其他任务接管");
      claimed = true;
      const summary = await describeImage(client, bytes);
      await database.imageVisualSummary.updateMany({
        where: { fingerprint, status: "RUNNING", updatedAt: claimedAt },
        data: { status: "READY", summary: { ...summary }, error: null },
      });
    } catch (error) {
      if (claimed && fingerprint) {
        await database.imageVisualSummary.updateMany({ where: { fingerprint, status: "RUNNING", updatedAt: claimedAt },
          data: { status: "FAILED", error: "视觉摘要分析失败" } });
      } else if (!fingerprint) {
        await database.imageVisualSummary.updateMany({
          where: { sourceKey, model: data.model, schemaVersion: data.schemaVersion, status: "PENDING" },
          data: { status: "FAILED", error: "视觉摘要图片读取失败" },
        });
      }
      throw error;
    }
  };
}
