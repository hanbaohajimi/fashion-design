import { Prisma, type PrismaClient, type RealtimeTryOnSession } from "@fashion/db";
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { CreateRealtimeTryOnSession } from "@fashion/shared";
import { REALTIME_TRYON_SDK_VERSION } from "@fashion/shared";
import type { RealtimeTryOnConfig } from "./realtime-tryon.config";

export const REALTIME_TRYON_DB = Symbol("REALTIME_TRYON_DB");
export const TRYON_RESERVATION_LOCK = 73218862;
export function tryOnConflict(code: string, message: string): never {
  throw new ConflictException({ code, message });
}
@Injectable()
export class RealtimeTryOnSessionRepository {
  constructor(@Inject(REALTIME_TRYON_DB) readonly db: PrismaClient) {}
  reserve(userId: string, requestKey: string, fingerprint: string, input: CreateRealtimeTryOnSession, config: RealtimeTryOnConfig): Promise<RealtimeTryOnSession> {
    return this.db.$transaction(async (tx) => {
      // Every issuer instance serializes decisions on the same durable database lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TRYON_RESERVATION_LOCK})`;
      const existing = await tx.realtimeTryOnSession.findUnique({ where: { userId_requestKey: { userId, requestKey } } });
      if (existing) {
        if (existing.fingerprint !== fingerprint) tryOnConflict("TRYON_IDEMPOTENCY_CONFLICT", "请求标识已用于其他试穿参数");
        tryOnConflict("SESSION_ALREADY_ISSUED", "该请求已处理或签发结果待核实，请勿重复申请令牌");
      }
      const now = new Date();
      const activeWhere = { riskUntil: { gt: now } };
      const globalCount = await tx.realtimeTryOnSession.count({ where: activeWhere });
      const userCount = await tx.realtimeTryOnSession.count({ where: { ...activeWhere, userId } });
      if (globalCount >= config.maxActiveGlobal || userCount >= config.maxActivePerUser) tryOnConflict("TRYON_SESSION_CONFLICT", "仍有会话处于风险保留时限，请稍后重试");
      const recent = await tx.realtimeTryOnSession.count({ where: { userId, createdAt: { gt: new Date(now.getTime() - 60_000) } } });
      if (recent >= 3) tryOnConflict("TRYON_RATE_LIMITED", "会话申请过于频繁，请稍后重试");
      const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
      const used = await tx.realtimeTryOnSession.aggregate({ where: { OR: [{ createdAt: { gte: dayStart } }, activeWhere] }, _sum: { reservedUsd: true } });
      const reserve = new Prisma.Decimal(config.usdPerSecond).mul(config.maxSessionSeconds);
      if (reserve.plus(used._sum.reservedUsd ?? 0).gt(new Prisma.Decimal(config.dailyBudgetUsd))) tryOnConflict("TRYON_BUDGET_EXCEEDED", "今日实时试穿应用预算不足");
      return tx.realtimeTryOnSession.create({ data: {
        userId, requestKey, fingerprint, projectId: input.projectId, garmentAssetId: input.garmentAssetId,
        ...(input.outfitSnapshotId ? { outfitSnapshotId: input.outfitSnapshotId } : {}),
        consentVersion: input.consentVersion, modelId: config.modelId, sdkVersion: REALTIME_TRYON_SDK_VERSION,
        usdPerSecond: config.usdPerSecond, reservedUsd: reserve, priceVerifiedAt: config.priceVerifiedAt,
        maxSessionSeconds: config.maxSessionSeconds,
        // Includes token request timeout, last allowed dial, media cap, and clock margin.
        riskUntil: new Date(now.getTime() + (10 + config.tokenTtlSeconds + config.maxSessionSeconds + 5) * 1000),
      } });
    });
  }
}
