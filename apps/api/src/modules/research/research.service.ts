import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ServiceUnavailableException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import {
  researchSearchResponseSchema,
  researchFreshnessSchema,
  researchAnalysisInputSchema,
  researchAnalysisSchema,
  type ResearchSearchResponse,
  type ResearchSource,
  type ResearchAnalysis,
  type ResearchAnalysisInput,
} from "@fashion/shared";
import type { AmuxClaudeJsonClient } from "@fashion/ai";

import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { AMUX_CLAUDE_CLIENT } from "../ai/ai.tokens";

const SEARCH_TIMEOUT_MS = 15_000;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 12;
const ALLOWED_DOMAINS = [
  "businessoffashion.com",
  "fashionunited.com",
  "highsnobiety.com",
  "hypebeast.com",
  "pinterest.com",
  "ssense.com",
  "vogue.com",
  "wwd.com",
] as const;

const braveResponseSchema = z
  .object({
    web: z
      .object({
        results: z.array(
          z
            .object({
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

function allowedUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const hostname = url.hostname.toLowerCase();
    if (!ALLOWED_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) return null;
    return url;
  } catch {
    return null;
  }
}

function publishedAt(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function freshness(value: string | null): "RECENT" | "DATED" | "UNKNOWN" {
  if (!value) return "UNKNOWN";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "UNKNOWN";
  return Date.now() - timestamp <= 180 * 24 * 60 * 60 * 1_000 ? "RECENT" : "DATED";
}

function sourceId(url: string): string {
  return `external:${createHash("sha256").update(url).digest("hex").slice(0, 32)}`;
}

@Injectable()
export class ResearchService {
  constructor(
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy,
    @Inject(AMUX_CLAUDE_CLIENT) @Optional() private readonly model?: AmuxClaudeJsonClient,
  ) {}

  async search(
    userId: string,
    projectId: string,
    query: string,
    requestedLimit?: number,
  ): Promise<ResearchSearchResponse> {
    await this.access.require(userId, projectId, "read");
    const normalized = query.trim().slice(0, 240);
    const limit = Math.min(Math.max(requestedLimit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException({
        code: "RESEARCH_SEARCH_NOT_CONFIGURED",
        message: "外部研究搜索尚未配置；当前仍可使用已采集的趋势档案。",
      });
    }
    const endpoint = process.env.BRAVE_SEARCH_API_URL?.trim() || "https://api.search.brave.com/res/v1/web/search";
    const url = new URL(endpoint);
    url.searchParams.set("q", `${normalized} (${ALLOWED_DOMAINS.map((domain) => `site:${domain}`).join(" OR ")})`);
    url.searchParams.set("count", String(limit));
    url.searchParams.set("freshness", "py");
    url.searchParams.set("result_filter", "web");
    const response = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new ServiceUnavailableException({
        code: "RESEARCH_SEARCH_FAILED",
        message: `外部研究搜索暂时失败（HTTP ${response.status}），仍可使用已采集趋势档案。`,
      });
    }
    const parsed = braveResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new ServiceUnavailableException({
        code: "RESEARCH_SEARCH_INVALID_RESPONSE",
        message: "外部研究搜索返回的资料暂时无法读取，请稍后重试。",
      });
    }
    const items: ResearchSource[] = [];
    const seen = new Set<string>();
    for (const result of parsed.data.web?.results ?? []) {
      const source = allowedUrl(result.url);
      if (!source || seen.has(source.href)) continue;
      seen.add(source.href);
      items.push({
        domain: source.hostname,
        freshness: researchFreshnessSchema.parse(freshness(publishedAt(result.page_age))),
        id: sourceId(source.href),
        imageUrl: result.thumbnail?.src && allowedImageUrl(result.thumbnail.src) ? result.thumbnail.src : null,
        kind: "EXTERNAL",
        publishedAt: publishedAt(result.page_age),
        snippet: (result.description ?? "").trim().slice(0, 2_000),
        title: result.title.trim().slice(0, 300),
        url: source.href,
      });
      if (items.length >= limit) break;
    }
    return researchSearchResponseSchema.parse({ query: normalized, items });
  }

  async analyze(
    userId: string,
    projectId: string,
    raw: ResearchAnalysisInput,
  ): Promise<ResearchAnalysis> {
    await this.access.require(userId, projectId, "read");
    const input = researchAnalysisInputSchema.parse(raw);
    if (!this.model || !process.env.AMUX_API_KEY?.trim()) return extractedAnalysis(input);
    try {
      const result = await this.model.generateJson({
        instructions: "你是服装研究编辑。只根据给出的来源标题、摘要、日期和链接做归纳；不要把摘要中的营销表述写成事实，不要补写销量、热度、材质物性或未来趋势。无法确认的内容必须放入unknowns。输出简洁中文。",
        jsonSchema: {
          additionalProperties: false,
          properties: {
            colors: { items: { pattern: "^#[0-9A-Fa-f]{6}$", type: "string" }, maxItems: 16, type: "array" },
            evidence: {
              items: {
                additionalProperties: false,
                properties: {
                  claims: { items: { maxLength: 2_000, minLength: 1, type: "string" }, maxItems: 6, minItems: 1, type: "array" },
                  sourceId: { maxLength: 128, minLength: 1, type: "string" },
                },
                required: ["sourceId", "claims"],
                type: "object",
              },
              maxItems: 6,
              type: "array",
            },
            fabrics: { items: { maxLength: 80, minLength: 1, type: "string" }, maxItems: 16, type: "array" },
            hypotheses: { items: { maxLength: 2_000, minLength: 1, type: "string" }, maxItems: 8, type: "array" },
            keywords: { items: { maxLength: 80, minLength: 1, type: "string" }, maxItems: 20, type: "array" },
            silhouettes: { items: { maxLength: 80, minLength: 1, type: "string" }, maxItems: 16, type: "array" },
            summary: { maxLength: 2_000, type: "string" },
            unknowns: { items: { maxLength: 2_000, minLength: 1, type: "string" }, maxItems: 12, type: "array" },
          },
          required: ["summary", "keywords", "silhouettes", "fabrics", "colors", "hypotheses", "unknowns", "evidence"],
          type: "object",
        },
        maxTokens: 1_000,
        parse: (value) => researchAnalysisSchema.parse({ ...(value as Record<string, unknown>), mode: "AI" }),
        prompt: JSON.stringify({ goal: input.goal, directions: input.directions, sources: input.sources.map(({ id, title, url, domain, snippet, publishedAt }) => ({ id, title, url, domain, snippet, publishedAt })) }),
        schemaName: "research_source_analysis",
      });
      return normalizeAnalysisEvidence(
        researchAnalysisSchema.parse({ ...result, mode: "AI" }),
        input.sources,
      );
    } catch {
      return extractedAnalysis(input);
    }
  }
}

function allowedImageUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function extractedAnalysis(input: ResearchAnalysisInput): ResearchAnalysis {
  const tokens = [...new Set(`${input.goal} ${input.directions}`.split(/[\s,，、;；/]+/u).map((value) => value.trim()).filter((value) => value.length >= 2))].slice(0, 20);
  return {
    colors: [],
    fabrics: [],
    hypotheses: input.directions.trim() ? input.directions.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean).slice(0, 8) : [],
    keywords: tokens,
    mode: "EXTRACTED",
    silhouettes: [],
    summary: "当前使用来源标题、摘要与设计方向的结构化提取；未调用 AI 归纳，结论必须结合原文与实物资料继续核对。",
    unknowns: ["来源摘要可能不完整", "真实材质、性能、销量与未来热度未由当前证据确认"],
    evidence: input.sources.map((source) => ({
      claims: [source.snippet || "请打开原文核对该来源，不依据空摘要做结论。"],
      sourceId: source.id,
    })),
  };
}

function normalizeAnalysisEvidence(
  analysis: ResearchAnalysis,
  sources: readonly ResearchSource[],
): ResearchAnalysis {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const claimsBySourceId = new Map<string, string[]>();
  for (const item of analysis.evidence) {
    if (sourceById.has(item.sourceId) && !claimsBySourceId.has(item.sourceId)) {
      claimsBySourceId.set(item.sourceId, item.claims);
    }
  }
  return {
    ...analysis,
    evidence: sources.map((source) => ({
      claims: claimsBySourceId.get(source.id) ?? [
        source.snippet || "请打开原文核对该来源，不依据空摘要做结论。",
      ],
      sourceId: source.id,
    })),
  };
}
