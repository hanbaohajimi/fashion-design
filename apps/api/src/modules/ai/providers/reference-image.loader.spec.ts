import { afterEach, describe, expect, it, vi } from "vitest";

import { createReferenceImageLoader } from "./amux.adapter";

describe("ReferenceImageLoader", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("只下载管理员明确允许的对象存储来源", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/png" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const loader = createReferenceImageLoader({
      allowedOrigins: ["http://localhost:9000/fashion-assets"],
    });

    await expect(
      loader(
        "http://localhost:9000/fashion-assets/private.png?signature=1",
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      contentType: "image/png",
      filename: "private.png",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("拒绝未授权来源且不会发起 SSRF 请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const loader = createReferenceImageLoader({
      allowedOrigins: ["https://assets.example.com"],
    });

    await expect(
      loader(
        "http://169.254.169.254/latest/meta-data",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: "INVALID_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("拒绝超过上限的参考图响应", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: { "Content-Type": "image/png" },
          status: 200,
        }),
      ),
    );
    const loader = createReferenceImageLoader({
      allowedOrigins: ["https://assets.example.com"],
      maxBytes: 3,
    });

    await expect(
      loader(
        "https://assets.example.com/too-large.png",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: "INVALID_RESPONSE" });
  });
});
