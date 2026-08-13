/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveGarmentType } from "./LookGrid";
import { LookGrid } from "./LookGrid";
import { shouldCreateGenerationPlaceholder } from "./generation-types";

const mocks = vi.hoisted(() => ({
  createCollectionLook: vi.fn(),
  fetchGenerationTask: vi.fn(),
  track: vi.fn(),
}));

vi.mock("./collection-api", () => ({
  createCollectionLook: mocks.createCollectionLook,
}));

vi.mock("./generation-api", () => ({
  fetchGenerationTask: mocks.fetchGenerationTask,
}));

vi.mock("./GenerationWorkspace", () => ({
  useGenerationWorkspace: () => ({ track: mocks.track }),
}));

vi.mock("../../../observability/analytics", () => ({
  captureAnalytics: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveGarmentType", () => {
  it("返回用户选择的标准服装类型", () => {
    expect(resolveGarmentType("dress", "")).toEqual({
      code: "dress",
      label: "连衣裙",
    });
  });

  it("仅接受填写了名称的自定义服装类型", () => {
    expect(resolveGarmentType("custom", "  披肩  ")).toEqual({
      code: "custom",
      label: "披肩",
    });
    expect(resolveGarmentType("custom", "   ")).toBeNull();
  });
});

describe("shouldCreateGenerationPlaceholder", () => {
  it.each(["queued", "running"] as const)(
    "%s 任务尚无画布形状时创建占位图",
    (status) => {
      expect(shouldCreateGenerationPlaceholder(status, false)).toBe(true);
    },
  );

  it.each(["failed", "moderation_failed", "canceled", "succeeded"] as const)(
    "用户删除 %s 任务的占位图后不再重新创建",
    (status) => {
      expect(shouldCreateGenerationPlaceholder(status, false)).toBe(false);
    },
  );

  it("终态任务的占位图仍存在时继续同步状态", () => {
    expect(shouldCreateGenerationPlaceholder("failed", true)).toBe(true);
  });
});

describe("LookGrid", () => {
  it("生成完成后同时刷新 LOOK 扩展并把任务登记到白板", async () => {
    mocks.createCollectionLook.mockResolvedValue("task-look-1");
    mocks.fetchGenerationTask.mockResolvedValue({
      error: null,
      id: "task-look-1",
      status: "succeeded",
    });
    mocks.track.mockResolvedValue(undefined);
    const beforeGenerate = vi.fn().mockResolvedValue(undefined);
    const onRefresh = vi.fn().mockResolvedValue({
      looks: [
        {
          analysisStatus: "ready",
          assetId: "asset-hero",
          garmentType: { code: "jacket", label: "夹克" },
          isHero: true,
          ordinal: 1,
          similarityScore: null,
          slotKey: null,
          thumbnailUrl: "https://assets.example/hero.png",
          url: "https://assets.example/hero.png",
          variationAxis: null,
          warningIgnored: false,
        },
        {
          analysisStatus: "ready",
          assetId: "asset-look-1",
          garmentType: { code: "dress", label: "连衣裙" },
          isHero: false,
          ordinal: 2,
          similarityScore: 0.8,
          slotKey: "manual-look-1",
          thumbnailUrl: "https://assets.example/look-1.png",
          url: "https://assets.example/look-1.png",
          variationAxis: "garmentType",
          warningIgnored: false,
        },
      ],
      similarities: [],
    });

    render(
      createElement(LookGrid, {
        beforeGenerate,
        collectionId: "collection-1",
        consistency: {
          looks: [
            {
              analysisStatus: "ready",
              assetId: "asset-hero",
              garmentType: { code: "jacket", label: "夹克" },
              isHero: true,
              ordinal: 1,
              similarityScore: null,
              slotKey: null,
              thumbnailUrl: "https://assets.example/hero.png",
              url: "https://assets.example/hero.png",
              variationAxis: null,
              warningIgnored: false,
            },
          ],
          referenceLabel: "参考相似度",
          similarities: [],
        },
        onRefresh,
        sourceGarmentType: { code: "jacket", label: "夹克" },
      }),
    );

    fireEvent.change(screen.getByRole("combobox", { name: "服装类型" }), {
      target: { value: "dress" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成" }));

    await waitFor(() => {
      expect(mocks.track).toHaveBeenCalledWith("task-look-1");
    });
    expect(beforeGenerate).toHaveBeenCalledOnce();
    expect(mocks.createCollectionLook).toHaveBeenCalledWith(
      "collection-1",
      "garmentType",
      undefined,
      { code: "dress", label: "连衣裙" },
      expect.stringMatching(/^manual-/u),
    );
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(mocks.track.mock.invocationCallOrder[0]).toBeLessThan(
      onRefresh.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });
});
