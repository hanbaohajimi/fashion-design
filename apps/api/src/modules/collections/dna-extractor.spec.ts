import { describe, expect, it, vi } from "vitest";

import { AmuxClaudeDnaExtractor } from "./dna-extractor";

describe("AmuxClaudeDnaExtractor", () => {
  it("使用 Claude 视觉理解提取 Hero Look 系列 DNA", async () => {
    const dna = {
      fabrics: ["真丝"],
      moodWords: ["克制"],
      palette: [{ hex: "#112233", name: "深蓝" }],
      silhouettes: ["茧型"],
    };
    const generateJson = vi.fn().mockResolvedValue(dna);
    const extractor = new AmuxClaudeDnaExtractor({ generateJson });

    await expect(
      extractor.extract("https://cdn.test/hero.png"),
    ).resolves.toEqual(dna);
    expect(generateJson).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [{ detail: "high", url: "https://cdn.test/hero.png" }],
        schemaName: "collection_dna",
      }),
    );
  });
});
