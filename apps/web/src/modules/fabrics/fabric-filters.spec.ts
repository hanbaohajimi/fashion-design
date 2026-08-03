import { describe, expect, it } from "vitest";

import {
  buildFabricUploadFormData,
  validateFabricUpload,
} from "./fabric-api";
import { filterFabrics } from "./fabric-filters";
import type { Fabric } from "./fabric-types";

function fabric(
  id: string,
  overrides: Partial<Fabric> = {},
): Fabric {
  return {
    attributes: {
      composition: { cotton: 100 },
      seasonSuggestion: ["spring", "summer"],
      weave: "plain",
      weight: 120,
    },
    category: "cotton",
    createdAt: "2026-08-02T00:00:00.000Z",
    id,
    mainFileId: `file-${id}`,
    mainImageUrl: `/api/fabrics/${id}/image`,
    name: "纯棉府绸",
    scope: "preset",
    subCategory: "poplin",
    updatedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("filterFabrics", () => {
  const records = [
    fabric("cotton"),
    fabric("silk", {
      attributes: {
        composition: { silk: 92, spandex: 8 },
        seasonSuggestion: ["summer"],
        weight: 88,
      },
      category: "silk",
      name: "弹力真丝",
    }),
    fabric("wool", {
      attributes: {
        composition: { wool: 100 },
        seasonSuggestion: ["autumn", "winter"],
        weight: 260,
      },
      category: "wool",
      name: "重磅羊毛呢",
    }),
  ];

  it("按成分、克重和季节组合筛选", () => {
    expect(
      filterFabrics(records, {
        composition: "silk",
        season: "summer",
        weight: "light",
      }).map((item) => item.id),
    ).toEqual(["silk"]);
  });

  it("把缺失克重视为未归类而不是零克重", () => {
    const unknownWeight = fabric("unknown", {
      attributes: { composition: { cotton: 100 }, weave: "plain" },
    });

    expect(
      filterFabrics([unknownWeight], {
        composition: "all",
        season: "all",
        weight: "light",
      }),
    ).toEqual([]);
  });
});

describe("fabric upload", () => {
  const image = new File([new Uint8Array([137, 80, 78, 71])], "linen.png", {
    type: "image/png",
  });

  it("将图片和面料属性编码为后端要求的 multipart 字段", () => {
    const formData = buildFabricUploadFormData({
      category: "blend",
      compositionName: "亚麻混纺",
      file: image,
      name: "天然亚麻",
      weight: 180,
      weave: "plain",
    });

    expect(formData.get("mainImage")).toBe(image);
    expect(formData.get("name")).toBe("天然亚麻");
    expect(formData.get("category")).toBe("blend");
    expect(JSON.parse(String(formData.get("attributes")))).toEqual({
      composition: { 亚麻混纺: 100 },
      weight: 180,
      weave: "plain",
    });
  });

  it("在请求前拒绝缺失图片和无效文件类型", () => {
    expect(
      validateFabricUpload({
        category: "blend",
        compositionName: "混合纤维",
        file: null,
        name: "测试面料",
        weight: 180,
        weave: "plain",
      }),
    ).toBe("请选择一张面料图片");

    expect(
      validateFabricUpload({
        category: "blend",
        compositionName: "混合纤维",
        file: new File(["text"], "notes.txt", { type: "text/plain" }),
        name: "测试面料",
        weight: 180,
        weave: "plain",
      }),
    ).toBe("仅支持 JPG、PNG、WebP 或 HEIC 图片");
  });
});
