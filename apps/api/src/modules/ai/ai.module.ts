import {
  aiServiceOptionsFromEnv,
  FalAdapter,
  falAdapterConfigFromEnv,
  type AiServiceOptions,
} from "@fashion/ai";
import { Module } from "@nestjs/common";

import { AiService } from "./ai.service";
import {
  AI_PROVIDERS,
  AI_SERVICE_OPTIONS,
  FAL_ADAPTER,
} from "./ai.tokens";

@Module({
  providers: [
    {
      provide: FAL_ADAPTER,
      useFactory: () => new FalAdapter(falAdapterConfigFromEnv()),
    },
    {
      provide: AI_PROVIDERS,
      inject: [FAL_ADAPTER],
      useFactory: (falAdapter: FalAdapter) => [falAdapter],
    },
    {
      provide: AI_SERVICE_OPTIONS,
      useFactory: (): AiServiceOptions => aiServiceOptionsFromEnv(),
    },
    AiService,
  ],
  exports: [AiService],
})
export class AiModule {}
