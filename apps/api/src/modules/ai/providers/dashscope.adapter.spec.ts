import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AiGenerationRequest,
  AiProviderJob,
} from "../interfaces/provider.interface";
import {
  DashScopeAdapter,
  DashScopeHttpError,
  type DashScopeAdapterConfig,
  type DashScopeTransport,
  type ReferenceImageLoader,
} from "./dashscope.adapter";

const config: DashScopeAdapterConfig = {
  apiKey: () => "dashscope-key",
  baseUrl: "https://workspace.cn-beijing.maas.aliyuncs.com",
  imageModel: "wan2.7-image-pro",
  imageSize: "2K",
  imageCostCny: 0.5,
  creditsPerCny: 20,
};

const t2iRequest: AiGenerationRequest = {
  taskType: "t2i",
  prompt: "品牌色一致的成衣系列",
  negativePrompt: "水印，错误文字",
  width: 1_024,
  height: 1_024,
  steps: 28,
  cfg: 3.5,
  seed: 42,
};

describe("DashScopeAdapter", () => {
  const transport: DashScopeTransport = {
    status: vi.fn(),
    submit: vi.fn(),
  };
  const loadReferenceImage: ReferenceImageLoader = vi.fn();
  let adapter: DashScopeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new DashScopeAdapter(config, transport, loadReferenceImage);
  });

  it("以异步任务协议提交 Wan 2.7 文生图", async () => {
    vi.mocked(transport.submit).mockResolvedValue({
      output: { task_id: "dash-job-1", task_status: "PENDING" },
      request_id: "request-1",
    });

    const job = await adapter.submit(t2iRequest, new AbortController().signal);

    expect(transport.submit).toHaveBeenCalledWith(
      {
        model: "wan2.7-image-pro",
        input: {
          messages: [
            {
              role: "user",
              content: [
                {
                  text: "品牌色一致的成衣系列\n\n请避免出现：水印，错误文字",
                },
              ],
            },
          ],
        },
        parameters: {
          n: 1,
          seed: 42,
          size: "2K",
          thinking_mode: true,
          watermark: false,
        },
      },
      expect.any(AbortSignal),
    );
    expect(job).toMatchObject({
      provider: "dashscope",
      providerJobId: "dash-job-1",
      cost: {
        rawCost: 0.5,
        credits: 10,
        currency: "CNY",
      },
    });
  });

  it("私有参考图转成 Base64 后提交，且不支持蒙版任务", async () => {
    vi.mocked(loadReferenceImage).mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      filename: "reference.png",
    });
    vi.mocked(transport.submit).mockResolvedValue({
      output: { task_id: "dash-job-2", task_status: "PENDING" },
    });

    await adapter.submit(
      {
        taskType: "i2i",
        prompt: "保留廓形并调整面料",
        width: 1_024,
        height: 1_024,
        steps: 28,
        cfg: 3.5,
        referenceImageUrl: "http://localhost:9000/private.png?signature=1",
        strength: 0.72,
      },
      new AbortController().signal,
    );

    const body = vi.mocked(transport.submit).mock.calls[0]?.[0];
    expect(body).toMatchObject({
      input: {
        messages: [
          {
            content: [
              { image: "data:image/png;base64,AQID" },
              { text: "保留廓形并调整面料" },
            ],
          },
        ],
      },
    });
    expect(adapter.supports("inpaint")).toBe(false);
  });

  it("映射任务状态并从成功响应提取临时图片 URL", async () => {
    const job = createJob();
    vi.mocked(transport.status)
      .mockResolvedValueOnce({
        output: { task_id: "dash-job-1", task_status: "RUNNING" },
      })
      .mockResolvedValueOnce({
        output: {
          task_id: "dash-job-1",
          task_status: "SUCCEEDED",
          choices: [
            {
              message: {
                content: [
                  {
                    type: "image",
                    image: "https://dashscope.test/result.png",
                  },
                ],
              },
            },
          ],
        },
      });

    await expect(
      adapter.getStatus(job, new AbortController().signal),
    ).resolves.toEqual({ status: "running" });
    await expect(
      adapter.getResult(job, new AbortController().signal),
    ).resolves.toMatchObject({
      images: [{ url: "https://dashscope.test/result.png" }],
    });
  });

  it("映射限流和内容审核错误", async () => {
    vi.mocked(transport.submit)
      .mockRejectedValueOnce(
        new DashScopeHttpError(429, { code: "Throttling" }),
      )
      .mockRejectedValueOnce(
        new DashScopeHttpError(400, { code: "DataInspectionFailed" }),
      );

    await expect(
      adapter.submit(t2iRequest, new AbortController().signal),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(
      adapter.submit(t2iRequest, new AbortController().signal),
    ).rejects.toMatchObject({ code: "CONTENT_FLAGGED" });
  });
});

function createJob(): AiProviderJob {
  return {
    provider: "dashscope",
    providerJobId: "dash-job-1",
    model: "wan2.7-image-pro",
    taskType: "t2i",
    submittedAt: "2026-08-01T00:00:00.000Z",
    cost: {
      rawCost: 0.5,
      credits: 10,
      currency: "CNY",
      billableMegapixels: 2,
      estimated: true,
    },
  };
}
