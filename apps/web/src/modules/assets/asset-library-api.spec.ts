import { describe, expect, it } from "vitest";
import {
  assetFilterParams,
  DEFAULT_ASSET_FILTERS,
  readAssetFilters,
} from "./asset-library-api";

describe("资产筛选地址", () => {
  it("回退无效枚举并限制搜索长度", () => {
    expect(
      readAssetFilters(
        new URLSearchParams({
          kind: "script",
          rating: "6",
          sort: "random",
          source: "unknown",
          q: "a".repeat(200),
        }),
      ),
    ).toEqual({ ...DEFAULT_ASSET_FILTERS, q: "a".repeat(120) });
  });
  it("刷新和返回保留中文搜索、来源、评级与排序", () => {
    const filters = {
      ...DEFAULT_ASSET_FILTERS,
      q: "秋冬 外套",
      source: "uploaded" as const,
      rating: "unrated",
      sort: "rating-desc" as const,
    };
    expect(readAssetFilters(assetFilterParams(filters))).toEqual(filters);
    expect(assetFilterParams(DEFAULT_ASSET_FILTERS).toString()).toBe("");
  });
});
