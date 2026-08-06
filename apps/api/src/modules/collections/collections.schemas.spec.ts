import { describe, expect, it } from "vitest";

import {
  createCollectionLookSchema,
  garmentTypeSchema,
  updateDnaSchema,
} from "./collections.schemas";

describe("collections schemas", () => {
  it("接受标准类型和自定义类型", () => {
    expect(
      garmentTypeSchema.safeParse({ code: "dress", label: "连衣裙" }).success,
    ).toBe(true);
    expect(
      garmentTypeSchema.safeParse({ code: "custom", label: "披挂式上装" })
        .success,
    ).toBe(true);
  });

  it("拒绝空白、超长和未知服装类型", () => {
    expect(
      garmentTypeSchema.safeParse({ code: "custom", label: "   " }).success,
    ).toBe(false);
    expect(
      garmentTypeSchema.safeParse({ code: "custom", label: "x".repeat(65) })
        .success,
    ).toBe(false);
    expect(
      garmentTypeSchema.safeParse({ code: "cape", label: "斗篷" }).success,
    ).toBe(false);
  });

  it("服装类型变化要求 garmentType 和 slotKey", () => {
    expect(
      createCollectionLookSchema.safeParse({ variationAxis: "garmentType" })
        .success,
    ).toBe(false);
    expect(
      createCollectionLookSchema.safeParse({
        garmentType: { code: "pants", label: "长裤" },
        slotKey: "slot-02",
        variationAxis: "garmentType",
      }).success,
    ).toBe(true);
  });

  it("旧的单 Look 请求保持兼容并允许保存标志性细节", () => {
    expect(
      createCollectionLookSchema.safeParse({ variationAxis: "detail" }).success,
    ).toBe(true);
    expect(
      updateDnaSchema.safeParse({
        signatureDetails: ["模块化口袋", "弧形分割线", "金属扣件"],
      }).success,
    ).toBe(true);
  });
});
