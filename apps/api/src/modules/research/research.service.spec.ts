import { afterEach, describe, expect, it, vi } from "vitest";

import { ResearchService } from "./research.service";

const originalKey = process.env.BRAVE_SEARCH_API_KEY;
const originalAmuxKey = process.env.AMUX_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
  else process.env.BRAVE_SEARCH_API_KEY = originalKey;
  if (originalAmuxKey === undefined) delete process.env.AMUX_API_KEY;
  else process.env.AMUX_API_KEY = originalAmuxKey;
  vi.unstubAllGlobals();
});

function createHarness(model?: unknown) {
  const access = { require: vi.fn().mockResolvedValue({ capabilities: { read: true } }) };
  return { access, service: new ResearchService(access as never, model as never) };
}

describe("ResearchService", () => {
  it("接收供应商标准元数据，同时只投影应用需要的检索字段", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      type: "search", query: { original: "风衣", more_results_available: false },
      web: { type: "search", family_friendly: true, results: [{
        title: "Vogue参考", url: "https://www.vogue.com/article/a", description: "结构与廓形摘要",
        meta_url: { hostname: "www.vogue.com" }, language: "zh", age: "1 day ago",
        thumbnail: { src: "https://cdn.example.com/a.jpg", original: "https://cdn.example.com/original.jpg", logo: false },
      }] },
    }), { status: 200 })));
    const result = await createHarness().service.search("user", "project", "风衣");
    expect(result.items).toMatchObject([{ title: "Vogue参考", domain: "www.vogue.com", imageUrl: "https://cdn.example.com/a.jpg" }]);
    expect(result.items[0]).not.toHaveProperty("meta_url");
  });

  it.each(["not-json", JSON.stringify({ web: { results: [{ title: "缺少地址" }] } })])("损坏响应明确报告暂不可读，不伪造空结果", async body => {
    process.env.BRAVE_SEARCH_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    await expect(createHarness().service.search("user", "project", "风衣")).rejects.toMatchObject({ response: { code: "RESEARCH_SEARCH_INVALID_RESPONSE" } });
  });

  it("明确报告未配置搜索服务，不伪造外部结果", async () => {
    delete process.env.BRAVE_SEARCH_API_KEY;
    const { service } = createHarness();

    await expect(service.search("user-a", "project-a", "秋冬风衣")).rejects.toMatchObject({
      response: expect.objectContaining({ code: "RESEARCH_SEARCH_NOT_CONFIGURED" }),
    });
  });

  it("只返回白名单 HTTPS 来源，并去重外部检索结果", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "test-key";
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      web: {
        results: [
          { title: "Vogue report", url: "https://www.vogue.com/article/a", description: "摘要", page_age: "2026-11-01", thumbnail: { src: "https://cdn.example.com/a.jpg" } },
          { title: "Duplicate", url: "https://www.vogue.com/article/a", description: "重复" },
          { title: "Untrusted", url: "https://example.com/article", description: "不应返回" },
          { title: "HTTP", url: "http://www.wwd.com/article", description: "不应返回" },
          { title: "WWD report", url: "https://wwd.com/fashion/article-b", description: "第二条" },
        ],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    const { access, service } = createHarness();

    const result = await service.search("user-a", "project-a", "秋冬风衣", 8);

    expect(access.require).toHaveBeenCalledWith("user-a", "project-a", "read");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      domain: "www.vogue.com",
      kind: "EXTERNAL",
      publishedAt: "2026-11-01T00:00:00.000Z",
      title: "Vogue report",
      url: "https://www.vogue.com/article/a",
    });
    expect(fetcher.mock.calls[0]?.[0].searchParams.get("q")).toContain("site:vogue.com");
  });

  it("没有 AI 配置时返回标注为来源提取的安全分析，并保留来源证据映射", async () => {
    delete process.env.AMUX_API_KEY;
    const { service } = createHarness();
    const result = await service.analyze("user-a", "project-a", {
      directions: "宽松廓形",
      goal: "秋冬通勤风衣",
      sources: [{
        domain: "vogue.com",
        freshness: "RECENT",
        id: "source-a",
        imageUrl: null,
        kind: "EXTERNAL",
        publishedAt: "2026-11-01T00:00:00.000Z",
        snippet: "摘要中提到宽松廓形。",
        title: "来源标题",
        url: "https://www.vogue.com/article/a",
      }],
    });

    expect(result).toMatchObject({ mode: "EXTRACTED", evidence: [{ sourceId: "source-a" }] });
  });

  it("归一化 AI 证据，只保留本次提交的来源并为缺失映射回退摘要", async () => {
    process.env.AMUX_API_KEY = "test-key";
    const model = {
      generateJson: vi.fn().mockResolvedValue({
        colors: [],
        evidence: [{ sourceId: "source-a", claims: ["AI 可核对陈述"] }, { sourceId: "not-selected", claims: ["不应展示"] }],
        fabrics: [],
        hypotheses: [],
        keywords: [],
        silhouettes: [],
        summary: "AI 摘要",
        unknowns: [],
      }),
    };
    const { service } = createHarness(model);
    const result = await service.analyze("user-a", "project-a", {
      directions: "",
      goal: "秋冬通勤风衣",
      sources: [
        {
          domain: "vogue.com",
          freshness: "RECENT",
          id: "source-a",
          imageUrl: null,
          kind: "EXTERNAL",
          publishedAt: "2026-11-01T00:00:00.000Z",
          snippet: "第一来源摘要",
          title: "第一来源",
          url: "https://www.vogue.com/article/a",
        },
        {
          domain: "wwd.com",
          freshness: "RECENT",
          id: "source-b",
          imageUrl: null,
          kind: "EXTERNAL",
          publishedAt: "2026-11-02T00:00:00.000Z",
          snippet: "第二来源摘要",
          title: "第二来源",
          url: "https://wwd.com/fashion/article-b",
        },
      ],
    });

    expect(result).toMatchObject({
      mode: "AI",
      evidence: [
        { sourceId: "source-a", claims: ["AI 可核对陈述"] },
        { sourceId: "source-b", claims: ["第二来源摘要"] },
      ],
    });
    expect(result.evidence.some((item) => item.sourceId === "not-selected")).toBe(false);
  });
});
