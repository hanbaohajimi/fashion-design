import { describe, expect, it } from "vitest";

import { normalizeFabricTags, parseFabricTags } from "./fabric-api";

describe("fabric tags", () => {
  it("支持中英文逗号、换行和井号分隔", () => {
    expect(parseFabricTags("轻薄，垂坠\n#夏季")).toEqual([
      "轻薄",
      "垂坠",
      "夏季",
    ]);
  });

  it("清理空白并保持首次出现顺序去重", () => {
    expect(normalizeFabricTags([" 轻薄 ", "", "垂坠", "轻薄"])).toEqual([
      "轻薄",
      "垂坠",
    ]);
  });
});
