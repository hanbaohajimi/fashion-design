import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aiServiceOptionsFromEnv,
  amuxAdapterConfigFromEnv,
  amuxClaudeClientConfigFromEnv,
  createAiProvidersFromEnv,
  dashScopeAdapterConfigFromEnv,
} from "@fashion/ai";

describe("AI Provider 环境配置", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("未显式配置时默认使用 Amux，并注册百炼预留渠道", () => {
    vi.stubEnv("AI_PRIMARY_PROVIDER", "");
    vi.stubEnv("AI_FALLBACK_PROVIDER", "");
    vi.stubEnv("AI_PROVIDER_TIMEOUT_MS", "");

    expect(aiServiceOptionsFromEnv()).toMatchObject({
      maxRetries: 0,
      primaryProvider: "amux",
      timeoutMs: 600_000,
    });
    expect(createAiProvidersFromEnv().map((provider) => provider.name)).toEqual(
      ["amux", "dashscope"],
    );
  });

  it("允许通过环境变量覆盖十分钟的 Provider 默认超时", () => {
    vi.stubEnv("AI_PROVIDER_TIMEOUT_MS", "900000");

    expect(aiServiceOptionsFromEnv().timeoutMs).toBe(900_000);
  });

  it("只从环境变量读取密钥，不在代码中提供默认密钥", () => {
    vi.stubEnv("AMUX_API_KEY", "");
    vi.stubEnv("DASHSCOPE_API_KEY", "");

    expect(amuxAdapterConfigFromEnv().apiKey()).toBeUndefined();
    expect(dashScopeAdapterConfigFromEnv().apiKey()).toBeUndefined();
  });

  it("默认让 Claude 承担理解任务，并让 GPT Image 只承担生图", () => {
    vi.stubEnv("AMUX_CLAUDE_MODEL", "");
    vi.stubEnv("AMUX_IMAGE_MODEL", "");

    expect(amuxClaudeClientConfigFromEnv().model).toBe("claude-sonnet-5");
    expect(amuxAdapterConfigFromEnv().imageModel).toBe("gpt-image-2");
  });

  it("拒绝把无效的 Amux 图片质量值传给 GPT Image 2", () => {
    vi.stubEnv("AMUX_IMAGE_QUALITY", "ultra");

    expect(amuxAdapterConfigFromEnv().quality).toBe("high");
  });
});
