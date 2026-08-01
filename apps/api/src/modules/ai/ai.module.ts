import {
  aiServiceOptionsFromEnv,
  createAmuxClaudeClientFromEnv,
  createAiProvidersFromEnv,
  type AiServiceOptions,
} from "@fashion/ai";
import { Module } from "@nestjs/common";

import { AiService } from "./ai.service";
import {
  AI_PROVIDERS,
  AI_SERVICE_OPTIONS,
  AMUX_CLAUDE_CLIENT,
} from "./ai.tokens";

@Module({
  providers: [
    {
      provide: AI_PROVIDERS,
      useFactory: createAiProvidersFromEnv,
    },
    {
      provide: AI_SERVICE_OPTIONS,
      useFactory: (): AiServiceOptions => aiServiceOptionsFromEnv(),
    },
    {
      provide: AMUX_CLAUDE_CLIENT,
      useFactory: createAmuxClaudeClientFromEnv,
    },
    AiService,
  ],
  exports: [AiService, AMUX_CLAUDE_CLIENT],
})
export class AiModule {}
