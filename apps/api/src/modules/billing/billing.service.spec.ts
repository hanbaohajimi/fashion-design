import { describe, expect, it, vi } from "vitest";

import { BillingService } from "./billing.service";

describe("BillingService", () => {
  it("count 等于 limit 时 canGenerate 返回标准超限结果", async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          generationCount: 100,
          generationLimit: 100,
        },
      ]),
      generationTask: {
        count: vi.fn().mockResolvedValue(0),
      },
    };
    const database = {
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn(),
      $transaction: vi.fn(
        async (callback: (value: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const service = new BillingService(database as never);

    await expect(service.canGenerate("user-1")).resolves.toEqual({
      allowed: false,
      code: "GEN_LIMIT_EXCEEDED",
      limit: 100,
      message: "本月免费生成次数已用完",
      remaining: 0,
      used: 100,
    });
    expect(database.$transaction).toHaveBeenCalledOnce();
  });

  it("未超限时返回准确的剩余次数", async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          generationCount: 7,
          generationLimit: 20,
        },
      ]),
      generationTask: {
        count: vi.fn().mockResolvedValue(0),
      },
    };
    const database = {
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn(),
      $transaction: vi.fn(
        async (callback: (value: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };

    await expect(
      new BillingService(database as never).canGenerate("user-1"),
    ).resolves.toEqual({
      allowed: true,
      limit: 20,
      remaining: 13,
      used: 7,
    });
  });

  it("把 queued/running 且未计费任务计入有效额度占用", async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          generationCount: 7,
          generationLimit: 10,
        },
      ]),
      generationTask: {
        count: vi.fn().mockResolvedValue(2),
      },
    };
    const database = {
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn(),
      $transaction: vi.fn(
        async (callback: (value: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };

    await expect(
      new BillingService(database as never).canGenerate("user-1"),
    ).resolves.toEqual({
      allowed: true,
      limit: 10,
      remaining: 1,
      used: 9,
    });
    expect(transaction.generationTask.count).toHaveBeenCalledWith({
      where: {
        countedAt: null,
        status: { in: ["QUEUED", "RUNNING"] },
        userId: "user-1",
      },
    });
  });

  it("并发调用 incrementCount 10 次只原子增加 10", async () => {
    let generationCount = 0;
    const database = {
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn(async () => {
        generationCount += 1;
        return [
          {
            generationCount,
            generationLimit: 100,
          },
        ];
      }),
      $transaction: vi.fn(),
    };
    const service = new BillingService(database as never);

    await Promise.all(
      Array.from({ length: 10 }, () => service.incrementCount("user-1")),
    );

    expect(generationCount).toBe(10);
    expect(database.$queryRaw).toHaveBeenCalledTimes(10);
  });
});
