import { Module } from "@nestjs/common";

import { AiModule } from "../ai/ai.module";
import { BillingModule } from "../billing/billing.module";
import { GenerationService } from "./generation.service";

@Module({
  imports: [AiModule, BillingModule],
  providers: [GenerationService],
  exports: [GenerationService],
})
export class GenerationModule {}
