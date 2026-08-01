import { describe, expect, it, vi } from "vitest";

import { AmuxClaudeVlmClassifier } from "./vlm-classifier";

describe("AmuxClaudeVlmClassifier", () => {
  it("使用 Claude 识别图片角色且只返回结构化标签", async () => {
    const generateJson = vi.fn().mockResolvedValue({
      confidence: 0.9,
      isFashion: true,
      label: "fabric_texture",
    });
    const classifier = new AmuxClaudeVlmClassifier({ generateJson });

    await expect(
      classifier.classify(Buffer.from("image"), "image/webp"),
    ).resolves.toEqual({
      confidence: 0.9,
      isFashion: true,
      label: "fabric_texture",
    });
    expect(generateJson).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [
          expect.objectContaining({
            detail: "low",
            url: expect.stringMatching(/^data:image\/webp;base64,/),
          }),
        ],
        schemaName: "fashion_board_role",
      }),
    );
  });
});
