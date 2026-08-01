import { describe, expect, it, vi } from "vitest";

import { AiProviderError } from "./ai.errors";
import { AiService } from "./ai.service";
import type {
  AiGenerationRequest,
  AiProvider,
  AiProviderJob,
} from "./interfaces/provider.interface";
import { MockAdapter } from "./providers/mock.adapter";

const request: AiGenerationRequest = {
  taskType: "t2i",
  prompt: "minimal fashion editorial",
  width: 1_024,
  height: 1_024,
  steps: 28,
  cfg: 3.5,
};

describe("AiService", () => {
  it("Provider 5xx 额外重试 2 次并指数退避", async () => {
    const submit = vi
      .fn<AiProvider["submit"]>()
      .mockRejectedValueOnce(unavailable("primary"))
      .mockRejectedValueOnce(unavailable("primary"))
      .mockResolvedValue(createJob("primary"));
    const provider = providerWithSubmit("primary", submit);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const service = createService([provider], {
      primaryProvider: "primary",
      sleep,
      retryBaseMs: 250,
    });

    await expect(service.submit(request)).resolves.toMatchObject({
      provider: "primary",
    });
    expect(submit).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[250], [500]]);
  });

  it("rate limit 立即降级到备选 Provider", async () => {
    const primary = new MockAdapter({
      name: "primary",
      submitError: new AiProviderError({
        code: "RATE_LIMITED",
        provider: "primary",
        message: "rate limited",
      }),
    });
    const fallback = new MockAdapter({ name: "fallback" });
    const service = createService([primary, fallback], {
      primaryProvider: "primary",
      fallbackProvider: "fallback",
    });

    const job = await service.submit(request);

    expect(job.provider).toBe("fallback");
    expect(fallback.submittedRequests).toEqual([request]);
  });

  it("主 Provider 持续不可用时降级到备选 Provider", async () => {
    const primary = new MockAdapter({
      name: "primary",
      submitError: unavailable("primary"),
    });
    const fallback = new MockAdapter({ name: "fallback" });
    const service = createService([primary, fallback], {
      primaryProvider: "primary",
      fallbackProvider: "fallback",
    });

    const job = await service.submit(request);

    expect(job.provider).toBe("fallback");
    expect(fallback.submittedRequests).toEqual([request]);
  });

  it("备选 Provider 不支持任务类型时保留主渠道原始错误", async () => {
    const primary = new MockAdapter({
      name: "primary",
      submitError: new AiProviderError({
        code: "RATE_LIMITED",
        provider: "primary",
        message: "rate limited",
      }),
    });
    const fallback = providerWithSubmit("fallback", vi.fn());
    fallback.supports = () => false;
    const service = createService([primary, fallback], {
      primaryProvider: "primary",
      fallbackProvider: "fallback",
    });

    await expect(service.submit(request)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      provider: "primary",
    });
    expect(fallback.submit).not.toHaveBeenCalled();
  });

  it("CONTENT_FLAGGED 不重试也不降级", async () => {
    const submit = vi.fn<AiProvider["submit"]>().mockRejectedValue(
      new AiProviderError({
        code: "CONTENT_FLAGGED",
        provider: "primary",
        message: "flagged",
      }),
    );
    const fallback = new MockAdapter({ name: "fallback" });
    const service = createService(
      [providerWithSubmit("primary", submit), fallback],
      {
        primaryProvider: "primary",
        fallbackProvider: "fallback",
      },
    );

    await expect(service.submit(request)).rejects.toMatchObject({
      code: "CONTENT_FLAGGED",
    });
    expect(submit).toHaveBeenCalledOnce();
    expect(fallback.submittedRequests).toHaveLength(0);
  });

  it("超时会中止 Provider 且返回标准 TIMEOUT", async () => {
    const slow = new MockAdapter({ name: "slow", latencyMs: 50 });
    const service = createService([slow], {
      primaryProvider: "slow",
      timeoutMs: 5,
    });

    await expect(service.submit(request)).rejects.toMatchObject({
      code: "TIMEOUT",
      retryable: false,
    });
    expect(slow.submittedRequests).toHaveLength(0);
  });

  it("只改 primaryProvider 配置即可切换 Provider", async () => {
    const first = new MockAdapter({ name: "first" });
    const second = new MockAdapter({ name: "second" });
    const service = createService([first, second], {
      primaryProvider: "second",
    });

    const job = await service.submit(request);

    expect(job.provider).toBe("second");
    expect(first.submittedRequests).toHaveLength(0);
    expect(second.submittedRequests).toEqual([request]);
  });

  it("状态和结果始终路由回创建 job 的 Provider", async () => {
    const first = new MockAdapter({ name: "first" });
    const second = new MockAdapter({ name: "second" });
    const service = createService([first, second], {
      primaryProvider: "first",
      fallbackProvider: "second",
    });
    const job = await service.submit(request);

    await expect(service.getStatus(job)).resolves.toEqual({
      status: "completed",
    });
    await expect(service.getResult(job)).resolves.toMatchObject({
      job: { provider: "first" },
    });
  });

  it("在调用 Provider 前严格校验 i2i 参考图", async () => {
    const mock = new MockAdapter();
    const service = createService([mock], {
      primaryProvider: "mock",
    });

    await expect(
      service.submit({
        ...request,
        taskType: "i2i",
        strength: 0.7,
      } as AiGenerationRequest),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(mock.submittedRequests).toHaveLength(0);
  });
});

function unavailable(provider: string): AiProviderError {
  return new AiProviderError({
    code: "PROVIDER_UNAVAILABLE",
    provider,
    message: "unavailable",
    retryable: true,
    status: 503,
  });
}

function createJob(provider: string): AiProviderJob {
  return {
    provider,
    providerJobId: `${provider}-job`,
    model: "test/model",
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
}

function providerWithSubmit(
  name: string,
  submit: AiProvider["submit"],
): AiProvider {
  return {
    name,
    supports: () => true,
    submit,
    getStatus: vi.fn(),
    getResult: vi.fn(),
  };
}

function createService(
  providers: AiProvider[],
  overrides: Partial<{
    primaryProvider: string;
    fallbackProvider: string;
    timeoutMs: number;
    retryBaseMs: number;
    sleep: (milliseconds: number) => Promise<void>;
  }> = {},
): AiService {
  return new AiService(providers, {
    primaryProvider: overrides.primaryProvider ?? providers[0]?.name ?? "mock",
    ...(overrides.fallbackProvider
      ? { fallbackProvider: overrides.fallbackProvider }
      : {}),
    timeoutMs: overrides.timeoutMs ?? 60_000,
    retryBaseMs: overrides.retryBaseMs ?? 1,
    maxRetries: 2,
    ...(overrides.sleep ? { sleep: overrides.sleep } : {}),
  });
}
