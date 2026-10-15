import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aiServiceOptionsFromEnv,
  amuxAdapterConfigFromEnv,
  amuxClaudeClientConfigFromEnv,
  createAiProvidersFromEnv,
} from "@fashion/ai";

describe("AI Provider 环境配置", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("使用环境变量指定的 Amux 图片模型，不注册其他图片 Provider", () => {
    vi.stubEnv("AI_PROVIDER_TIMEOUT_MS", "");
    vi.stubEnv("AMUX_IMAGE_MODEL", " openai/gpt-image-2.5-sunburst ");

    expect(aiServiceOptionsFromEnv()).toMatchObject({
      maxRetries: 0,
      primaryProvider: "amux",
      timeoutMs: 600_000,
    });
    expect(createAiProvidersFromEnv().map((provider) => provider.name)).toEqual(
      ["amux"],
    );
    expect(amuxAdapterConfigFromEnv().imageModel).toBe(
      "openai/gpt-image-2.5-sunburst",
    );
  });

  it("允许通过环境变量覆盖十分钟的 Provider 默认超时", () => {
    vi.stubEnv("AI_PROVIDER_TIMEOUT_MS", "900000");

    expect(aiServiceOptionsFromEnv().timeoutMs).toBe(900_000);
  });

  it("Claude 推理默认允许等待十分钟", () => {
    vi.stubEnv("AMUX_CLAUDE_TIMEOUT_MS", "");

    expect(amuxClaudeClientConfigFromEnv().timeoutMs).toBe(600_000);
  });

  it("只从环境变量读取密钥，不在代码中提供默认密钥", () => {
    vi.stubEnv("AMUX_API_KEY", "");

    expect(amuxAdapterConfigFromEnv().apiKey()).toBeUndefined();
  });

  it("默认让 Claude 承担理解任务，并让 GPT Image 只承担生图", () => {
    vi.stubEnv("AMUX_CLAUDE_MODEL", "");
    vi.stubEnv("AMUX_IMAGE_MODEL", " ");
    vi.stubEnv("AMUX_BASE_URL", "");
    expect(amuxClaudeClientConfigFromEnv().model).toBe(
      "anthropic/claude-haiku-5-5",
    );
    expect(amuxAdapterConfigFromEnv().imageModel).toBe(
      "openai/gpt-image-2.5-sunburst",
    );
    expect(amuxClaudeClientConfigFromEnv().baseUrl).toBe(
      "https://gateway.amux.ai/v1",
    );
    expect(amuxAdapterConfigFromEnv().baseUrl).toBe(
      "https://gateway.amux.ai/v1",
    );
  });

  it("文字与图片模型共用配置的网关和动态密钥", () => {
    vi.stubEnv("AMUX_BASE_URL", " https://gateway.amux.ai/v1 ");
    vi.stubEnv("AMUX_CLAUDE_MODEL", " anthropic/claude-haiku-5-5 ");
    vi.stubEnv("AMUX_API_KEY", " test-key ");
    const image = amuxAdapterConfigFromEnv();
    const text = amuxClaudeClientConfigFromEnv();
    expect(image.baseUrl).toBe(text.baseUrl);
    expect(text.model).toBe("anthropic/claude-haiku-5-5");
    expect(image.apiKey()).toBe("test-key");
    expect(text.apiKey()).toBe("test-key");
    vi.stubEnv("AMUX_API_KEY", "rotated-key");
    expect(image.apiKey()).toBe("rotated-key");
    expect(text.apiKey()).toBe("rotated-key");
  });

  it("拒绝把无效的 Amux 图片质量值传给 GPT Image 2", () => {
    vi.stubEnv("AMUX_IMAGE_QUALITY", "ultra");

    expect(amuxAdapterConfigFromEnv().quality).toBe("high");
  });
});
