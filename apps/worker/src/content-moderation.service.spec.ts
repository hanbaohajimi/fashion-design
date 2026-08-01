import { AmuxClaudeClient } from "@fashion/ai";
import { describe, expect, it, vi } from "vitest";

import { AmuxClaudeContentModerationService } from "./content-moderation.service";

describe("AmuxClaudeContentModerationService", () => {
  it("原生 Anthropic Messages 强制工具结果能通过审核 Schema", async () => {
    const transport = vi.fn().mockResolvedValue({
      content: [
        {
          input: { categories: [], status: "approved" },
          name: "generated_image_moderation",
          type: "tool_use",
        },
      ],
      stop_reason: "tool_use",
    });
    const service = new AmuxClaudeContentModerationService(
      new AmuxClaudeClient(
        {
          apiKey: () => "test-key",
          baseUrl: "https://api.amux.ai/v1",
          model: "claude-sonnet-5",
          timeoutMs: 20_000,
        },
        transport,
      ),
    );

    await expect(
      service.moderate(["https://cdn.test/generated.png"]),
    ).resolves.toEqual({ categories: [], status: "approved" });
    expect(transport).toHaveBeenCalledWith(
      "https://api.amux.ai/v1/messages",
      expect.objectContaining({
        body: expect.objectContaining({
          tool_choice: {
            disable_parallel_tool_use: true,
            name: "generated_image_moderation",
            type: "tool",
          },
        }),
      }),
    );
  });

  it("任一结果被标记时返回拒绝与命中类别", async () => {
    const generateJson = vi.fn().mockResolvedValue({
      categories: ["sexual"],
      status: "rejected",
    });
    const service = new AmuxClaudeContentModerationService({ generateJson });

    await expect(
      service.moderate(["https://cdn.test/generated.png"]),
    ).resolves.toEqual({
      categories: ["sexual"],
      status: "rejected",
    });
    expect(generateJson).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [{ detail: "low", url: "https://cdn.test/generated.png" }],
        schemaName: "generated_image_moderation",
      }),
    );
  });

  it("审核通过时丢弃模型返回的非风险描述类别", async () => {
    const generateJson = vi.fn().mockImplementation(async (request) =>
      request.parse({
        categories: ["silver dress", "fashion design"],
        status: "approved",
      }),
    );
    const service = new AmuxClaudeContentModerationService({ generateJson });

    await expect(
      service.moderate(["https://cdn.test/generated.png"]),
    ).resolves.toEqual({ categories: [], status: "approved" });
  });

  it("审核 API 异常时降级为人工复查而不是跳过标记", async () => {
    const service = new AmuxClaudeContentModerationService({
      generateJson: vi.fn().mockRejectedValue(new Error("network unavailable")),
    });

    await expect(
      service.moderate(["https://cdn.test/generated.png"]),
    ).resolves.toMatchObject({
      reason: "unavailable",
      status: "review_required",
    });
  });
});
