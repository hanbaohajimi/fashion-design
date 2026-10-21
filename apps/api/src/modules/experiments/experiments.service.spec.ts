import { describe, expect, it } from "vitest";
import { experimentCreateSchema } from "@fashion/shared";
import {
  experimentCombinations,
  experimentFingerprint,
} from "./experiments.service";
const input = {
  sourceAssetId: "asset",
  mode: "color" as const,
  prompt: "修改颜色",
  preserve: "领型口袋",
  colors: [
    { name: "黑", hex: "#111111" },
    { name: "蓝", hex: "#336699" },
  ],
  fabricIds: ["cotton", "linen"],
};
describe("服装实验计划", () => {
  it("建立颜色面料笛卡尔积，保持每个组合的实际输入", () => {
    const parsed = experimentCreateSchema.parse(input);
    expect(experimentCombinations(parsed)).toEqual([
      { color: input.colors[0], fabricId: "cotton", variation: null },
      { color: input.colors[0], fabricId: "linen", variation: null },
      { color: input.colors[1], fabricId: "cotton", variation: null },
      { color: input.colors[1], fabricId: "linen", variation: null },
    ]);
  });
  it("在创建任务之前拒绝超过12项的组合和重复面料", () => {
    expect(
      experimentCreateSchema.safeParse({
        ...input,
        variations: ["A", "B", "C", "D"],
      }).success,
    ).toBe(false);
    expect(
      experimentCreateSchema.safeParse({
        ...input,
        fabricIds: ["cotton", "cotton"],
      }).success,
    ).toBe(false);
  });
  it("请求指纹包含母图和保留要求，不能将同键用于其他任务", () => {
    const parsed = experimentCreateSchema.parse(input);
    expect(experimentFingerprint(parsed)).not.toBe(
      experimentFingerprint({ ...parsed, sourceAssetId: "another" }),
    );
    expect(experimentFingerprint(parsed)).not.toBe(
      experimentFingerprint({ ...parsed, preserve: "修改廓形" }),
    );
  });
  it("部件和展示实验必须给出可审核的具体变化", () => {
    expect(
      experimentCreateSchema.safeParse({
        ...input,
        mode: "detail",
        variations: [],
      }).success,
    ).toBe(false);
    expect(
      experimentCreateSchema.safeParse({
        ...input,
        mode: "presentation",
        variations: ["白底平铺", "室内展示"],
      }).success,
    ).toBe(true);
  });
});
