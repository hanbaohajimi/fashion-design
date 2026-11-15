import type {
  LibraryAsset,
  LibraryAssetPage,
  LibraryAssetSort,
  LibraryAssetSource,
  GeneratedFileFilter,
} from "@fashion/shared";
import { privateFetch } from "../auth/private-fetch";
import { readErrorMessage } from "../auth/auth-api";

export interface AssetFilters {
  kind: GeneratedFileFilter;
  source: LibraryAssetSource | "all";
  rating: string;
  sort: LibraryAssetSort;
  q: string;
}
export const DEFAULT_ASSET_FILTERS: AssetFilters = {
  kind: "all",
  source: "all",
  rating: "all",
  sort: "newest",
  q: "",
};
export function readAssetFilters(
  params: Pick<URLSearchParams, "get">,
): AssetFilters {
  const oneOf = <T extends string>(
    value: string | null,
    choices: readonly T[],
    fallback: T,
  ): T => (choices.includes(value as T) ? (value as T) : fallback);
  return {
    kind: oneOf(
      params.get("kind"),
      ["all", "image", "video", "audio", "document"],
      "all",
    ),
    source: oneOf(
      params.get("source"),
      ["all", "generated", "uploaded", "exported"],
      "all",
    ),
    rating: oneOf(
      params.get("rating"),
      ["all", "unrated", "1", "2", "3", "4", "5"],
      "all",
    ),
    sort: oneOf(
      params.get("sort"),
      ["newest", "oldest", "rating-desc", "rating-asc"],
      "newest",
    ),
    q: (params.get("q") ?? "").slice(0, 120),
  };
}
export function assetFilterParams(filters: AssetFilters) {
  const params = new URLSearchParams();
  for (const key of Object.keys(filters) as (keyof AssetFilters)[])
    if (filters[key] !== DEFAULT_ASSET_FILTERS[key])
      params.set(key, filters[key]);
  return params;
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await privateFetch(url, {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  if (!response.ok)
    throw new Error(await readErrorMessage(response, "资产操作失败，请重试。"));
  return response.json() as Promise<T>;
}
export function fetchLibraryAssets(
  filters: AssetFilters,
  cursor?: string,
  signal?: AbortSignal,
): Promise<LibraryAssetPage> {
  const params = assetFilterParams(filters);
  params.set("limit", "30");
  if (cursor) params.set("cursor", cursor);
  return request(`/api/assets?${params}`, signal ? { signal } : undefined);
}
export function rateLibraryAsset(
  asset: LibraryAsset,
  rating: number | null,
  signal?: AbortSignal,
) {
  return request<{ rating: number | null }>(
    `/api/assets/${asset.domain}/${encodeURIComponent(asset.resourceId)}/rating`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating }),
      ...(signal ? { signal } : {}),
    },
  );
}
export function downloadLibraryAsset(asset: LibraryAsset, signal: AbortSignal) {
  return request<{ url: string; fileName: string }>(
    `/api/assets/${asset.domain}/${encodeURIComponent(asset.resourceId)}/download`,
    { signal },
  );
}
