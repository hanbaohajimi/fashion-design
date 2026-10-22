import { fabricDetailsSchema, type FabricDetails } from "@fashion/shared";
import { privateFetch as fetch } from "../auth/private-fetch";
import useSWRInfinite from "swr/infinite";
import { useAuth } from "../auth/AuthProvider";

import type { Fabric, FabricListPage, FabricListQuery } from "./fabric-types";

const PAGE_SIZE = 48;
const MAX_FABRIC_IMAGE_BYTES = 50 * 1024 * 1024;
const FABRIC_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export interface FabricUploadInput {
  readonly file: File | null;
  readonly details?: FabricDetails | null;
  readonly tags: readonly string[];
}

export function normalizeFabricTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

export function parseFabricTags(value: string): string[] {
  return normalizeFabricTags(value.split(/[,，、\n#]+/u));
}

export function validateFabricUpload(input: FabricUploadInput): string | null {
  if (!input.file) return "请选择一张面料图片";
  if (!FABRIC_IMAGE_TYPES.has(input.file.type.toLowerCase())) {
    return "仅支持 JPG、PNG、WebP 或 HEIC 图片";
  }
  if (input.file.size <= 0 || input.file.size > MAX_FABRIC_IMAGE_BYTES) {
    return "图片不能为空或超过 50MB";
  }
  const tags = normalizeFabricTags(input.tags);
  if (tags.length === 0) return "请至少添加一个标签";
  if (tags.length > 12) return "标签不能超过 12 个";
  if (tags.some((tag) => tag.length > 30)) return "单个标签不能超过 30 个字";
  if (input.details !== undefined && input.details !== null) {
    const result = fabricDetailsSchema.safeParse(input.details);
    if (!result.success) return result.error.issues[0]?.message ?? "面料档案内容无效";
  }
  return null;
}

export function buildFabricUploadFormData(input: FabricUploadInput): FormData {
  const error = validateFabricUpload(input);
  if (error) throw new Error(error);
  const file = input.file;
  if (!file) throw new Error("请选择一张面料图片");

  const formData = new FormData();
  formData.set("mainImage", file);
  formData.set("tags", JSON.stringify(normalizeFabricTags(input.tags)));
  if (input.details !== undefined) formData.set("details", JSON.stringify(input.details));
  return formData;
}

export async function fetchFabric(fabricId: string): Promise<Fabric> {
  const response = await fetch(`/api/fabrics/${encodeURIComponent(fabricId)}`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readFabricError(response, "面料详情加载失败"));
  }
  return (await response.json()) as Fabric;
}

export async function updateFabric(
  fabricId: string,
  input: {
    readonly tags?: readonly string[];
    readonly details?: FabricDetails | null;
  },
): Promise<Fabric> {
  const response = await fetch(`/api/fabrics/${encodeURIComponent(fabricId)}`, {
    body: JSON.stringify(input),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
  if (!response.ok) {
    throw new Error(await readFabricError(response, "面料更新失败"));
  }
  return (await response.json()) as Fabric;
}

export async function deleteFabric(fabricId: string): Promise<void> {
  const response = await fetch(`/api/fabrics/${encodeURIComponent(fabricId)}`, {
    credentials: "include",
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await readFabricError(response, "面料删除失败"));
  }
}

async function readFabricError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const payload = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(payload.message)) return payload.message.join("；");
    if (payload.message) return payload.message;
  } catch {
    // Keep the stable fallback for non-JSON proxy or storage errors.
  }
  return fallback;
}

export async function createFabric(input: FabricUploadInput): Promise<Fabric> {
  const response = await fetch("/api/fabrics", {
    body: buildFabricUploadFormData(input),
    credentials: "include",
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      await readFabricError(response, "面料上传失败，请稍后重试"),
    );
  }
  return (await response.json()) as Fabric;
}

async function fetchFabricPage(url: string): Promise<FabricListPage> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(await readFabricError(response, "面料列表加载失败"));
  }
  return (await response.json()) as FabricListPage;
}

export function useFabrics(query: FabricListQuery) {
  const { session, loading, error: authError, refresh: refreshAuth } = useAuth();
  const result = useSWRInfinite<FabricListPage>(
    (pageIndex, previousPage) => {
      if (!session) return null;
      if (previousPage && pageIndex >= previousPage.totalPages) return null;
      const params = new URLSearchParams({
        limit: String(query.limit ?? PAGE_SIZE),
        page: String(pageIndex + 1),
        scope: query.scope ?? "all",
      });
      if (query.search?.trim()) params.set("search", query.search.trim());
      for (const field of ["category", "fiber", "supplier", "minWeightGsm", "maxWeightGsm"] as const) {
        const value = query[field];
        if (value !== undefined && value !== "") params.set(field, String(value));
      }
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
    error: result.error instanceof Error ? result.error : !session && authError ? new Error(authError) : null,
    hasMore,
    isLoading: loading || (!session && !authError) || result.isLoading,
    isLoadingMore: result.isValidating && Boolean(result.data?.length),
    items,
    loadMore: () => {
      if (hasMore && !result.isValidating) void result.setSize(result.size + 1);
    },
    refresh: () => { if (!session) void refreshAuth(); else void result.mutate(); },
    total: result.data?.[0]?.total ?? 0,
  };
}
