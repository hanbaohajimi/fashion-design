import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";
import { WorkflowsModule } from "../workflows/workflows.module";
import { AiModule } from "../ai/ai.module";
import { DesignContextController } from "./design-context.controller";
import { DESIGN_CONTEXT_DB, DesignContextService } from "./design-context.service";
import { InformationIntegrationService } from "./information-integration.service";
import { HiddenIntentMiner } from "./hidden-intent-miner.service";

@Module({
  imports: [WorkflowsModule, AiModule],
  controllers: [DesignContextController],
  providers: [DesignContextService, InformationIntegrationService, HiddenIntentMiner, { provide: DESIGN_CONTEXT_DB, useValue: prisma }],
  exports: [DesignContextService, InformationIntegrationService, HiddenIntentMiner],
})
export class DesignContextModule {}
