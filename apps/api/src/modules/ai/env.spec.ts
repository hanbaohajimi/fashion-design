import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aiServiceOptionsFromEnv,
  amuxAdapterConfigFromEnv,
  amuxClaudeClientConfigFromEnv,
  createAiProvidersFromEnv,
} from "@fashion/ai";

describe("AI Provider 环境配置", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("固定使用 Amux 的 GPT Image 2，不注册其他图片 Provider", () => {
    vi.stubEnv("AI_PROVIDER_TIMEOUT_MS", "");
    vi.stubEnv("AMUX_IMAGE_MODEL", "legacy-image-model");

    expect(aiServiceOptionsFromEnv()).toMatchObject({
      maxRetries: 0,
      primaryProvider: "amux",
      timeoutMs: 600_000,
    });
    expect(createAiProvidersFromEnv().map((provider) => provider.name)).toEqual(
      ["amux"],
    );
    expect(amuxAdapterConfigFromEnv().imageModel).toBe("gpt-image-2-official");
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
    expect(amuxClaudeClientConfigFromEnv().model).toBe("claude-opus-5");
    expect(amuxAdapterConfigFromEnv().imageModel).toBe("gpt-image-2-official");
  });

  it("拒绝把无效的 Amux 图片质量值传给 GPT Image 2", () => {
    vi.stubEnv("AMUX_IMAGE_QUALITY", "ultra");

    expect(amuxAdapterConfigFromEnv().quality).toBe("high");
  });
});
