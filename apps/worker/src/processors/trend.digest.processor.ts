import type { Prisma, PrismaClient } from "@fashion/db";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { basename } from "node:path";
import type { Job } from "bullmq";
import sharp from "sharp";
import { z } from "zod";

import type { TrendDigestJobData } from "../queues/trend.queue";
import type { ThumbnailStorage } from "../storage";

const SEARCH_TIMEOUT_MS = 15_000;
const CLAUDE_TIMEOUT_MS = 30_000;
const IMAGE_TIMEOUT_MS = 15_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_REDIRECTS = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;

export const TREND_SEARCH_QUERIES = [
  "fashion trends 2026",
  "runway trends",
  "color trends fashion",
] as const;

const TREND_SOURCE_FILTER = [
  "site:vogue.com",
  "site:wwd.com",
  "site:pinterest.com/trends",
  "site:fashionunited.com",
].join(" OR ");

const ArticleSummarySchema = z.object({
  fabricMentions: z.array(z.string().trim().min(1)).max(20),
  keyColors: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/u)).max(20),
  keywords: z.array(z.string().trim().min(1)).max(20),
  silhouettes: z.array(z.string().trim().min(1)).max(20),
  summary: z.string().trim().min(1).max(2_000),
});

const DigestSummarySchema = z.object({
  overview: z.string().trim().min(1).max(4_000),
  theme: z.string().trim().min(1).max(200),
});

const BraveResponseSchema = z.object({
  web: z
    .object({
      results: z.array(
        z.object({
          description: z.string().optional(),
          page_age: z.string().optional(),
          thumbnail: z.object({ src: z.string() }).optional(),
          title: z.string(),
          url: z.string(),
        }),
      ),
    })
    .optional(),
});

const ClaudeResponseSchema = z.object({
  content: z.array(
    z.object({
      text: z.string().optional(),
      type: z.string(),
    }),
  ),
  stop_reason: z.string().nullable().optional(),
});

export type TrendArticleSummary = z.infer<typeof ArticleSummarySchema>;
export type TrendDigestSummary = z.infer<typeof DigestSummarySchema>;

export interface TrendSearchResult {
  readonly imageUrl?: string;
  readonly publishedAt?: Date;
  readonly snippet: string;
  readonly title: string;
  readonly url: string;
}

export interface TrendSearchService {
  search(query: string): Promise<readonly TrendSearchResult[]>;
}

export interface TrendLlmService {
  summarizeArticle(article: TrendSearchResult): Promise<TrendArticleSummary>;
  summarizeDigest(
    items: readonly { summary: string; title: string }[],
  ): Promise<TrendDigestSummary>;
}

export interface TrendCoverService {
  store(
    imageUrl: string,
    sourceUrl: string,
    period: string,
  ): Promise<{ id: string } | null>;
}

type TrendDatabase = Pick<
  PrismaClient,
  "fileAsset" | "trendDigest" | "trendItem"
>;

interface ProcessorDependencies {
  readonly covers: TrendCoverService;
  readonly database: Pick<TrendDatabase, "trendDigest" | "trendItem">;
  readonly llm: TrendLlmService;
  readonly now?: () => Date;
  readonly search: TrendSearchService;
  readonly timeZone?: string;
}

export interface TrendDigestProcessResult {
  readonly digestPeriod: string | null;
  readonly failed: number;
  readonly found: number;
  readonly processed: number;
}

export class TrendDigestProcessor {
  private readonly now: () => Date;
  private readonly timeZone: string;

  constructor(private readonly dependencies: ProcessorDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.timeZone = dependencies.timeZone ?? "Asia/Shanghai";
  }

  async process(
    job: Pick<Job<TrendDigestJobData>, "log">,
  ): Promise<TrendDigestProcessResult> {
    const allResults: TrendSearchResult[] = [];
    for (const query of TREND_SEARCH_QUERIES) {
      const results = await this.dependencies.search.search(query);
      allResults.push(...results);
    }

    const articles = deduplicateResults(allResults).filter((article) =>
      isAllowedTrendSource(article.url),
    );
    await job.log(`找到 ${articles.length} 篇白名单趋势文章。`);
    if (articles.length === 0) {
      return {
        digestPeriod: null,
        failed: 0,
        found: 0,
        processed: 0,
      };
    }

    const now = this.now();
    const period = isoWeekPeriod(now, this.timeZone);
    let failed = 0;
    let processed = 0;

    for (const article of articles) {
      try {
        const extracted = await this.dependencies.llm.summarizeArticle(article);
        const coverFileId = await this.storeCover(job, article, period);
        const data = {
          category: "women",
          coverFileId,
          curatedAt: now,
          extracted: {
            fabricMentions: extracted.fabricMentions,
            keyColors: extracted.keyColors.map((color) => color.toUpperCase()),
            keywords: extracted.keywords,
            silhouettes: extracted.silhouettes,
          } satisfies Prisma.InputJsonObject,
          platform: trendPlatform(article.url),
          publishedAt: article.publishedAt ?? now,
          sourceUrl: canonicalTrendUrl(article.url),
          status: "published",
          summary: extracted.summary,
          tags: extracted.keywords.slice(0, 5),
          title: article.title,
        };
        await this.dependencies.database.trendItem.upsert({
          where: { sourceUrl: data.sourceUrl },
          create: data,
          update: data,
        });
        processed += 1;
        await job.log(`已处理：${article.title}`);
      } catch (error) {
        failed += 1;
        await job.log(`处理失败 ${article.title}: ${errorMessage(error)}`);
      }
    }

    if (processed === 0 && failed > 0) {
      throw new Error(`全部 ${failed} 篇趋势文章处理失败`);
    }

    const digestPeriod =
      processed > 0 ? await this.createWeeklyDigest(period, now) : null;
    return {
      digestPeriod,
      failed,
      found: articles.length,
      processed,
    };
  }

  private async storeCover(
    job: Pick<Job<TrendDigestJobData>, "log">,
    article: TrendSearchResult,
    period: string,
  ): Promise<string | null> {
    if (!article.imageUrl) {
      return null;
    }
    try {
      const cover = await this.dependencies.covers.store(
        article.imageUrl,
        article.url,
        period,
      );
      return cover?.id ?? null;
    } catch (error) {
      await job.log(
        `封面处理失败 ${article.title}: ${errorMessage(error)}；继续保存文本。`,
      );
      return null;
    }
  }

  private async createWeeklyDigest(period: string, now: Date): Promise<string> {
    const items = await this.dependencies.database.trendItem.findMany({
      where: {
        curatedAt: { gte: new Date(now.getTime() - WEEK_MS) },
        status: "published",
      },
      orderBy: { publishedAt: "desc" },
      select: { id: true, summary: true, title: true },
      take: 50,
    });
    if (items.length === 0) {
      return period;
    }
    const digest = await this.dependencies.llm.summarizeDigest(items);
    const data = {
      itemIds: items.map(({ id }) => id),
      overview: digest.overview,
      period,
      theme: digest.theme,
    };
    await this.dependencies.database.trendDigest.upsert({
      where: { period },
      create: data,
      update: data,
    });
    return period;
  }
}

export class BraveTrendSearchService implements TrendSearchService {
  constructor(
    private readonly config: {
      readonly apiKey?: string;
      readonly endpoint?: string;
      readonly fetchImpl?: typeof fetch;
    } = {},
  ) {}

  async search(query: string): Promise<readonly TrendSearchResult[]> {
    const apiKey =
      this.config.apiKey?.trim() || process.env.BRAVE_SEARCH_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("BRAVE_SEARCH_API_KEY 未配置");
    }
    const endpoint =
      this.config.endpoint?.trim() ||
      process.env.BRAVE_SEARCH_API_URL?.trim() ||
      "https://api.search.brave.com/res/v1/web/search";
    const url = new URL(endpoint);
    url.searchParams.set("q", `${query} (${TREND_SOURCE_FILTER})`);
    url.searchParams.set("count", "10");
    url.searchParams.set("freshness", "pw");
    url.searchParams.set("result_filter", "web");
    const response = await (this.config.fetchImpl ?? fetch)(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Brave Search 请求失败（HTTP ${response.status}）`);
    }
    const parsed = BraveResponseSchema.parse(await response.json());
    return (parsed.web?.results ?? []).map((item) => {
      const result: {
        snippet: string;
        title: string;
        url: string;
        publishedAt?: Date;
        imageUrl?: string;
      } = {
        snippet: item.description ?? "",
        title: item.title,
        url: item.url,
      };
      const published = parsePublishedAt(item.page_age);
      if (published) {
        result.publishedAt = published;
      }
      if (item.thumbnail?.src) {
        result.imageUrl = item.thumbnail.src;
      }
      return result;
    });
  }
}

export class AnthropicTrendLlmService implements TrendLlmService {
  constructor(
    private readonly config: {
      readonly apiKey?: string;
      readonly baseUrl?: string;
      readonly fetchImpl?: typeof fetch;
      readonly model?: string;
    } = {},
  ) {}

  summarizeArticle(article: TrendSearchResult): Promise<TrendArticleSummary> {
    return this.requestStructured(
      `总结以下时尚趋势文章的核心要点（2-3句话，中文）：\n\n标题：${article.title}\n摘要：${article.snippet}\n\n提取 keyColors、silhouettes、keywords、fabricMentions。颜色必须为六位 HEX；未提到的项目返回空数组；关键词使用中文。`,
      articleJsonSchema,
      ArticleSummarySchema,
    );
  }

  summarizeDigest(
    items: readonly { summary: string; title: string }[],
  ): Promise<TrendDigestSummary> {
    const articles = items
      .map(
        (item, index) =>
          `${index + 1}. ${item.title}\n${item.summary.slice(0, 800)}`,
      )
      .join("\n\n");
    return this.requestStructured(
      `根据以下本周时尚趋势条目，生成一个简短中文主题和 3-5 句中文周综述。只归纳已有信息，不虚构来源。\n\n${articles}`,
      digestJsonSchema,
      DigestSummarySchema,
    );
  }

  private async requestStructured<T>(
    prompt: string,
    schema: Record<string, unknown>,
    parser: z.ZodType<T>,
  ): Promise<T> {
    const apiKey =
      this.config.apiKey?.trim() || process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY 未配置");
    }
    const baseUrl = (
      this.config.baseUrl?.trim() ||
      process.env.ANTHROPIC_BASE_URL?.trim() ||
      "https://api.anthropic.com"
    ).replace(/\/$/u, "");
    const model =
      this.config.model?.trim() ||
      process.env.ANTHROPIC_MODEL?.trim() ||
      "claude-sonnet-4-6";
    const response = await (this.config.fetchImpl ?? fetch)(
      `${baseUrl}/v1/messages`,
      {
        body: JSON.stringify({
          max_tokens: 1_500,
          messages: [{ content: prompt, role: "user" }],
          model,
          output_config: {
            format: { schema, type: "json_schema" },
          },
        }),
        headers: {
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "x-api-key": apiKey,
        },
        method: "POST",
        signal: AbortSignal.timeout(CLAUDE_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new Error(`Claude 请求失败（HTTP ${response.status}）`);
    }
    const body = ClaudeResponseSchema.parse(await response.json());
    if (body.stop_reason === "max_tokens" || body.stop_reason === "refusal") {
      throw new Error(`Claude 未完成结构化输出：${body.stop_reason}`);
    }
    const text = body.content.find((block) => block.type === "text")?.text;
    if (!text) {
      throw new Error("Claude 响应缺少文本内容");
    }
    return parser.parse(JSON.parse(text));
  }
}

export class S3TrendCoverService implements TrendCoverService {
  constructor(
    private readonly dependencies: {
      readonly database: Pick<TrendDatabase, "fileAsset">;
      readonly download?: (url: string) => Promise<Buffer>;
      readonly now?: () => Date;
      readonly ownerId?: string;
      readonly storage: ThumbnailStorage;
    },
  ) {}

  async store(
    imageUrl: string,
    sourceUrl: string,
    period: string,
  ): Promise<{ id: string }> {
    const ownerId =
      this.dependencies.ownerId?.trim() ||
      process.env.TREND_ASSET_OWNER_ID?.trim();
    if (!ownerId) {
      throw new Error("TREND_ASSET_OWNER_ID 未配置");
    }
    const input = await (this.dependencies.download ?? downloadPublicImage)(
      imageUrl,
    );
    const output = await sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
    })
      .rotate()
      .resize({
        fit: "inside",
        height: 1_600,
        width: 1_600,
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
    const metadata = await sharp(output).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("趋势封面缺少有效尺寸");
    }
    const sha256 = createHash("sha256").update(output).digest("hex");
    const safePeriod = /^\d{4}-W\d{2}$/u.test(period) ? period : "unknown";
    const objectKey = `trends/${safePeriod}/${ownerId}/${sha256}.webp`;
    await this.dependencies.storage.put(objectKey, output, "image/webp");
    const now = this.dependencies.now?.() ?? new Date();
    const sourceName = safeSourceName(sourceUrl, sha256);
    return this.dependencies.database.fileAsset.upsert({
      where: { ownerId_sha256: { ownerId, sha256 } },
      create: {
        completedAt: now,
        height: metadata.height,
        mimeType: "image/webp",
        objectKey,
        originalName: sourceName,
        ownerId,
        sha256,
        sizeBytes: output.byteLength,
        status: "READY",
        thumbnail1024Key: objectKey,
        thumbnail256Key: objectKey,
        width: metadata.width,
      },
      update: {},
      select: { id: true },
    });
  }
}

const articleJsonSchema = {
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    keyColors: { items: { type: "string" }, type: "array" },
    silhouettes: { items: { type: "string" }, type: "array" },
    keywords: { items: { type: "string" }, type: "array" },
    fabricMentions: { items: { type: "string" }, type: "array" },
  },
  required: [
    "summary",
    "keyColors",
    "silhouettes",
    "keywords",
    "fabricMentions",
  ],
  type: "object",
} as const;

const digestJsonSchema = {
  additionalProperties: false,
  properties: {
    theme: { type: "string" },
    overview: { type: "string" },
  },
  required: ["theme", "overview"],
  type: "object",
} as const;

function deduplicateResults(
  results: readonly TrendSearchResult[],
): TrendSearchResult[] {
  const unique = new Map<string, TrendSearchResult>();
  for (const result of results) {
    try {
      const canonical = canonicalTrendUrl(result.url);
      if (!unique.has(canonical)) {
        unique.set(canonical, { ...result, url: canonical });
      }
    } catch {
      // 搜索结果 URL 无效时丢弃该条，避免整批任务失败。
    }
  }
  return [...unique.values()];
}

function canonicalTrendUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("趋势来源必须使用 HTTPS");
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_") || key === "ref" || key === "source") {
      url.searchParams.delete(key);
    }
  }
  return url.toString();
}

function isAllowedTrendSource(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (
    hostname === "vogue.com" ||
    hostname.endsWith(".vogue.com") ||
    hostname === "wwd.com" ||
    hostname.endsWith(".wwd.com") ||
    hostname === "fashionunited.com" ||
    hostname.endsWith(".fashionunited.com")
  ) {
    return true;
  }
  return (
    (hostname === "pinterest.com" || hostname.endsWith(".pinterest.com")) &&
    (url.pathname.includes("/trends") ||
      url.pathname.includes("/business/trends"))
  );
}

function trendPlatform(value: string): string {
  const hostname = new URL(value).hostname.toLowerCase();
  if (hostname === "wwd.com" || hostname.endsWith(".wwd.com")) return "wwd";
  if (hostname.includes("pinterest.com")) return "pinterest";
  if (hostname.includes("fashionunited.com")) return "fashionunited";
  return "vogue";
}

function parsePublishedAt(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isoWeekPeriod(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const localDate = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  const day = localDate.getUTCDay() || 7;
  localDate.setUTCDate(localDate.getUTCDate() + 4 - day);
  const isoYear = localDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(
    ((localDate.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function safeSourceName(sourceUrl: string, sha256: string): string {
  try {
    const name = basename(new URL(sourceUrl).pathname).slice(0, 120);
    return `${name || "trend"}-${sha256.slice(0, 8)}.webp`;
  } catch {
    return `trend-${sha256.slice(0, 8)}.webp`;
  }
}

async function downloadPublicImage(value: string): Promise<Buffer> {
  let url = safePublicUrl(value);
  for (let redirects = 0; ; redirects += 1) {
    await assertPublicHostname(url);
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects >= MAX_IMAGE_REDIRECTS) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("趋势封面重定向次数超过限制");
      }
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new Error("趋势封面重定向缺少 Location");
      url = safePublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) {
      throw new Error(`趋势封面下载失败（HTTP ${response.status}）`);
    }
    const contentType = response.headers.get("content-type")?.split(";")[0];
    if (!contentType?.startsWith("image/")) {
      throw new Error("趋势封面响应不是图片");
    }
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_IMAGE_BYTES) {
      throw new Error("趋势封面超过 8MB 限制");
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength === 0 || body.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("趋势封面大小无效或超过 8MB 限制");
    }
    return body;
  }
}

function safePublicUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("趋势封面仅允许 HTTPS URL");
  }
  const hostname = normalizedHostname(url);
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    isPrivateIp(hostname)
  ) {
    throw new Error("趋势封面不允许访问本机或私网地址");
  }
  return url;
}

async function assertPublicHostname(url: URL): Promise<void> {
  const hostname = normalizedHostname(url);
  if (isIP(hostname) !== 0) return;
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isIP(address) === 0 || isPrivateIp(address))
  ) {
    throw new Error("趋势封面域名解析到不允许的地址");
  }
}

function normalizedHostname(url: URL): string {
  return url.hostname
    .replace(/^\[|\]$/gu, "")
    .replace(/\.$/u, "")
    .toLowerCase();
}

function isPrivateIp(hostname: string): boolean {
  const family = isIP(hostname);
  if (family === 4) {
    const [first = 0, second = 0] = hostname
      .split(".")
      .map((part) => Number(part));
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      first >= 224
    );
  }
  if (family === 6) {
    const normalized = hostname.toLowerCase();
    const firstGroup = Number.parseInt(normalized.split(":")[0] || "0", 16);
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("::ffff:") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      (firstGroup & 0xffc0) === 0xfe80 ||
      (firstGroup & 0xff00) === 0xff00
    );
  }
  return false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
