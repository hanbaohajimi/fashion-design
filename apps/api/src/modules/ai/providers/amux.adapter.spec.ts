import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiProviderError } from "../ai.errors";
import type { AiGenerationRequest } from "../interfaces/provider.interface";
import {
  AmuxAdapter,
  AmuxHttpError,
  type AmuxAdapterConfig,
  type AmuxTransport,
  type ReferenceImageLoader,
} from "./amux.adapter";

const config: AmuxAdapterConfig = {
  apiKey: () => "test-key",
  baseUrl: "https://api.amux.ai/v1",
  imageModel: "gpt-image-2",
  quality: "high",
  imageCostUsd: 0.08,
  editCostUsd: 0.12,
  creditsPerUsd: 100,
};

const t2iRequest: AiGenerationRequest = {
  taskType: "t2i",
  prompt: "minimal runway look",
  negativePrompt: "watermark, extra fingers",
  width: 1_536,
  height: 1_024,
  background: "opaque",
  steps: 28,
  cfg: 3.5,
  outputFormat: "png",
  quality: "high",
  seed: 9,
};

describe("AmuxAdapter", () => {
  const transport: AmuxTransport = {
    edit: vi.fn(),
    generate: vi.fn(),
  };
  const loadReferenceImage: ReferenceImageLoader = vi.fn();
  let adapter: AmuxAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new AmuxAdapter(config, transport, loadReferenceImage);
  });

  it("使用 OpenAI Images 协议提交文生图并保存可恢复的同步结果", async () => {
    vi.mocked(transport.generate).mockResolvedValue({
      created: 1_786_000_000,
      data: [{ b64_json: "iVBORw0KGgo=" }],
    });

    const job = await adapter.submit(t2iRequest, new AbortController().signal);

    expect(transport.generate).toHaveBeenCalledWith(
      {
        model: "gpt-image-2",
        prompt:
          "minimal runway look\n\nAvoid the following elements: watermark, extra fingers",
        n: 1,
        size: "1536x1024",
        quality: "high",
        background: "opaque",
        output_format: "png",
      },
      expect.any(AbortSignal),
    );
    expect(job).toMatchObject({
      provider: "amux",
      model: "gpt-image-2",
      completedResult: {
        images: [{ url: "data:image/png;base64,iVBORw0KGgo=" }],
      },
      cost: {
        rawCost: 0.08,
        credits: 8,
        currency: "USD",
        billableMegapixels: 2,
        estimated: true,
      },
    });
    await expect(adapter.getStatus(job)).resolves.toEqual({
      status: "completed",
    });
    const result = await adapter.getResult(job);
    expect(result.images).toEqual([
      { url: "data:image/png;base64,iVBORw0KGgo=" },
    ]);
    expect(result.job).not.toHaveProperty("completedResult");
  });

  it("把参考图和局部蒙版下载后作为 multipart 文件提交", async () => {
    vi.mocked(loadReferenceImage)
      .mockResolvedValueOnce({
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "image/png",
        filename: "source.png",
      })
      .mockResolvedValueOnce({
        bytes: new Uint8Array([4, 5, 6]),
        contentType: "image/png",
        filename: "mask.png",
      });
    vi.mocked(transport.edit).mockResolvedValue({
      data: [{ b64_json: "iVBORw0KGgo=" }],
    });

    const job = await adapter.submit(
      {
        taskType: "inpaint",
        prompt: "replace collar with a narrow lapel",
        width: 1_024,
        height: 1_024,
        steps: 28,
        cfg: 3.5,
        referenceImageUrl: "https://assets.test/source.png",
        maskImageUrl: "https://assets.test/mask.png",
        strength: 0.82,
      },
      new AbortController().signal,
    );

    expect(loadReferenceImage).toHaveBeenNthCalledWith(
      1,
      "https://assets.test/source.png",
      expect.any(AbortSignal),
    );
    expect(loadReferenceImage).toHaveBeenNthCalledWith(
      2,
      "https://assets.test/mask.png",
      expect.any(AbortSignal),
    );
    const form = vi.mocked(transport.edit).mock.calls[0]?.[0];
    expect(form).toBeInstanceOf(FormData);
    expect(form?.get("model")).toBe("gpt-image-2");
    expect(form?.get("prompt")).toBe(
      "replace collar with a narrow lapel\n\n" +
        "Modify only the masked area. Allow substantial visual changes while retaining the source elements required by the prompt.",
    );
    expect(form?.get("image")).toBeInstanceOf(Blob);
    expect(form?.get("mask")).toBeInstanceOf(Blob);
    expect(form?.get("response_format")).toBeNull();
    expect(form?.get("output_format")).toBe("png");
    expect(job.cost).toMatchObject({ rawCost: 0.12, credits: 12 });
  });

  it("带参考图的 t2i 自动走图片编辑接口", async () => {
    vi.mocked(loadReferenceImage).mockResolvedValue({
      bytes: new Uint8Array([1]),
      contentType: "image/webp",
      filename: "style.webp",
    });
    vi.mocked(transport.edit).mockResolvedValue({
      data: [{ b64_json: "iVBORw0KGgo=" }],
    });

    await adapter.submit(
      {
        ...t2iRequest,
        referenceImageUrl: "https://assets.test/style.webp",
        strength: 0.72,
      },
      new AbortController().signal,
    );

    expect(transport.edit).toHaveBeenCalledOnce();
    expect(transport.generate).not.toHaveBeenCalled();
  });

  it("special/openai 图片编辑返回 5xx 时把带参考图的 t2i 降级为纯生成", async () => {
    vi.mocked(loadReferenceImage).mockResolvedValue({
      bytes: new Uint8Array([1]),
      contentType: "image/webp",
      filename: "style.webp",
    });
    vi.mocked(transport.edit).mockRejectedValue(
      new AmuxHttpError(503, { error: "upstream unavailable" }),
    );
    vi.mocked(transport.generate).mockResolvedValue({
      data: [{ b64_json: "iVBORw0KGgo=" }],
    });

    const job = await adapter.submit(
      {
        ...t2iRequest,
        referenceImageUrl: "https://assets.test/style.webp",
        strength: 0.72,
      },
      new AbortController().signal,
    );

    expect(transport.edit).toHaveBeenCalledOnce();
    expect(transport.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-image-2",
        prompt:
          "minimal runway look\n\nAvoid the following elements: watermark, extra fingers",
      }),
      expect.any(AbortSignal),
    );
    expect(job.cost).toMatchObject({ rawCost: 0.08, credits: 8 });
  });

  it("inpaint 图片编辑返回 5xx 时不降级为会修改整张图的纯生成", async () => {
    vi.mocked(loadReferenceImage)
      .mockResolvedValueOnce({
        bytes: new Uint8Array([1]),
        contentType: "image/png",
        filename: "source.png",
      })
      .mockResolvedValueOnce({
        bytes: new Uint8Array([2]),
        contentType: "image/png",
        filename: "mask.png",
      });
    vi.mocked(transport.edit).mockRejectedValue(
      new AmuxHttpError(503, { error: "upstream unavailable" }),
    );

    await expect(
      adapter.submit(
        {
          taskType: "inpaint",
          prompt: "replace collar",
          width: 1_024,
          height: 1_024,
          steps: 28,
          cfg: 3.5,
          referenceImageUrl: "https://assets.test/source.png",
          maskImageUrl: "https://assets.test/mask.png",
          strength: 0.72,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", status: 503 });
    expect(transport.generate).not.toHaveBeenCalled();
  });

  it("把 GPT Image 2 的 Base64 结果转换为仅供 Worker 物化的内联图片", async () => {
    vi.mocked(transport.generate).mockResolvedValue({
      data: [{ b64_json: "iVBORw0KGgo=" }],
    });

    const job = await adapter.submit(t2iRequest, new AbortController().signal);

    expect(job.completedResult?.images).toEqual([
      { url: "data:image/png;base64,iVBORw0KGgo=" },
    ]);
  });

  it("保留 Amux 的安全参数错误详情并清除可能出现的密钥", async () => {
    vi.mocked(transport.generate).mockRejectedValue(
      new AmuxHttpError(400, {
        error: {
          message:
            "Unsupported parameter: response_format; key sk-secret123456",
          param: "response_format",
        },
      }),
    );

    const error = await adapter
      .submit(t2iRequest, new AbortController().signal)
      .catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining("response_format"),
    });
    expect(String(error)).not.toContain("sk-secret123456");
  });

  it("映射限流、服务不可用和内容安全错误", async () => {
    vi.mocked(transport.generate)
      .mockRejectedValueOnce(new AmuxHttpError(429, { error: "rate limit" }))
      .mockRejectedValueOnce(new AmuxHttpError(503, { error: "upstream" }))
      .mockRejectedValueOnce(
        new AmuxHttpError(403, { error: { message: "content safety" } }),
      );

    await expect(
      adapter.submit(t2iRequest, new AbortController().signal),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
    await expect(
      adapter.submit(t2iRequest, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      message: "Amux 上游暂时不可用（HTTP 503）",
      retryable: true,
      status: 503,
    });
    await expect(
      adapter.submit(t2iRequest, new AbortController().signal),
    ).rejects.toMatchObject({ code: "CONTENT_FLAGGED", retryable: false });
  });

  it("缺少 API Key 时不会请求网络或泄露凭据", async () => {
    adapter = new AmuxAdapter(
      { ...config, apiKey: () => undefined },
      transport,
      loadReferenceImage,
    );

    const error = await adapter
      .submit(t2iRequest, new AbortController().signal)
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(AiProviderError);
    expect(error).toMatchObject({ code: "AUTH_FAILED" });
    expect(String(error)).not.toContain("test-key");
    expect(transport.generate).not.toHaveBeenCalled();
  });
});
