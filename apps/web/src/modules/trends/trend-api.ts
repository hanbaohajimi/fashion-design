"use client";

import useSWR from "swr";

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
  return (await response.json()) as T;
}

export function useTrends() {
  const query = useSWR<TrendListPage>(
    "/api/trends?limit=60&page=1",
    requestJson,
    { keepPreviousData: true, revalidateOnFocus: false },
  );
  return {
    error: query.error instanceof Error ? query.error : null,
    isLoading: query.isLoading,
    items: query.data?.items ?? [],
    refresh: () => void query.mutate(),
    total: query.data?.total ?? 0,
  };
}

export function useCurrentTrendDigest() {
  const query = useSWR<TrendDigest>(
    "/api/trends/digest/current",
    requestJson,
    { revalidateOnFocus: false },
  );
  return {
    data: query.data ?? null,
    error: query.error instanceof Error ? query.error : null,
    isLoading: query.isLoading,
  };
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
