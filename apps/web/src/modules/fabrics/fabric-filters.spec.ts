import { describe, expect, it } from "vitest";

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
