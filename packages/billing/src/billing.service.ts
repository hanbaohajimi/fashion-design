import {
  GenerationTaskStatus,
  Prisma,
  type PrismaClient,
} from "@fashion/db";

export const GENERATION_LIMIT_EXCEEDED = {
  code: "GEN_LIMIT_EXCEEDED",
  message: "本月免费生成次数已用完",
  remaining: 0,
} as const;

export type BillingDatabase = Pick<
  PrismaClient,
  "$executeRaw" | "$queryRaw" | "$transaction"
>;
export type BillingQueryClient = Pick<PrismaClient, "$queryRaw">;
export type LockedGenerationQuotaTransaction = Pick<
  Prisma.TransactionClient,
  "$queryRaw" | "generationTask" | "project" | "workspaceMember"
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

export class BillingUserNotFoundError extends Error {
  readonly code = "USER_NOT_FOUND";

  constructor() {
    super("用户不存在");
    this.name = "BillingUserNotFoundError";
  }
}

export class BillingService {
  constructor(private readonly database: BillingDatabase) {}

  async canGenerate(userId: string): Promise<GenerationQuota> {
    return this.withLockedGenerationQuota(
      userId,
      async (_transaction, quota) => quota,
    );
  }

  async withLockedGenerationQuota<T>(
    userId: string,
    operation: (
      transaction: LockedGenerationQuotaTransaction,
      quota: GenerationQuota,
    ) => Promise<T>,
  ): Promise<T> {
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
      const stored = rows[0];

      if (!stored) {
        throw new BillingUserNotFoundError();
      }

      const activeCount = await transaction.generationTask.count({
        where: {
          countedAt: null,
          status: {
            in: [
              GenerationTaskStatus.QUEUED,
              GenerationTaskStatus.RUNNING,
            ],
          },
          userId,
        },
      });
      const used = stored.generationCount + activeCount;
      const remaining = Math.max(stored.generationLimit - used, 0);
      const quota: GenerationQuota =
        remaining === 0
          ? {
              allowed: false,
              used,
              limit: stored.generationLimit,
              ...GENERATION_LIMIT_EXCEEDED,
            }
          : {
              allowed: true,
              used,
              limit: stored.generationLimit,
              remaining,
            };
      return operation(transaction, quota);
    });
  }

  async incrementCount(
    userId: string,
    queryClient: BillingQueryClient = this.database,
  ): Promise<GenerationQuota> {
    const rows = await queryClient.$queryRaw<LockedGenerationQuota[]>(
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
      throw new BillingUserNotFoundError();
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
