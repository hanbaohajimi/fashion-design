import { describe, expect, it } from "vitest";
import { createFabricSchema, listFabricsSchema, updateFabricSchema } from "./fabric.dto";

const provenance = { composition: { source: "supplier" }, weightGsm: { source: "measured", note: "2026-10-21 实测" } };

describe("面料档案输入", () => {
  it("旧上传和标签更新不需要档案，空更新无效", () => {
    expect(createFabricSchema.parse({ tags: ["轻薄"] })).toEqual({ tags: ["轻薄"] });
    expect(updateFabricSchema.parse({ tags: ["哑光"] })).toEqual({ tags: ["哑光"] });
    expect(updateFabricSchema.safeParse({}).success).toBe(false);
    expect(updateFabricSchema.parse({ details: null })).toEqual({ details: null });
  });

  it("接受合计100%的混纺和零报价，拒绝未知内部字段", () => {
    const details = { composition: [{ fiber: "棉", percent: 60 }, { fiber: "亚麻", percent: 40 }], weightGsm: 125, provenance };
    expect(createFabricSchema.safeParse({ tags: ["夏季"], details }).success).toBe(true);
    expect(createFabricSchema.safeParse({ tags: ["夏季"], details: { ...details, _fiberKeys: ["假值"] } }).success).toBe(false);
    expect(createFabricSchema.safeParse({ tags: ["夏季"], details: { price: 0, unit: "米", currency: "CNY", provenance: { price: { source: "supplier" }, unit: { source: "supplier" }, currency: { source: "supplier" } } } }).success).toBe(true);
  });

  it("拒绝成分不满100%、重复成分、无依据规格和AI推测物性", () => {
    for (const details of [
      { composition: [{ fiber: "棉", percent: 90 }], provenance },
      { composition: [{ fiber: "棉", percent: 50 }, { fiber: "棉", percent: 50 }], provenance },
      { weightGsm: 200 },
      { weightGsm: 200, provenance: { weightGsm: { source: "ai_visual" } } },
      { price: 12, provenance: { price: { source: "supplier" } } },
    ]) expect(createFabricSchema.safeParse({ tags: ["春夏"], details }).success).toBe(false);
    expect(createFabricSchema.safeParse({ tags: ["春夏"], details: { appearanceNotes: "看起来有细微光泽", provenance: { appearanceNotes: { source: "ai_visual" } } } }).success).toBe(true);
  });

  it("克重范围校验在查询前拒绝倒置、负值和过大数值", () => {
    expect(listFabricsSchema.safeParse({ minWeightGsm: 300, maxWeightGsm: 100 }).success).toBe(false);
    expect(listFabricsSchema.safeParse({ minWeightGsm: -1 }).success).toBe(false);
    expect(listFabricsSchema.safeParse({ maxWeightGsm: 10001 }).success).toBe(false);
    expect(listFabricsSchema.parse({ minWeightGsm: "120", maxWeightGsm: "200", fiber: " 棉 " })).toMatchObject({ minWeightGsm: 120, maxWeightGsm: 200, fiber: "棉" });
  });
});
