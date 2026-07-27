import { prisma } from "@fashion/db";
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
        Array.from({ length: 10 }, () =>
          service.incrementCount(user.id),
        ),
      );
      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });

      expect(stored.generationCount).toBe(10);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
