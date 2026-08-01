import { AiRuntimeService, type AiServiceOptions } from "./ai.service";
import {
  AmuxClaudeClient,
  type AmuxClaudeClientConfig,
} from "./amux-claude.client";
import type { AiProvider } from "./provider.interface";
import { AmuxAdapter, type AmuxAdapterConfig } from "./providers/amux.adapter";
import {
  DashScopeAdapter,
  type DashScopeAdapterConfig,
} from "./providers/dashscope.adapter";
import { createReferenceImageLoader } from "./reference-image.loader";

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value?.trim()) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function imageQualityFromEnv(
  value: string | undefined,
): "auto" | "high" | "low" | "medium" {
  return value === "auto" ||
    value === "high" ||
    value === "low" ||
    value === "medium"
    ? value
    : "high";
}

export function amuxAdapterConfigFromEnv(): AmuxAdapterConfig {
  return {
    apiKey: () => process.env.AMUX_API_KEY?.trim() || undefined,
    baseUrl: process.env.AMUX_BASE_URL?.trim() || "https://api.amux.ai/v1",
    imageModel: process.env.AMUX_IMAGE_MODEL?.trim() || "gpt-image-2",
    quality: imageQualityFromEnv(process.env.AMUX_IMAGE_QUALITY?.trim()),
    imageCostUsd: numberFromEnv(process.env.AMUX_IMAGE_COST_USD, 0),
    editCostUsd: numberFromEnv(process.env.AMUX_EDIT_COST_USD, 0),
    creditsPerUsd: numberFromEnv(process.env.AI_CREDITS_PER_USD, 100),
  };
}

export function amuxClaudeClientConfigFromEnv(): AmuxClaudeClientConfig {
  return {
    apiKey: () => process.env.AMUX_API_KEY?.trim() || undefined,
    baseUrl: process.env.AMUX_BASE_URL?.trim() || "https://api.amux.ai/v1",
    model: process.env.AMUX_CLAUDE_MODEL?.trim() || "claude-sonnet-5",
    timeoutMs: numberFromEnv(process.env.AMUX_CLAUDE_TIMEOUT_MS, 20_000),
  };
}

export function createAmuxClaudeClientFromEnv(): AmuxClaudeClient {
  return new AmuxClaudeClient(amuxClaudeClientConfigFromEnv());
}

export function dashScopeAdapterConfigFromEnv(): DashScopeAdapterConfig {
  return {
    apiKey: () => process.env.DASHSCOPE_API_KEY?.trim() || undefined,
    baseUrl:
      process.env.DASHSCOPE_BASE_URL?.trim() ||
      "https://dashscope.aliyuncs.com",
    imageModel: process.env.DASHSCOPE_IMAGE_MODEL?.trim() || "wan2.7-image-pro",
    imageSize: process.env.DASHSCOPE_IMAGE_SIZE?.trim() || "2K",
    imageCostCny: numberFromEnv(process.env.DASHSCOPE_IMAGE_COST_CNY, 0),
    creditsPerCny: numberFromEnv(process.env.AI_CREDITS_PER_CNY, 0),
  };
}

export function aiServiceOptionsFromEnv(): AiServiceOptions {
  const fallbackProvider = process.env.AI_FALLBACK_PROVIDER?.trim();
  return {
    primaryProvider: process.env.AI_PRIMARY_PROVIDER?.trim() || "amux",
    ...(fallbackProvider ? { fallbackProvider } : {}),
    timeoutMs: numberFromEnv(process.env.AI_PROVIDER_TIMEOUT_MS, 600_000),
    retryBaseMs: numberFromEnv(process.env.AI_PROVIDER_RETRY_BASE_MS, 250),
    // BullMQ 已在任务层重试一次，Provider 内不再叠加重试，避免同步生图重复扣费。
    maxRetries: 0,
  };
}

export function createAiProvidersFromEnv(): AiProvider[] {
  const loadReferenceImage = createReferenceImageLoader({
    allowedOrigins: referenceImageOriginsFromEnv(),
  });
  return [
    new AmuxAdapter(amuxAdapterConfigFromEnv(), undefined, loadReferenceImage),
    new DashScopeAdapter(
      dashScopeAdapterConfigFromEnv(),
      undefined,
      loadReferenceImage,
    ),
  ];
}

export function createAiRuntimeFromEnv(): AiRuntimeService {
  return new AiRuntimeService(
    createAiProvidersFromEnv(),
    aiServiceOptionsFromEnv(),
  );
}

function referenceImageOriginsFromEnv(): string[] {
  const configured =
    process.env.AI_REFERENCE_IMAGE_ALLOWED_ORIGINS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  const storageOrigins = [process.env.S3_ENDPOINT, process.env.ASSET_CDN_ORIGIN]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return [...new Set([...configured, ...storageOrigins])];
}
