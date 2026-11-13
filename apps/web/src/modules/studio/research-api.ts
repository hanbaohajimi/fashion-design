import type {
  ResearchAnalysis,
  ResearchAnalysisInput,
  ResearchSearchResponse,
} from "@fashion/shared";

import { privateFetch } from "../auth/private-fetch";

export class ResearchApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "ResearchApiError";
  }
}

export async function searchResearchSources(
  projectId: string,
  query: string,
  signal?: AbortSignal,
): Promise<ResearchSearchResponse> {
  const params = new URLSearchParams({ q: query.trim(), limit: "12" });
  const response = await privateFetch(
    `/api/projects/${encodeURIComponent(projectId)}/research/search?${params.toString()}`,
    {
      cache: "no-store",
      credentials: "include",
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) {
    let message = "外部研究搜索暂时不可用";
    let code: string | undefined;
    try {
      const body = (await response.json()) as { code?: unknown; message?: unknown };
      if (typeof body.message === "string") message = body.message;
      if (typeof body.code === "string") code = body.code;
    } catch {
      // Keep the stable fallback when the response is not JSON.
    }
    throw new ResearchApiError(message, code);
  }
  return (await response.json()) as ResearchSearchResponse;
}

export async function analyzeResearchSources(
  projectId: string,
  input: ResearchAnalysisInput,
): Promise<ResearchAnalysis> {
  const response = await privateFetch(
    `/api/projects/${encodeURIComponent(projectId)}/research/analyze`,
    {
      body: JSON.stringify(input),
      cache: "no-store",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    let message = "研究分析暂时不可用";
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === "string") message = body.message;
    } catch {
      // Keep a stable fallback when the response is not JSON.
    }
    throw new ResearchApiError(message);
  }
  return (await response.json()) as ResearchAnalysis;
}
