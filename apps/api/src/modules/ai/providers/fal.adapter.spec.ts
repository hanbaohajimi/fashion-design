import { ApiError } from "@fal-ai/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiProviderError } from "../ai.errors";
import type {
  AiGenerationRequest,
  AiProviderJob,
} from "../interfaces/provider.interface";
import {
  FalAdapter,
  type FalAdapterConfig,
  type FalQueueTransport,
} from "./fal.adapter";

const config: FalAdapterConfig = {
  credentials: () => "test-key",
  t2iModel: "fal-ai/flux/dev",
  i2iModel: "fal-ai/flux/dev/image-to-image",
  inpaintModel: "fal-ai/flux-general/inpainting",
  t2iCostPerMegapixel: 0.04,
  i2iCostPerMegapixel: 0.06,
  inpaintCostPerMegapixel: 0.02,
  creditsPerUsd: 100,
};

const t2iRequest: AiGenerationRequest = {
  taskType: "t2i",
  prompt: "runway look",
  width: 1_536,
  height: 1_024,
  steps: 28,
  cfg: 3.5,
  seed: 9,
};

describe("FalAdapter", () => {
  const transport: FalQueueTransport = {
    submit: vi.fn(),
    status: vi.fn(),
    result: vi.fn(),
  };
  let adapter: FalAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new FalAdapter(config, transport);
  });

  it("映射 t2i 参数并返回非阻塞队列 job 与成本", async () => {
    vi.mocked(transport.submit).mockResolvedValue({
      requestId: "fal-job-1",
    });

    const job = await adapter.submit(
      t2iRequest,
      new AbortController().signal,
    );

    expect(transport.submit).toHaveBeenCalledWith(
      "fal-ai/flux/dev",
      {
        prompt: "runway look",
        image_size: { width: 1_536, height: 1_024 },
        num_inference_steps: 28,
        guidance_scale: 3.5,
        seed: 9,
        num_images: 1,
        enable_safety_checker: true,
        output_format: "png",
        sync_mode: false,
      },
      expect.any(AbortSignal),
    );
    expect(job.providerJobId).toBe("fal-job-1");
    expect(job.cost).toEqual({
      rawCost: 0.08,
      credits: 8,
      currency: "USD",
      billableMegapixels: 2,
      estimated: true,
    });
  });

  it("映射 i2i 的参考图和强度参数", async () => {
    vi.mocked(transport.submit).mockResolvedValue({
      requestId: "fal-job-2",
    });
    const request: AiGenerationRequest = {
      taskType: "i2i",
      prompt: "silk variation",
      width: 1_024,
      height: 1_024,
      steps: 40,
      cfg: 4,
      referenceImageUrl: "https://cdn.test/ref.png",
      strength: 0.75,
    };

    await adapter.submit(request, new AbortController().signal);

    expect(transport.submit).toHaveBeenCalledWith(
      "fal-ai/flux/dev/image-to-image",
      expect.objectContaining({
        image_url: "https://cdn.test/ref.png",
        strength: 0.75,
      }),
      expect.any(AbortSignal),
    );
  });

  it("映射 inpaint 图片、掩码并使用独立低单价", async () => {
    vi.mocked(transport.submit).mockResolvedValue({
      requestId: "fal-job-inpaint",
    });

    const job = await adapter.submit(
      {
        taskType: "inpaint",
        prompt: "replace collar with narrow lapel",
        width: 1024,
        height: 1024,
        steps: 28,
        cfg: 3.5,
        referenceImageUrl: "https://cdn.test/source.png",
        maskImageUrl: "https://cdn.test/mask.png",
        strength: 0.82,
      },
      new AbortController().signal,
    );

    expect(transport.submit).toHaveBeenCalledWith(
      "fal-ai/flux-general/inpainting",
      expect.objectContaining({
        image_url: "https://cdn.test/source.png",
        mask_url: "https://cdn.test/mask.png",
        strength: 0.82,
      }),
      expect.any(AbortSignal),
    );
    expect(job.cost).toMatchObject({ rawCost: 0.04, credits: 4 });
    expect(job.cost.rawCost).toBeLessThan(0.08);
  });

  it("把编译器负向约束映射到 Provider 参数", async () => {
    vi.mocked(transport.submit).mockResolvedValue({
      requestId: "fal-job-negative",
    });

    await adapter.submit(
      {
        ...t2iRequest,
        negativePrompt: "watermark, oversized shoulder",
      },
      new AbortController().signal,
    );

    expect(transport.submit).toHaveBeenCalledWith(
      "fal-ai/flux/dev",
      expect.objectContaining({
        negative_prompt: "watermark, oversized shoulder",
      }),
      expect.any(AbortSignal),
    );
  });

  it("映射队列状态并解析图片结果", async () => {
    const job = createJob();
    vi.mocked(transport.status).mockResolvedValue({
      status: "IN_QUEUE",
      queuePosition: 3,
    });
    vi.mocked(transport.result).mockResolvedValue({
      images: [
        {
          url: "https://cdn.test/output.png",
          width: 1024,
          height: 1024,
          content_type: "image/png",
        },
      ],
      seed: 10,
      has_nsfw_concepts: [false],
    });

    await expect(
      adapter.getStatus(job, new AbortController().signal),
    ).resolves.toEqual({ status: "queued", queuePosition: 3 });
    await expect(
      adapter.getResult(job, new AbortController().signal),
    ).resolves.toEqual(
      expect.objectContaining({
        images: [
          {
            url: "https://cdn.test/output.png",
            width: 1024,
            height: 1024,
            contentType: "image/png",
          },
        ],
        seed: 10,
      }),
    );
  });

  it("CONTENT_FLAGGED 使用标准错误且不可重试", async () => {
    vi.mocked(transport.result).mockResolvedValue({
      images: [{ url: "https://cdn.test/blocked.png" }],
      has_nsfw_concepts: [true],
    });

    await expect(
      adapter.getResult(createJob(), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "CONTENT_FLAGGED",
      retryable: false,
    });
  });

  it("把 5xx 和 rate limit 映射为标准错误", async () => {
    vi.mocked(transport.submit)
      .mockRejectedValueOnce(
        new ApiError({
          message: "upstream unavailable",
          status: 503,
        }),
      )
      .mockRejectedValueOnce(
        new ApiError({
          message: "too many requests",
          status: 429,
        }),
      );

    await expect(
      adapter.submit(t2iRequest, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
      status: 503,
    });
    await expect(
      adapter.submit(t2iRequest, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: false,
      status: 429,
    });
  });

  it("缺失凭据时不调用传输层且不泄露密钥", async () => {
    adapter = new FalAdapter(
      { ...config, credentials: () => undefined },
      transport,
    );

    const error = await adapter
      .submit(t2iRequest, new AbortController().signal)
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(AiProviderError);
    expect(error).toMatchObject({ code: "AUTH_FAILED" });
    expect(String(error)).not.toContain("test-key");
    expect(transport.submit).not.toHaveBeenCalled();
  });
});

function createJob(): AiProviderJob {
  return {
    provider: "fal",
    providerJobId: "fal-job-1",
    model: "fal-ai/flux/dev",
    taskType: "t2i",
    submittedAt: "2026-01-01T00:00:00.000Z",
    cost: {
      rawCost: 0.04,
      credits: 4,
      currency: "USD",
      billableMegapixels: 1,
      estimated: true,
    },
  };
}
