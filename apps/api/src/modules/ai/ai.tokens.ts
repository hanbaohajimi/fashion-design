import type {
  AiProvider,
  AiServiceOptions,
  AmuxClaudeJsonClient,
} from "@fashion/ai";

export const AI_PROVIDERS = Symbol("AI_PROVIDERS");
export const AI_SERVICE_OPTIONS = Symbol("AI_SERVICE_OPTIONS");
export const AMUX_CLAUDE_CLIENT = Symbol("AMUX_CLAUDE_CLIENT");

export type AiProviderRegistry = AiProvider[];
export type { AmuxClaudeJsonClient };
export type { AiServiceOptions };
