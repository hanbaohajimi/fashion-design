import type { AiProvider } from "./interfaces/provider.interface";

export const AI_PROVIDERS = Symbol("AI_PROVIDERS");
export const AI_SERVICE_OPTIONS = Symbol("AI_SERVICE_OPTIONS");
export const FAL_ADAPTER = Symbol("FAL_ADAPTER");

export interface AiServiceOptions {
  primaryProvider: string;
  fallbackProvider?: string;
  timeoutMs: number;
  retryBaseMs: number;
  maxRetries: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export type AiProviderRegistry = AiProvider[];
