import {
  AiRuntimeService,
  type AiProvider,
  type AiServiceOptions,
} from "@fashion/ai";
import { Inject, Injectable } from "@nestjs/common";

import { AI_PROVIDERS, AI_SERVICE_OPTIONS } from "./ai.tokens";

@Injectable()
export class AiService extends AiRuntimeService {
  constructor(
    @Inject(AI_PROVIDERS) providerRegistry: AiProvider[],
    @Inject(AI_SERVICE_OPTIONS) options: AiServiceOptions,
  ) {
    super(providerRegistry, options);
  }
}
