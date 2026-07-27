import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { BillingModule } from "../billing/billing.module";
import { GenerationEventsService } from "./generation-events.service";
import { BullGenerationJobs } from "./generation-queue.service";
import { GenerationController } from "./generation.controller";
import {
  GENERATION_DB,
  GENERATION_JOBS,
  GenerationService,
} from "./generation.service";

@Module({
  imports: [BillingModule],
  controllers: [GenerationController],
  providers: [
    GenerationEventsService,
    GenerationService,
    BullGenerationJobs,
    { provide: GENERATION_DB, useValue: prisma },
    { provide: GENERATION_JOBS, useExisting: BullGenerationJobs },
  ],
  exports: [GenerationService],
})
export class GenerationModule {}
