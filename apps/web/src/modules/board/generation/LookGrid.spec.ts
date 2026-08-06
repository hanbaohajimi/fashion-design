import { describe, expect, it } from "vitest";

import {
  analyzeSeriesBalance,
  buildSeriesPlan,
  compileSeriesSlotPrompt,
  createInitialSeriesPlanDraft,
  moveSeriesSlot,
  parsePersistedSeriesPlan,
  resizeSeriesSlots,
  runSeriesPlan,
} from "./LookGrid";

describe("buildSeriesPlan", () => {
  it("默认 8 款系列包含 Hero 和 7 个可编辑扩展槽位", () => {
    const slots = buildSeriesPlan({ code: "jacket", label: "夹克" }, 8);

    expect(slots).toHaveLength(7);
    expect(slots.map((slot) => slot.key)).toEqual([
      "slot-02",
      "slot-03",
      "slot-04",
      "slot-05",
      "slot-06",
      "slot-07",
      "slot-08",
    ]);
    expect(slots.map((slot) => slot.garmentType.code)).toEqual([
      "top",
      "pants",
      "shorts",
      "dress",
      "shirt",
      "knit",
      "skirt",
    ]);
  });

  it("根据核心连衣裙推荐跨品类组合并支持自定义系列数量", () => {
    const slots = buildSeriesPlan({ code: "dress", label: "礼服" }, 4);

    expect(slots).toHaveLength(3);
    expect(slots.map((slot) => slot.garmentType.code)).toEqual([
      "tshirt",
      "shirt",
      "vest",
    ]);
  });

  it("核心类型未指定时使用通用跨品类组合", () => {
    const slots = buildSeriesPlan(null, 2);

    expect(slots).toHaveLength(1);
    expect(slots[0]?.garmentType.code).toBe("jacket");
  });

  it("按槽位顺序串行生成，跳过已完成项并在单项失败后继续", async () => {
    const slots = buildSeriesPlan(null, 5);
    const calls: string[] = [];

    const errors = await runSeriesPlan(
      slots,
      new Set(["slot-03"]),
      async (slot) => {
        calls.push(slot.key);
        if (slot.key === "slot-04") throw new Error("provider failed");
      },
    );

    expect(calls).toEqual(["slot-02", "slot-04", "slot-05"]);
    expect(errors).toEqual([expect.stringContaining("provider failed")]);
  });
});

describe("系列计划草稿", () => {
  it("恢复同一系列与核心类型的草稿，并拒绝来源不匹配的旧草稿", () => {
    const source = { code: "jacket", label: "夹克" } as const;
    const draft = createInitialSeriesPlanDraft("collection-1", source);
    const persisted = JSON.stringify({
      ...draft,
      brief: "都市通勤，早秋上市",
      slots: draft.slots.slice(0, 3),
    });

    expect(
      parsePersistedSeriesPlan(persisted, "collection-1", source)?.brief,
    ).toBe("都市通勤，早秋上市");
    expect(
      parsePersistedSeriesPlan(persisted, "collection-1", {
        code: "dress",
        label: "连衣裙",
      }),
    ).toBeNull();
    expect(parsePersistedSeriesPlan("not-json", "collection-1", source)).toBeNull();
  });

  it("将系列目标与单款方向分层编译，并限制为接口允许的 800 字符", () => {
    const prompt = compileSeriesSlotPrompt(
      "面向城市骑行与通勤，强调轻量叠穿",
      "增加可拆卸下摆",
    );

    expect(prompt).toContain("系列开发目标：面向城市骑行与通勤，强调轻量叠穿");
    expect(prompt).toContain("当前槽位设计方向：增加可拆卸下摆");
    expect(compileSeriesSlotPrompt("目标".repeat(500), "方向".repeat(500))).toHaveLength(
      800,
    );
  });
});

describe("系列结构编排", () => {
  it("识别缺少下装和连身款的失衡计划", () => {
    const analysis = analyzeSeriesBalance(
      { code: "jacket", label: "夹克" },
      buildSeriesPlan({ code: "dress", label: "连衣裙" }, 4),
    );

    expect(analysis.total).toBe(4);
    expect(analysis.warnings).toEqual([
      expect.stringContaining("下装"),
      expect.stringContaining("连身款"),
    ]);
  });

  it("缩减系列时只移除尾部未完成槽位，并保护已完成款的顺序", () => {
    const slots = buildSeriesPlan(null, 6);
    const completed = new Set(["slot-05"]);
    const resized = resizeSeriesSlots(slots, 3, null, completed);

    expect(resized.map((slot) => slot.key)).toEqual(["slot-02", "slot-05"]);
    expect(moveSeriesSlot(slots, "slot-05", -1, completed)).toBe(slots);
    expect(moveSeriesSlot(slots, "slot-04", 1, completed)).toBe(slots);
  });
});
