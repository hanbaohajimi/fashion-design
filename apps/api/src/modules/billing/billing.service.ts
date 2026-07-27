import { Prisma, type PrismaClient } from "@fashion/db";
import {
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { GENERATION_LIMIT_EXCEEDED } from "./billing.errors";

export const BILLING_DB = Symbol("BILLING_DB");

type BillingDatabase = Pick<
  PrismaClient,
  "$executeRaw" | "$queryRaw" | "$transaction"
>;

interface LockedGenerationQuota {
  generationCount: number;
  generationLimit: number;
}

export interface GenerationQuota {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly used: number;
  readonly code?: typeof GENERATION_LIMIT_EXCEEDED.code;
  readonly message?: typeof GENERATION_LIMIT_EXCEEDED.message;
}

@Injectable()
export class BillingService {
  constructor(
    @Inject(BILLING_DB) private readonly database: BillingDatabase,
  ) {}

  async canGenerate(userId: string): Promise<GenerationQuota> {
    return this.database.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<LockedGenerationQuota[]>(
        Prisma.sql`
          SELECT
            "generation_count" AS "generationCount",
            "generation_limit" AS "generationLimit"
          FROM "users"
          WHERE "id" = ${userId}
            AND "deleted_at" IS NULL
          FOR UPDATE
        `,
      );
      const quota = rows[0];

      if (!quota) {
        throw new NotFoundException({
          code: "USER_NOT_FOUND",
          message: "用户不存在",
        });
      }

      const remaining = Math.max(
        quota.generationLimit - quota.generationCount,
        0,
      );
      if (remaining === 0) {
        return {
          allowed: false,
          used: quota.generationCount,
          limit: quota.generationLimit,
          ...GENERATION_LIMIT_EXCEEDED,
        };
      }

      return {
        allowed: true,
        used: quota.generationCount,
        limit: quota.generationLimit,
        remaining,
      };
    });
  }

  async incrementCount(userId: string): Promise<GenerationQuota> {
    const rows = await this.database.$queryRaw<LockedGenerationQuota[]>(
      Prisma.sql`
        UPDATE "users"
        SET "generation_count" = "generation_count" + 1
        WHERE "id" = ${userId}
          AND "deleted_at" IS NULL
        RETURNING
          "generation_count" AS "generationCount",
          "generation_limit" AS "generationLimit"
      `,
    );
    const quota = rows[0];

    if (!quota) {
      throw new NotFoundException({
        code: "USER_NOT_FOUND",
        message: "用户不存在",
      });
    }

    const remaining = Math.max(
      quota.generationLimit - quota.generationCount,
      0,
    );
    return {
      allowed: remaining > 0,
      used: quota.generationCount,
      limit: quota.generationLimit,
      remaining,
      ...(remaining === 0 ? GENERATION_LIMIT_EXCEEDED : {}),
    };
  }

  /** 供部署环境的月初 cron 调用，只重置用户计数器。 */
  async resetMonthlyCounts(): Promise<number> {
    return this.database.$executeRaw(
      Prisma.sql`
        UPDATE "users"
        SET "generation_count" = 0
        WHERE "generation_count" <> 0
      `,
    );
  }
}
