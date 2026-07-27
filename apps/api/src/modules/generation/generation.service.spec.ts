import { HttpStatus } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AiProviderJob } from "../ai/interfaces/provider.interface";
import { GenerationLimitExceededException } from "../billing/billing.errors";
import { GenerationService } from "./generation.service";

const job: AiProviderJob = {
  provider: "mock",
  providerJobId: "mock-job-1",
  model: "mock/image-generator",
  taskType: "t2i",
  submittedAt: "2026-01-01T00:00:00.000Z",
  cost: {
    rawCost: 0,
    credits: 0,
    currency: "USD",
    billableMegapixels: 1,
    estimated: true,
  },
};

const request = {
  taskType: "t2i" as const,
  prompt: "fashion editorial",
  width: 1024,
  height: 1024,
  steps: 28,
  cfg: 3.5,
};

describe("GenerationService billing boundary", () => {
  it("超限时返回 429 和可读错误体且不提交 Provider", async () => {
    const aiService = {
      getResult: vi.fn(),
      getStatus: vi.fn(),
      submit: vi.fn(),
    };
    const billingService = {
      canGenerate: vi.fn().mockResolvedValue({
        allowed: false,
        code: "GEN_LIMIT_EXCEEDED",
        limit: 100,
        message: "本月免费生成次数已用完",
        remaining: 0,
        used: 100,
      }),
      incrementCount: vi.fn(),
    };
    const service = new GenerationService(
      aiService as never,
      billingService as never,
    );

    const error = await service
      .submit("user-1", request)
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(GenerationLimitExceededException);
    expect(error).toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: {
        code: "GEN_LIMIT_EXCEEDED",
        message: "本月免费生成次数已用完",
        remaining: 0,
      },
    });
    expect(aiService.submit).not.toHaveBeenCalled();
  });

  it("Provider 结果失败时不触发 incrementCount", async () => {
    const providerError = new Error("provider failed");
    const aiService = {
      getResult: vi.fn().mockRejectedValue(providerError),
      getStatus: vi.fn(),
      submit: vi.fn(),
    };
    const billingService = {
      canGenerate: vi.fn(),
      incrementCount: vi.fn(),
    };
    const service = new GenerationService(
      aiService as never,
      billingService as never,
    );

    await expect(service.getResult("user-1", job)).rejects.toBe(
      providerError,
    );
    expect(billingService.incrementCount).not.toHaveBeenCalled();
  });

  it("Provider 成功返回结果后才增加一次计数", async () => {
    const result = {
      job,
      images: [{ url: "https://cdn.test/generated.png" }],
      cost: job.cost,
    };
    const aiService = {
      getResult: vi.fn().mockResolvedValue(result),
      getStatus: vi.fn(),
      submit: vi.fn(),
    };
    const billingService = {
      canGenerate: vi.fn(),
      incrementCount: vi.fn().mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        used: 1,
      }),
    };
    const service = new GenerationService(
      aiService as never,
      billingService as never,
    );

    await expect(service.getResult("user-1", job)).resolves.toBe(result);
    expect(billingService.incrementCount).toHaveBeenCalledOnce();
    expect(billingService.incrementCount).toHaveBeenCalledWith("user-1");
  });

  it("提交只通过 BillingService 判断额度，不读取字段", async () => {
    const aiService = {
      getResult: vi.fn(),
      getStatus: vi.fn(),
      submit: vi.fn().mockResolvedValue(job),
    };
    const billingService = {
      canGenerate: vi.fn().mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 50,
        used: 50,
      }),
      incrementCount: vi.fn(),
    };
    const service = new GenerationService(
      aiService as never,
      billingService as never,
    );

    await expect(service.submit("user-1", request)).resolves.toBe(job);
    expect(billingService.canGenerate).toHaveBeenCalledWith("user-1");
    expect(aiService.submit).toHaveBeenCalledWith(request);
  });
});
