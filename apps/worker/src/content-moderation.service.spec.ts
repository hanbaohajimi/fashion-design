import { describe, expect, it, vi } from "vitest";

import { OpenAiContentModerationService } from "./content-moderation.service";

describe("OpenAiContentModerationService", () => {
  it("任一结果被标记时返回拒绝与命中类别", async () => {
    const create = vi.fn().mockResolvedValue({
      results: [
        {
          categories: { sexual: true, violence: false },
          flagged: true,
        },
      ],
    });
    const service = new OpenAiContentModerationService({ create } as never);

    await expect(
      service.moderate(["https://cdn.test/generated.png"]),
    ).resolves.toEqual({
      categories: ["sexual"],
      status: "rejected",
    });
    expect(create).toHaveBeenCalledWith({
      input: [
        {
          image_url: { url: "https://cdn.test/generated.png" },
          type: "image_url",
        },
      ],
      model: "omni-moderation-latest",
    });
  });

  it("审核 API 异常时降级为人工复查而不是跳过标记", async () => {
    const service = new OpenAiContentModerationService({
      create: vi.fn().mockRejectedValue(new Error("network unavailable")),
    } as never);

    await expect(
      service.moderate(["https://cdn.test/generated.png"]),
    ).resolves.toMatchObject({
      reason: "unavailable",
      status: "review_required",
    });
  });
});
