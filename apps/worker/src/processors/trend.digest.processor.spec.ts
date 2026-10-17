import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import {
  AmuxTrendLlmService,
  AnthropicTrendLlmService,
  BraveTrendSearchService,
  S3TrendCoverService,
  TREND_SEARCH_QUERIES,
  TrendDigestProcessor,
  type TrendSearchResult,
} from "./trend.digest.processor";

function result(overrides: Partial<TrendSearchResult> = {}): TrendSearchResult {
  return {
    imageUrl: "https://images.example.com/trend.webp",
    publishedAt: new Date("2026-07-31T08:00:00.000Z"),
    snippet: "Runways are returning to fluid layers and translucent fabrics.",
    title: "Fluid layers",
    url: "https://www.vogue.com/article/fluid-layers",
    ...overrides,
  };
}

function summary(keyword = "轻盈叠穿") {
  return {
    fabricMentions: ["雪纺"],
    keyColors: ["#E6E0D4"],
    keywords: [keyword],
    silhouettes: ["流线型"],
    summary: "轻盈半透明材质成为本周重点，流线型叠穿强化空气感。",
  };
}

describe("TrendDigestProcessor", () => {
  const database = {
    trendDigest: { upsert: vi.fn() },
    trendItem: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  };
  const search = { search: vi.fn() };
  const llm = {
    summarizeArticle: vi.fn(),
    summarizeDigest: vi.fn(),
  };
  const covers = { store: vi.fn() };
  const job = { log: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    search.search.mockResolvedValue([]);
    llm.summarizeArticle.mockResolvedValue(summary());
    llm.summarizeDigest.mockResolvedValue({
      overview: "本周趋势以轻盈材质和流线廓形为核心。",
      theme: "轻盈流动",
    });
    covers.store.mockResolvedValue({ id: "cover-a" });
    database.trendItem.upsert.mockResolvedValue({ id: "trend-a" });
    database.trendItem.findMany.mockResolvedValue([
      {
        id: "trend-a",
        summary: summary().summary,
        title: "Fluid layers",
      },
    ]);
    database.trendDigest.upsert.mockResolvedValue({ id: "digest-a" });
  });

  it("聚合三个查询、过滤非白名单来源并按 sourceUrl 幂等入库", async () => {
    search.search
      .mockResolvedValueOnce([
        result(),
        result({
          title: "Blocked",
          url: "https://example.com/trends/blocked",
        }),
      ])
      .mockResolvedValueOnce([
        result(),
        result({
          title: "Tailoring",
          url: "https://wwd.com/fashion-news/trends/tailoring",
        }),
      ])
      .mockResolvedValueOnce([]);
    database.trendItem.upsert
      .mockResolvedValueOnce({ id: "trend-a" })
      .mockResolvedValueOnce({ id: "trend-b" });
    database.trendItem.findMany.mockResolvedValue([
      { id: "trend-a", summary: "摘要 A", title: "Fluid layers" },
      { id: "trend-b", summary: "摘要 B", title: "Tailoring" },
    ]);
    const processor = new TrendDigestProcessor({
      covers,
      database: database as never,
      llm,
      now: () => new Date("2026-08-02T08:00:00.000Z"),
      search,
      timeZone: "Asia/Shanghai",
    });

    const output = await processor.process(job as never);

    expect(search.search.mock.calls.map(([query]) => query)).toEqual(
      TREND_SEARCH_QUERIES,
    );
    expect(llm.summarizeArticle).toHaveBeenCalledTimes(2);
    expect(database.trendItem.upsert).toHaveBeenCalledTimes(2);
    expect(database.trendItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceUrl: "https://www.vogue.com/article/fluid-layers" },
        create: expect.objectContaining({
          category: "women",
          coverFileId: "cover-a",
          platform: "vogue",
          tags: ["轻盈叠穿"],
        }),
      }),
    );
    expect(database.trendDigest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { period: "2026-W31" },
        create: expect.objectContaining({
          itemIds: ["trend-a", "trend-b"],
          period: "2026-W31",
          theme: "轻盈流动",
        }),
      }),
    );
    expect(output).toEqual({
      digestPeriod: "2026-W31",
      failed: 0,
      found: 2,
      processed: 2,
    });
  });

  it("隔离单条摘要失败并通过 job.log 记录，后续文章仍入库", async () => {
    search.search.mockResolvedValueOnce([
      result({ title: "Bad article" }),
      result({
        title: "Good article",
        url: "https://fashionunited.com/news/fashion/good-article",
      }),
    ]);
    llm.summarizeArticle
      .mockRejectedValueOnce(new Error("Claude timeout"))
      .mockResolvedValueOnce(summary("廓形更新"));
    const processor = new TrendDigestProcessor({
      covers,
      database: database as never,
      llm,
      now: () => new Date("2026-08-02T08:00:00.000Z"),
      search,
    });

    const output = await processor.process(job as never);

    expect(output.failed).toBe(1);
    expect(output.processed).toBe(1);
    expect(database.trendItem.upsert).toHaveBeenCalledOnce();
    expect(job.log).toHaveBeenCalledWith(
      expect.stringContaining("Bad article: Claude timeout"),
    );
  });

  it("封面下载失败时记录日志但仍保存趋势文本", async () => {
    search.search.mockResolvedValueOnce([result()]);
    covers.store.mockRejectedValueOnce(new Error("image too large"));
    const processor = new TrendDigestProcessor({
      covers,
      database: database as never,
      llm,
      now: () => new Date("2026-08-02T08:00:00.000Z"),
      search,
    });

    await processor.process(job as never);

    expect(database.trendItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ coverFileId: null }),
      }),
    );
    expect(job.log).toHaveBeenCalledWith(
      expect.stringContaining("封面处理失败"),
    );
  });

  it("没有文章时返回零计数且不调用 Claude 或创建周综述", async () => {
    const processor = new TrendDigestProcessor({
      covers,
      database: database as never,
      llm,
      now: () => new Date("2026-08-02T08:00:00.000Z"),
      search,
    });

    const output = await processor.process(job as never);

    expect(output).toEqual({
      digestPeriod: null,
      failed: 0,
      found: 0,
      processed: 0,
    });
    expect(llm.summarizeArticle).not.toHaveBeenCalled();
    expect(database.trendDigest.upsert).not.toHaveBeenCalled();
  });
});

describe("trend providers", () => {
  it("Brave Search 使用最近一周过滤与来源限定", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                description: "A runway report",
                page_age: "2026-08-01T10:00:00.000Z",
                thumbnail: { src: "https://images.example.com/cover.jpg" },
                title: "Runway report",
                url: "https://www.vogue.com/article/runway-report",
              },
            ],
          },
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    const service = new BraveTrendSearchService({
      apiKey: "brave-test-key",
      fetchImpl,
    });

    const results = await service.search("runway trends");

    const requestedUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(requestedUrl.searchParams.get("freshness")).toBe("pw");
    expect(requestedUrl.searchParams.get("q")).toContain("site:vogue.com");
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Subscription-Token": "brave-test-key",
        }),
      }),
    );
    expect(results).toEqual([
      expect.objectContaining({
        publishedAt: new Date("2026-08-01T10:00:00.000Z"),
        title: "Runway report",
      }),
    ]);
  });

  it("Claude Messages API 使用 output_config.format JSON Schema", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            {
              text: JSON.stringify(summary()),
              type: "text",
            },
          ],
          stop_reason: "end_turn",
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    const service = new AnthropicTrendLlmService({
      apiKey: "anthropic-test-key",
      fetchImpl,
      model: "claude-sonnet-4-6",
    });

    await service.summarizeArticle(result());

    const request = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "claude-sonnet-4-6",
      output_config: {
        format: {
          schema: expect.objectContaining({ type: "object" }),
          type: "json_schema",
        },
      },
    });
  });

  it("趋势摘要复用已配置的 Amux Claude 结构化客户端", async () => {
    const client = {
      generateJson: vi.fn().mockImplementation(({ parse }) => parse(summary())),
    };
    const service = new AmuxTrendLlmService(client);

    const output = await service.summarizeArticle(result());

    expect(output).toEqual(summary());
    expect(client.generateJson).toHaveBeenCalledWith(
      expect.objectContaining({
        jsonSchema: expect.objectContaining({ type: "object" }),
        schemaName: "trend_article_summary",
      }),
    );
  });

  it("趋势封面转为 WebP 后写入 trends 目录并创建 READY 文件资产", async () => {
    const input = await sharp({
      create: {
        background: "#d4c9bc",
        channels: 3,
        height: 320,
        width: 480,
      },
    })
      .png()
      .toBuffer();
    const storage = { put: vi.fn() };
    const database = {
      fileAsset: {
        upsert: vi.fn().mockResolvedValue({ id: "cover-a" }),
      },
    };
    const visualSummaryJobs = { enqueue: vi.fn().mockRejectedValue(new Error("analysis queue unavailable")) };
    const service = new S3TrendCoverService({
      database: database as never,
      download: vi.fn().mockResolvedValue(input),
      now: () => new Date("2026-08-02T08:00:00.000Z"),
      ownerId: "system-user",
      storage: storage as never,
      visualSummaryJobs,
    });

    await service.store(
      "https://images.example.com/cover.png",
      "https://www.vogue.com/article/runway-report",
      "2026-W31",
    );

    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(
        /^trends\/2026-W31\/system-user\/[0-9a-f]{64}\.webp$/u,
      ),
      expect.any(Buffer),
      "image/webp",
    );
    expect(visualSummaryJobs.enqueue).toHaveBeenCalledWith({ kind: "file", id: "cover-a" });
    expect(database.fileAsset.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          mimeType: "image/webp",
          ownerId: "system-user",
          status: "READY",
        }),
      }),
    );
  });
});
