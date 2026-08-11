import useSWRInfinite from "swr/infinite";

import type {
  Fabric,
  FabricListPage,
  FabricListQuery,
} from "./fabric-types";

const PAGE_SIZE = 48;
const MAX_FABRIC_IMAGE_BYTES = 50 * 1024 * 1024;
const FABRIC_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export type FabricUploadCategory =
  | "cotton"
  | "silk"
  | "wool"
  | "synthetic"
  | "blend";
export type FabricUploadWeave =
  | "plain"
  | "twill"
  | "satin"
  | "knit"
  | "jacquard";

export interface FabricUploadInput {
  readonly category: FabricUploadCategory;
  readonly composition?: Readonly<Record<string, number>>;
  readonly compositionName: string;
  readonly file: File | null;
  readonly name: string;
  readonly weight: number;
  readonly weave: FabricUploadWeave;
}

export function validateFabricUpload(input: FabricUploadInput): string | null {
  if (!input.file) return "请选择一张面料图片";
  if (!FABRIC_IMAGE_TYPES.has(input.file.type.toLowerCase())) {
    return "仅支持 JPG、PNG、WebP 或 HEIC 图片";
  }
  if (input.file.size <= 0 || input.file.size > MAX_FABRIC_IMAGE_BYTES) {
    return "图片不能为空或超过 50MB";
  }
  if (!input.name.trim()) return "请填写面料名称";
  if (!input.compositionName.trim()) return "请填写主要成分";
  const composition = normalizedComposition(input);
  if (Object.keys(composition).length === 0) return "请填写主要成分";
  if (
    Object.values(composition).some(
      (percentage) =>
        !Number.isFinite(percentage) || percentage <= 0 || percentage > 100,
    )
  ) {
    return "成分占比必须大于 0 且不超过 100%";
  }
  const total = Object.values(composition).reduce(
    (sum, percentage) => sum + percentage,
    0,
  );
  if (Math.abs(total - 100) > 0.000_001) {
    return "成分占比总和必须等于 100%";
  }
  if (!Number.isFinite(input.weight) || input.weight <= 0 || input.weight > 2_000) {
    return "克重必须在 0–2000 GSM 之间";
  }
  return null;
}

export function buildFabricUploadFormData(
  input: FabricUploadInput,
): FormData {
  const error = validateFabricUpload(input);
  if (error) throw new Error(error);
  const file = input.file;
  if (!file) throw new Error("请选择一张面料图片");

  const formData = new FormData();
  formData.set("mainImage", file);
  formData.set("name", input.name.trim());
  formData.set("category", input.category);
  formData.set(
    "attributes",
    JSON.stringify({
      composition: normalizedComposition(input),
      weight: input.weight,
      weave: input.weave,
    }),
  );
  return formData;
}

function normalizedComposition(
  input: FabricUploadInput,
): Record<string, number> {
  if (!input.composition) {
    return input.compositionName.trim()
      ? { [input.compositionName.trim()]: 100 }
      : {};
  }
  return Object.fromEntries(
    Object.entries(input.composition).flatMap(([name, percentage]) => {
      const normalizedName = name.trim();
      return normalizedName ? [[normalizedName, percentage]] : [];
    }),
  );
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
    readonly attributes?: Fabric["attributes"];
    readonly category?: FabricUploadCategory;
    readonly name?: string;
    readonly subCategory?: string | null;
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
    throw new Error(await readFabricError(response, "面料上传失败，请稍后重试"));
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
      if (query.composition && query.composition !== "all") {
        params.set("composition", query.composition);
      }
      if (query.season && query.season !== "all") {
        params.set("season", query.season);
      }
      if (query.minWeight !== undefined) {
        params.set("minWeight", String(query.minWeight));
      }
      if (query.maxWeight !== undefined) {
        params.set("maxWeight", String(query.maxWeight));
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
