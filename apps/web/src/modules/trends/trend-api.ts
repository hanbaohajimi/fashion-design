"use client";

import { privateFetch as fetch } from "../auth/private-fetch";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { useAuth } from "../auth/AuthProvider";

import { readErrorMessage } from "../auth/auth-api";
import type {
  ImportTrendResponse,
  TrendDigest,
  TrendListPage,
} from "./trend-types";

export class TrendApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "TrendApiError";
  }
}

async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const message = await readErrorMessage(response.clone(), "趋势数据读取失败");
    let code: string | undefined;
    try {
      const payload = (await response.json()) as { code?: unknown };
      code = typeof payload.code === "string" ? payload.code : undefined;
    } catch {
      // Error message has already been recovered from a cloned response.
    }
    throw new TrendApiError(message, response.status, code);
  }

  const body = await response.text();
  if (!body.trim()) {
    return null as T;
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new TrendApiError("趋势数据响应格式错误", response.status);
  }
}

export function useTrends() {
  const { session, loading, error: authError, refresh: refreshAuth } = useAuth();
  const query = useSWRInfinite<TrendListPage>(
    (pageIndex, previousPage) => {
      // Never start an anonymous request against a cache that is about to be replaced.
      if (!session) return null;
      if (previousPage && !previousPage.hasMore) return null;
      return `/api/trends?limit=60&page=${pageIndex + 1}`;
    },
    requestJson,
    { keepPreviousData: true, revalidateOnFocus: false },
  );
  const items = query.data?.flatMap((page) => page.items) ?? [];
  const lastPage = query.data?.at(-1);
  useEffect(() => { if (query.error) Sentry.captureException(query.error, { tags: { area: "trends" } }); }, [query.error]);
  return {
    error: query.error instanceof Error ? query.error : !session && authError ? new Error(authError) : null,
    hasMore: Boolean(lastPage?.hasMore),
    isLoading: loading || (!session && !authError) || query.isLoading,
    isLoadingMore: query.isValidating && Boolean(query.data?.length),
    items,
    loadMore: () => {
      if (lastPage?.hasMore && !query.isValidating) {
        void query.setSize(query.size + 1);
      }
    },
    refresh: () => { if (!session) void refreshAuth(); else void query.mutate(); },
    total: query.data?.[0]?.total ?? 0,
  };
}

export function useCurrentTrendDigest() {
  const { session, loading, error: authError, refresh: refreshAuth } = useAuth();
  const query = useSWR<TrendDigest | null>(
    session ? "/api/trends/digest/current" : null,
    fetchCurrentTrendDigest,
    { revalidateOnFocus: false },
  );
  useEffect(() => { if (query.error) Sentry.captureException(query.error, { tags: { area: "trend-digest" } }); }, [query.error]);
  return {
    data: query.data ?? null,
    error: query.error instanceof Error ? query.error : !session && authError ? new Error(authError) : null,
    isLoading: loading || (!session && !authError) || query.isLoading,
    refresh: () => { if (!session) void refreshAuth(); else void query.mutate(); },
  };
}

export function fetchCurrentTrendDigest(): Promise<TrendDigest | null> {
  return requestJson<TrendDigest | null>("/api/trends/digest/current");
}

export function importTrendToBoard(
  boardId: string,
  trendItemId: string,
): Promise<ImportTrendResponse> {
  return requestJson<ImportTrendResponse>(
    `/api/boards/${encodeURIComponent(boardId)}/import-trend`,
    {
      body: JSON.stringify({ trendItemId }),
      method: "POST",
    },
  );
}
