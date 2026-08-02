import useSWRInfinite from "swr/infinite";

import type { FabricListPage, FabricListQuery } from "./fabric-types";

const PAGE_SIZE = 48;

async function fetchFabricPage(url: string): Promise<FabricListPage> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    let message = "面料列表加载失败";
    try {
      const payload = (await response.json()) as { message?: string | string[] };
      if (Array.isArray(payload.message)) message = payload.message.join("；");
      else if (payload.message) message = payload.message;
    } catch {
      // Keep the user-facing fallback when the response is not JSON.
    }
    throw new Error(message);
  }
  return (await response.json()) as FabricListPage;
}

export function useFabrics(query: FabricListQuery) {
  const result = useSWRInfinite<FabricListPage>(
    (pageIndex, previousPage) => {
      if (previousPage && pageIndex >= previousPage.totalPages) return null;
      const params = new URLSearchParams({
        limit: String(query.limit ?? PAGE_SIZE),
        page: String(pageIndex + 1),
        scope: query.scope ?? "all",
      });
      if (query.category && query.category !== "all") {
        params.set("category", query.category);
      }
      if (query.search?.trim()) params.set("search", query.search.trim());
      return `/api/fabrics?${params.toString()}`;
    },
    fetchFabricPage,
    {
      keepPreviousData: true,
      revalidateFirstPage: false,
    },
  );

  const items = result.data?.flatMap((page) => page.items) ?? [];
  const lastPage = result.data?.at(-1);
  const hasMore = Boolean(lastPage && lastPage.page < lastPage.totalPages);

  return {
    error: result.error instanceof Error ? result.error : null,
    hasMore,
    isLoading: result.isLoading,
    isLoadingMore: result.isValidating && Boolean(result.data?.length),
    items,
    loadMore: () => {
      if (hasMore && !result.isValidating) void result.setSize(result.size + 1);
    },
    refresh: () => void result.mutate(),
    total: result.data?.[0]?.total ?? 0,
  };
}
