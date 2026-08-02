import { describe, expect, it } from "vitest";

import {
  createFabricSchema,
  listFabricsSchema,
  updateFabricSchema,
} from "./fabric.dto";

const validAttributes = {
  composition: { cotton: 60, polyester: 40 },
  drape: "moderate",
  stretch: "slight",
  weave: "plain",
  weight: 180,
};

describe("fabric DTO", () => {
  it("接受总和为 100% 的成分配比", () => {
    expect(
      createFabricSchema.parse({
        attributes: validAttributes,
        category: "blend",
        name: "60支混纺府绸",
        subCategory: "poplin",
      }),
    ).toMatchObject({ attributes: validAttributes });
  });

  it("拒绝总和不为 100% 的成分配比", () => {
    const result = createFabricSchema.safeParse({
      attributes: {
        ...validAttributes,
        composition: { cotton: 60, polyester: 39 },
      },
      category: "blend",
      name: "错误配比",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("100");
  });

  it("解析列表分页与 all 范围", () => {
    expect(listFabricsSchema.parse({ page: "2", scope: "all" })).toMatchObject({
      limit: 24,
      page: 2,
      scope: "all",
    });
  });

  it("拒绝没有任何修改字段的 PATCH", () => {
    expect(updateFabricSchema.safeParse({}).success).toBe(false);
  });
});
