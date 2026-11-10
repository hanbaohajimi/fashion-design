import type { AiGenerationRequest } from "@fashion/ai";
import { describe, expect, it, vi } from "vitest";
import { refreshGenerationImageSources } from "./generation-image-sources";

const source = "https://storage.test/source.png?expired=yes";
const detail = "https://storage.test/detail.png?expired=yes";
const request: AiGenerationRequest = {
  taskType: "i2i",
  prompt: "改领口",
  width: 1024,
  height: 1024,
  referenceImageUrl: source,
  referenceImageUrls: [source, detail],
  referenceImages: [
    { url: source, order: 0, role: "silhouette_ref", weight: 0.9 },
    { url: detail, order: 1, role: "detail_ref", weight: 0.5 },
  ],
};
const snapshot = {
  imageSources: {
    version: 1,
    entries: [
      { url: source, objectKey: "source.png" },
      { url: detail, objectKey: "detail.png" },
    ],
  },
};
const createStorage = () => ({
  downloadUrl: vi.fn(async (key: string) => `https://fresh.test/${key}`),
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
});

describe("生成任务更新参考地址", () => {
  it("每次尝试重新签名，所有别名和用途同步且不改写原始记录", async () => {
    const storage = createStorage();
    const original = structuredClone(request);
    const first = await refreshGenerationImageSources(
      request,
      snapshot,
      storage,
    );
    storage.downloadUrl.mockImplementation(
      async (key) => `https://retry.test/${key}`,
    );
    const retry = await refreshGenerationImageSources(
      request,
      snapshot,
      storage,
    );
    expect(first.sourceObjectKey).toBe("source.png");
    expect(first.request.referenceImageUrl).toBe(
      "https://fresh.test/source.png",
    );
    expect(retry.request).toMatchObject({
      referenceImageUrl: "https://retry.test/source.png",
      referenceImageUrls: [
        "https://retry.test/source.png",
        "https://retry.test/detail.png",
      ],
      referenceImages: [
        {
          url: "https://retry.test/source.png",
          order: 0,
          role: "silhouette_ref",
          weight: 0.9,
        },
        {
          url: "https://retry.test/detail.png",
          order: 1,
          role: "detail_ref",
          weight: 0.5,
        },
      ],
    });
    expect(request).toEqual(original);
  });

  it("同一文件的不同旧签名使用同一新签名，保留各自用途", async () => {
    const storage = createStorage();
    const result = await refreshGenerationImageSources(
      request,
      {
        imageSources: {
          version: 1,
          entries: [
            { url: source, objectKey: "same.png" },
            { url: detail, objectKey: "same.png" },
          ],
        },
      },
      storage,
    );
    expect(storage.downloadUrl).toHaveBeenCalledOnce();
    expect(result.request.referenceImageUrls).toEqual([
      "https://fresh.test/same.png",
      "https://fresh.test/same.png",
    ]);
    expect(result.request).toMatchObject({
      referenceImages: [{ role: "silhouette_ref" }, { role: "detail_ref" }],
    });
  });

  it.each([null, {}, { positivePrompt: "legacy" }])(
    "旧任务缺少内部记录时不按地址猜测文件权限 %#",
    async (compiled) => {
      const storage = createStorage();
      expect(
        await refreshGenerationImageSources(request, compiled, storage),
      ).toEqual({ request });
      expect(storage.downloadUrl).not.toHaveBeenCalled();
    },
  );

  it.each([
    { version: 2, entries: [] },
    { version: 1, entries: [{ url: source, objectKey: "" }] },
    {
      version: 1,
      entries: [
        { url: "https://unused.test/changed.png", objectKey: "changed.png" },
      ],
    },
    {
      version: 1,
      entries: [
        { url: source, objectKey: "one.png" },
        { url: source, objectKey: "two.png" },
      ],
    },
  ])("损坏或与任务不符的记录在签名前拒绝 %#", async (imageSources) => {
    const storage = createStorage();
    await expect(
      refreshGenerationImageSources(request, { imageSources }, storage),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST", retryable: false });
    expect(storage.downloadUrl).not.toHaveBeenCalled();
  });

  it("缺少存储签名能力时明确返回可重试失败，不提交过期地址", async () => {
    await expect(
      refreshGenerationImageSources(request, snapshot, undefined),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
  });
});
