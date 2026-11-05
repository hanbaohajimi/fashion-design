import { DesignAssetOperation, FileStatus } from "@fashion/db";
import {
  type CreatedRealtimeTryOnSession, type CreateRealtimeTryOnSession, type RealtimeTryOnCapabilities,
  type RealtimeTryOnCapture, type RealtimeTryOnCaptureResult, type RealtimeTryOnObservation,
  type OutfitSnapshotView,
} from "@fashion/shared";
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { S3FileStorage } from "../files/storage.service";
import { DECART_TOKEN_PROVIDER, DecartTokenError, type DecartTokenProvider } from "./decart-token-provider";
import { readRealtimeTryOnConfig } from "./realtime-tryon.config";
import { RealtimeTryOnSessionRepository, TRYON_RESERVATION_LOCK, tryOnConflict } from "./realtime-tryon-session.repository";
import { WardrobeService } from "../wardrobe/wardrobe.service";
import { wardrobeCapabilities } from "../wardrobe/wardrobe.rules";
import { appendOutfitBinding, assertOutfitCaptureBinding, outfitSessionBindings } from "./outfit-session-bindings";

const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
@Injectable()
export class RealtimeTryOnService {
  constructor(
    @Inject(RealtimeTryOnSessionRepository) private readonly repository: RealtimeTryOnSessionRepository,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy,
    @Inject(DECART_TOKEN_PROVIDER) private readonly tokens: DecartTokenProvider,
    @Inject(S3FileStorage) private readonly storage: S3FileStorage,
    @Optional() @Inject(WardrobeService) private readonly wardrobe?: WardrobeService,
  ) {}
  capabilities(userId: string): RealtimeTryOnCapabilities {
    const config = readRealtimeTryOnConfig();
    const allowed = config.allowedUserIds.includes(userId);
    const unavailableReason = config.unavailableReason ?? (!allowed ? "当前账号不在实时试穿内部测试名单" : undefined);
    return {
      enabled: config.enabled && allowed, configured: config.configured,
      accessMode: config.accessMode, provider: "decart", modelId: config.modelId,
      maxSessionSeconds: config.maxSessionSeconds, maxGarmentBytes: config.maxGarmentBytes,
      estimatedUsdPerSecond: Number(config.usdPerSecond) > 0 ? config.usdPerSecond : null,
      priceVerifiedAt: config.priceVerifiedAt || null,
      ...(unavailableReason ? { unavailableReason } : {}),
    };
  }
  async create(userId: string, key: string, input: CreateRealtimeTryOnSession): Promise<CreatedRealtimeTryOnSession> {
    const config = readRealtimeTryOnConfig();
    if (!config.allowedUserIds.includes(userId)) throw new ForbiddenException({ code: "TRYON_ACCESS_DENIED", message: "当前账号不在内部测试名单" });
    await this.garment(userId, input.projectId, input.garmentAssetId);
    if (input.outfitSnapshotId) await this.outfit(userId, input.projectId, input.outfitSnapshotId, input.garmentAssetId, true);
    if (!config.configured) throw new ServiceUnavailableException({ code: "TRYON_UNAVAILABLE", message: config.unavailableReason });
    const reservation = await this.repository.reserve(userId, key, fingerprint(input), input, config);
    try {
      const token = await this.tokens.create(config);
      const expiresAt = new Date(token.expiresAt);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now() || expiresAt.getTime() > Date.now() + (config.tokenTtlSeconds + 5) * 1000) throw new Error("invalid token expiry");
      const issuedAt = new Date();
      // A concurrent end is preserved. The late token is discarded, never returned or persisted.
      const updated = await this.repository.db.realtimeTryOnSession.updateMany({
        where: { id: reservation.id, status: "reserved", endedAt: null },
        data: { status: "issued", issuedAt, tokenExpiresAt: expiresAt },
      });
      if (!updated.count) throw new Error("session ended");
      return { sessionId: reservation.id, clientToken: token.apiKey, tokenExpiresAt: expiresAt.toISOString(),
        modelId: config.modelId, maxSessionSeconds: config.maxSessionSeconds, serverNow: issuedAt.toISOString(), estimatedUsdPerSecond: config.usdPerSecond };
    } catch (error) {
      await this.repository.db.realtimeTryOnSession.updateMany({ where: { id: reservation.id, status: "reserved" }, data: { status: "unknown" } });
      if (error instanceof DecartTokenError) throw error;
      throw new ServiceUnavailableException({ code: "TRYON_TOKEN_UNCERTAIN", message: "服务令牌签发结果待核实，预留额度将保守保留，请勿重复申请" });
    }
  }
  async observe(userId: string, id: string, input: RealtimeTryOnObservation) {
    const session = await this.owned(userId, id);
    if (input.generationSeconds !== undefined && input.generationSeconds > session.maxSessionSeconds) throw new BadRequestException({ code: "TRYON_OBSERVATION_INVALID", message: "观察时长超出本次限制" });
    if (input.garmentAssetId) await this.garment(userId, session.projectId, input.garmentAssetId);
    if (Boolean(session.outfitSnapshotId) !== Boolean(input.outfitSnapshotId) && (input.garmentAssetId || input.outfitSnapshotId)) throw new BadRequestException({ code: "TRYON_REFERENCE_MODE_MISMATCH", message: "单件与完整搭配模式需要分别开启会话" });
    if (input.outfitSnapshotId) {
      if (!input.garmentAssetId || input.garmentRevision === undefined) throw new BadRequestException({ code: "TRYON_OUTFIT_OBSERVATION_INVALID", message: "搭配更新需要参考图与应用序号" });
      await this.outfit(userId, session.projectId, input.outfitSnapshotId, input.garmentAssetId, true);
    }
    const updated = await this.repository.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TRYON_RESERVATION_LOCK})`;
      const current = await tx.realtimeTryOnSession.findUniqueOrThrow({ where: { id } });
      const bindings = input.sequence > current.observationSequence && input.outfitSnapshotId && input.garmentAssetId && input.garmentRevision !== undefined
        ? appendOutfitBinding(current, { outfitSnapshotId: input.outfitSnapshotId, garmentAssetId: input.garmentAssetId, garmentRevision: input.garmentRevision })
        : outfitSessionBindings(current);
      return tx.realtimeTryOnSession.updateMany({
        where: { id, userId, endedAt: null, observationSequence: { lt: input.sequence } },
        data: { observationSequence: input.sequence, observationAt: new Date(),
          generationSeconds: Math.max(current.generationSeconds, input.generationSeconds ?? 0),
          observation: { ...input, source: "client-observed", ...(bindings.length ? { outfitBindings: bindings.map((binding) => ({ ...binding })) } : {}) } },
      });
    });
    return { accepted: updated.count > 0, source: "client-observed" as const };
  }
  async end(userId: string, id: string, reason: string) {
    await this.owned(userId, id);
    await this.repository.db.realtimeTryOnSession.updateMany({ where: { id, userId, endedAt: null }, data: { endedAt: new Date(), endReason: reason, status: "ended" } });
    return { ended: true, upstreamStop: "unverified", riskReleased: false };
  }
  async capture(userId: string, id: string, key: string, input: RealtimeTryOnCapture): Promise<RealtimeTryOnCaptureResult> {
    const session = await this.owned(userId, id);
    if (!session.issuedAt) throw new BadRequestException({ code: "TRYON_NOT_ISSUED", message: "本次会话尚未建立" });
    await this.garment(userId, session.projectId, input.garmentAssetId);
    if (Boolean(session.outfitSnapshotId) !== Boolean(input.outfitSnapshotId)) throw new BadRequestException({ code: "TRYON_REFERENCE_MODE_MISMATCH", message: "截图必须保留本次试穿的完整搭配关联" });
    const outfit = input.outfitSnapshotId ? await this.outfit(userId, session.projectId, input.outfitSnapshotId, input.garmentAssetId, false) : null;
    if (input.outfitSnapshotId) assertOutfitCaptureBinding(session, { outfitSnapshotId: input.outfitSnapshotId, garmentAssetId: input.garmentAssetId, garmentRevision: input.garmentRevision });
    const capturedAt = Date.parse(input.capturedAt);
    if (capturedAt < session.issuedAt.getTime() - 5000 || capturedAt > Math.min(Date.now() + 5000, session.riskUntil.getTime())) throw new BadRequestException({ code: "TRYON_CAPTURE_TIME_INVALID", message: "截图时间不在本次会话范围内" });
    const digest = fingerprint(input);
    const assetId = await this.repository.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TRYON_RESERVATION_LOCK})`;
      await this.access.require(userId, session.projectId, "edit", tx);
      const previous = await tx.realtimeTryOnCapture.findUnique({ where: { sessionId_requestKey: { sessionId: id, requestKey: key } } });
      if (previous) {
        if (previous.fingerprint !== digest) tryOnConflict("TRYON_IDEMPOTENCY_CONFLICT", "截图请求标识已用于其他结果");
        return previous.assetId;
      }
      const file = await tx.fileAsset.findUnique({ where: { id: input.fileId } });
      if (!file || file.ownerId !== userId) throw new ForbiddenException({ code: "FILE_FORBIDDEN", message: "无权保存该截图文件" });
      if (file.status !== FileStatus.READY || !["image/png", "image/jpeg", "image/webp"].includes(file.mimeType) || file.width !== input.width || file.height !== input.height) throw new BadRequestException({ code: "TRYON_CAPTURE_NOT_READY", message: "截图文件未就绪或像素尺寸不匹配" });
      const taken = await tx.designAsset.findUnique({ where: { projectId_sourceFileId: { projectId: session.projectId, sourceFileId: file.id } } });
      if (taken || await tx.realtimeTryOnCapture.findUnique({ where: { fileId: file.id } })) tryOnConflict("TRYON_CAPTURE_ALREADY_SAVED", "该文件已保存为项目资产，请从作品区读取");
      const newId = randomUUID();
      const metadata = { source: "realtime-tryon-capture", aiGenerated: true, sessionId: id, provider: "decart", modelId: session.modelId,
        garmentAssetId: input.garmentAssetId, garmentRevision: input.garmentRevision, width: file.width, height: file.height,
        ...(outfit ? { outfitSnapshotId: outfit.id, outfitVersion: outfit.version, outfitItems: outfit.items.map((item) => ({ itemId: item.itemId, revisionId: item.id, assetId: item.assetId, sourceAssetId: item.sourceAssetId, category: item.category, layer: item.layer, wearNote: item.wearNote })) } : {}),
        capturedAt: input.capturedAt, savedAt: new Date().toISOString(), evidence: "client-observed" };
      await tx.designAsset.create({ data: {
        id: newId, projectId: session.projectId, rootAssetId: newId, operation: DesignAssetOperation.GENERATED,
        sourceFileId: file.id, url: `s3://${file.objectKey}`, width: file.width, height: file.height,
        thumbnailUrl: file.thumbnail1024Key ? `s3://${file.thumbnail1024Key}` : null,
        designStep: { create: { projectId: session.projectId, actor: "user", tool: "realtime-tryon-capture", intent: "保存 AI 实时试穿输出帧",
          inputSnapshot: { version: 1, sources: outfit ? [
            ...outfit.items.map((item) => ({ elementId: item.id, assetId: item.assetId, role: "garment_ref", title: item.name })),
            ...outfit.items.filter((item) => item.sourceAssetId !== item.assetId).map((item) => ({ elementId: `${item.id}-source`, assetId: item.sourceAssetId, role: "garment_ref", title: `${item.name}原图` })),
            { elementId: outfit.id, assetId: input.garmentAssetId, role: "garment_ref", title: "完整搭配参考图" },
          ] : [{ elementId: input.garmentAssetId, assetId: input.garmentAssetId, role: "garment_ref", title: "试穿服装" }],
            constraints: { palette: [], notes: [], avoidLabels: [], fabricTerms: [] }, parameters: metadata } } },
      } });
      await tx.realtimeTryOnCapture.create({ data: { sessionId: id, requestKey: key, fingerprint: digest, assetId: newId, fileId: file.id, metadata } });
      return newId;
    });
    return { assetId, url: `/api/design-assets/${encodeURIComponent(assetId)}/content`, source: "realtime-tryon-capture" };
  }
  private async owned(userId: string, id: string) {
    const session = await this.repository.db.realtimeTryOnSession.findUnique({ where: { id } });
    if (!session || session.userId !== userId) throw new NotFoundException({ code: "TRYON_SESSION_NOT_FOUND", message: "试穿会话不存在" });
    await this.access.require(userId, session.projectId, "edit");
    return session;
  }
  private async outfit(userId: string, projectId: string, snapshotId: string, referenceAssetId: string, requireCapability: boolean): Promise<OutfitSnapshotView> {
    if (!this.wardrobe) throw new ServiceUnavailableException({ code: "TRYON_OUTFIT_UNAVAILABLE", message: "完整搭配实时试穿尚未配置" });
    // getSnapshot verifies the project and every source, reviewed item and reference asset.
    const snapshot = await this.wardrobe.getSnapshot(userId, projectId, snapshotId);
    if (!snapshot.referenceAssetId || snapshot.referenceAssetId !== referenceAssetId) throw new BadRequestException({ code: "TRYON_OUTFIT_REFERENCE_MISMATCH", message: "参考图与当前搭配快照不匹配" });
    if (requireCapability) {
      const capabilities = wardrobeCapabilities();
      if (!capabilities.enabled || !capabilities.realtimeOutfitEnabled || (snapshot.items.length > 1 && !capabilities.realtimeMultiItemVerified) || snapshot.items.some((item) => !capabilities.realtimeCategories.includes(item.category))) {
        throw new ServiceUnavailableException({ code: "TRYON_OUTFIT_UNVERIFIED", message: "当前完整搭配或类别的实时效果尚未验证，暂不能开启试穿" });
      }
    }
    return snapshot;
  }
  private async garment(userId: string, projectId: string, assetId: string) {
    await this.access.require(userId, projectId, "edit");
    const asset = await this.repository.db.designAsset.findUnique({ where: { id: assetId }, include: { sourceFile: true } });
    if (!asset || asset.projectId !== projectId || asset.archivedAt) throw new NotFoundException({ code: "TRYON_GARMENT_NOT_FOUND", message: "当前项目中未找到可用服装图片" });
    const max = readRealtimeTryOnConfig().maxGarmentBytes;
    if (!asset.width || !asset.height || asset.width > 8192 || asset.height > 8192 || asset.width * asset.height > 33_554_432) throw new BadRequestException({ code: "TRYON_GARMENT_INVALID", message: "服装图片像素尺寸不适合实时试穿" });
    const stored = asset.sourceFile ?? (asset.url.startsWith("s3://") ? await this.storage.head(asset.url.slice(5)).then((head) => ({ status: FileStatus.READY, mimeType: head.contentType, sizeBytes: head.contentLength })) : null);
    if (!stored || stored.status !== FileStatus.READY || !["image/png", "image/jpeg", "image/webp"].includes(stored.mimeType ?? "") || stored.sizeBytes <= 0 || stored.sizeBytes > max) throw new BadRequestException({ code: "TRYON_GARMENT_INVALID", message: "请选择已就绪且大小合适的 JPEG、PNG 或 WebP 服装图片" });
    return asset;
  }
}
