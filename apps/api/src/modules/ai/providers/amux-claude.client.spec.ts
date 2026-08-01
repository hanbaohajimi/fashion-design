import { AmuxClaudeClient } from "@fashion/ai";
import { describe, expect, it, vi } from "vitest";

describe("AmuxClaudeClient", () => {
  it("通过 Amux Anthropic Messages 强制 Claude 工具调用返回结构化 JSON", async () => {
    const transport = vi.fn().mockResolvedValue({
      content: [
        {
          input: { labels: ["silk"] },
          name: "fashion_labels",
          type: "tool_use",
        },
      ],
      stop_reason: "tool_use",
    });
    const client = new AmuxClaudeClient(
      {
        apiKey: () => "test-key",
        baseUrl: "https://api.amux.ai/v1",
        model: "claude-sonnet-5",
        timeoutMs: 12_000,
      },
      transport,
    );

    const result = await client.generateJson({
      images: [{ detail: "low", url: "https://cdn.test/look.png" }],
      instructions: "trusted system instruction",
      jsonSchema: {
        additionalProperties: false,
        properties: { labels: { items: { type: "string" }, type: "array" } },
        required: ["labels"],
        type: "object",
      },
      maxTokens: 200,
      parse: (value) => value as { labels: string[] },
      prompt: "classify this image",
      schemaName: "fashion_labels",
    });

    expect(result).toEqual({ labels: ["silk"] });
    expect(transport).toHaveBeenCalledWith(
      "https://api.amux.ai/v1/messages",
      expect.objectContaining({
        apiKey: "test-key",
        body: expect.objectContaining({
          model: "claude-sonnet-5",
          tool_choice: {
            disable_parallel_tool_use: true,
            name: "fashion_labels",
            type: "tool",
          },
          system: "trusted system instruction",
          tools: [
            expect.objectContaining({
              input_schema: expect.objectContaining({ type: "object" }),
              name: "fashion_labels",
              strict: true,
            }),
          ],
        }),
        timeoutMs: 12_000,
      }),
    );
    const request = transport.mock.calls.at(0)?.[1];
    expect(request.body.messages[0].content).toContainEqual({
      source: { type: "url", url: "https://cdn.test/look.png" },
      type: "image",
    });
  });

  it("拼接 Amux Claude Messages 返回的多个文本块", async () => {
    const transport = vi.fn().mockResolvedValue({
      content: [
        { type: "text", text: "```json\n" },
        { type: "text", text: '{"labels":["silk"]}\n```' },
      ],
      stop_reason: "end_turn",
    });
    const client = new AmuxClaudeClient(
      {
        apiKey: () => "test-key",
        baseUrl: "https://api.amux.ai/v1",
        model: "claude-sonnet-5",
        timeoutMs: 12_000,
      },
      transport,
    );

    await expect(
      client.generateJson({
        instructions: "return json",
        jsonSchema: { type: "object" },
        maxTokens: 200,
        parse: (value) => value as { labels: string[] },
        prompt: "classify",
        schemaName: "fashion_labels",
      }),
    ).resolves.toEqual({ labels: ["silk"] });
  });

  it("把 GPT Image 返回的 data URL 转为 Anthropic base64 图片源", async () => {
    const transport = vi.fn().mockResolvedValue({
      content: [
        { type: "text", text: '{"status":"approved","categories":[]}' },
      ],
      stop_reason: "end_turn",
    });
    const client = new AmuxClaudeClient(
      {
        apiKey: () => "test-key",
        baseUrl: "https://api.amux.ai/v1",
        model: "claude-sonnet-5",
        timeoutMs: 12_000,
      },
      transport,
    );

    await client.generateJson({
      images: [{ url: "data:image/png;base64,aGVsbG8=" }],
      instructions: "moderate",
      jsonSchema: { type: "object" },
      maxTokens: 200,
      parse: (value) => value,
      prompt: "check",
      schemaName: "moderation",
    });

    const request = transport.mock.calls.at(0)?.[1];
    expect(request.body.messages[0].content).toContainEqual({
      source: {
        data: "aGVsbG8=",
        media_type: "image/png",
        type: "base64",
      },
      type: "image",
    });
  });

  it("能从 Amux 附加说明文字中提取并校验 JSON", async () => {
    const client = new AmuxClaudeClient(
      {
        apiKey: () => "test-key",
        baseUrl: "https://api.amux.ai/v1",
        model: "claude-sonnet-5",
        timeoutMs: 12_000,
      },
      vi.fn().mockResolvedValue({
        content: [
          {
            type: "text",
            text: '审核结果如下：\n```json\n{"status":"approved","categories":[]}\n```\n审核完成。',
          },
        ],
        stop_reason: "end_turn",
      }),
    );

    await expect(
      client.generateJson({
        instructions: "moderate",
        jsonSchema: { type: "object" },
        maxTokens: 200,
        parse: (value) => value as { status: string },
        prompt: "check",
        schemaName: "moderation",
      }),
    ).resolves.toEqual({ status: "approved", categories: [] });
  });

  it.each(["refusal", "max_tokens"])(
    "Claude stop_reason=%s 时拒绝解析不受 Schema 约束的结果",
    async (stopReason) => {
      const client = new AmuxClaudeClient(
        {
          apiKey: () => "test-key",
          baseUrl: "https://api.amux.ai/v1",
          model: "claude-sonnet-5",
          timeoutMs: 12_000,
        },
        vi.fn().mockResolvedValue({
          content: [{ type: "text", text: '{"status":"approved"}' }],
          stop_reason: stopReason,
        }),
      );

      await expect(
        client.generateJson({
          instructions: "moderate",
          jsonSchema: { type: "object" },
          maxTokens: 200,
          parse: (value) => value,
          prompt: "check",
          schemaName: "moderation",
        }),
      ).rejects.toThrow(/拒绝|截断/u);
    },
  );

  it("Claude 拒绝时即使携带工具块也不能被当成成功结果", async () => {
    const client = new AmuxClaudeClient(
      {
        apiKey: () => "test-key",
        baseUrl: "https://api.amux.ai/v1",
        model: "claude-sonnet-5",
        timeoutMs: 12_000,
      },
      vi.fn().mockResolvedValue({
        content: [
          {
            input: { categories: [], status: "approved" },
            name: "moderation",
            type: "tool_use",
          },
        ],
        stop_reason: "refusal",
      }),
    );

    await expect(
      client.generateJson({
        instructions: "moderate",
        jsonSchema: { type: "object" },
        maxTokens: 200,
        parse: (value) => value,
        prompt: "check",
        schemaName: "moderation",
      }),
    ).rejects.toThrow(/拒绝/u);
  });
});
