import { AiRuntimeService, type AiServiceOptions } from "./ai.service";
import {
  FalAdapter,
  type FalAdapterConfig,
} from "./providers/fal.adapter";

function numberFromEnv(
  value: string | undefined,
  fallback: number,
): number {
  if (!value?.trim()) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function falAdapterConfigFromEnv(): FalAdapterConfig {
  return {
    credentials: () => process.env.FAL_KEY?.trim() || undefined,
    t2iModel: process.env.FAL_T2I_MODEL || "fal-ai/flux/dev",
    i2iModel:
      process.env.FAL_I2I_MODEL || "fal-ai/flux/dev/image-to-image",
    t2iCostPerMegapixel: numberFromEnv(
      process.env.FAL_T2I_COST_PER_MEGAPIXEL,
      0,
    ),
    i2iCostPerMegapixel: numberFromEnv(
      process.env.FAL_I2I_COST_PER_MEGAPIXEL,
      0,
    ),
    creditsPerUsd: numberFromEnv(
      process.env.AI_CREDITS_PER_USD,
      100,
    ),
  };
}

export function aiServiceOptionsFromEnv(): AiServiceOptions {
  const fallbackProvider = process.env.AI_FALLBACK_PROVIDER?.trim();
  return {
    primaryProvider: process.env.AI_PRIMARY_PROVIDER || "fal",
    ...(fallbackProvider ? { fallbackProvider } : {}),
    timeoutMs: numberFromEnv(process.env.AI_PROVIDER_TIMEOUT_MS, 60_000),
    retryBaseMs: numberFromEnv(
      process.env.AI_PROVIDER_RETRY_BASE_MS,
      250,
    ),
    maxRetries: 2,
  };
}

export function createAiRuntimeFromEnv(): AiRuntimeService {
  return new AiRuntimeService(
    [new FalAdapter(falAdapterConfigFromEnv())],
    aiServiceOptionsFromEnv(),
  );
}
