import { GenerationTaskStatus, prisma } from "@fashion/db";
import { afterAll, describe, expect, it } from "vitest";

import { BillingService } from "./billing.service";

const service = new BillingService(prisma);

describe("BillingService PostgreSQL concurrency", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("PostgreSQL 并发 10 次原子自增不会丢失更新", async () => {
    const user = await prisma.user.create({
      data: {
        email: `billing-${crypto.randomUUID()}@example.com`,
        generationLimit: 100,
      },
    });

    try {
      await Promise.all(
        Array.from({ length: 10 }, () => service.incrementCount(user.id)),
      );
      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });

      expect(stored.generationCount).toBe(10);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("同一用户并发准入只创建额度允许数量的 queued task", async () => {
    const user = await prisma.user.create({
      data: {
        email: `billing-admission-${crypto.randomUUID()}@example.com`,
        generationLimit: 1,
      },
    });

    try {
      const admitted = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          service.withLockedGenerationQuota(
            user.id,
            async (transaction, quota) => {
              if (!quota.allowed) return null;
              return transaction.generationTask.create({
                data: {
                  id: `quota-${user.id}-${index}`,
                  input: {
                    height: 512,
                    prompt: "quota concurrency",
                    taskType: "t2i",
                    width: 512,
                  },
                  status: GenerationTaskStatus.QUEUED,
                  taskType: "t2i",
                  userId: user.id,
                },
              });
            },
          ),
        ),
      );

      expect(admitted.filter(Boolean)).toHaveLength(1);
      await expect(
        prisma.generationTask.count({
          where: {
            countedAt: null,
            status: GenerationTaskStatus.QUEUED,
            userId: user.id,
          },
        }),
      ).resolves.toBe(1);
      await expect(
        prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      ).resolves.toMatchObject({ generationCount: 0 });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
