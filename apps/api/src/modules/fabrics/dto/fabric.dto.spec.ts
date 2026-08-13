import { describe, expect, it } from "vitest";

import {
  createFabricSchema,
  listFabricsSchema,
  updateFabricSchema,
} from "./fabric.dto";

describe("fabric DTO", () => {
  it("创建时只接受标签并自动去重", () => {
    expect(
      createFabricSchema.parse({ tags: ["轻薄", "垂坠", "轻薄"] }),
    ).toEqual({
      tags: ["轻薄", "垂坠"],
    });
  });

  it("拒绝空标签或超过限制的标签", () => {
    expect(createFabricSchema.safeParse({ tags: [] }).success).toBe(false);
    expect(
      createFabricSchema.safeParse({ tags: ["x".repeat(31)] }).success,
    ).toBe(false);
  });

  it("解析列表分页与 all 范围", () => {
    expect(listFabricsSchema.parse({ page: "2", scope: "all" })).toMatchObject({
      limit: 24,
      page: 2,
      scope: "all",
    });
  });

  it("PATCH 必须提供有效标签", () => {
    expect(updateFabricSchema.safeParse({}).success).toBe(false);
    expect(updateFabricSchema.parse({ tags: ["哑光"] })).toEqual({
      tags: ["哑光"],
    });
  });
});
