import type { AiProvider, AiServiceOptions } from "@fashion/ai";

export const AI_PROVIDERS = Symbol("AI_PROVIDERS");
export const AI_SERVICE_OPTIONS = Symbol("AI_SERVICE_OPTIONS");
export const FAL_ADAPTER = Symbol("FAL_ADAPTER");

export type AiProviderRegistry = AiProvider[];
export type { AiServiceOptions };
