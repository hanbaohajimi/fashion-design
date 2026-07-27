import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { BillingModule } from "../billing/billing.module";
import {
  COMPILER_DB,
  CONTEXT_MODEL,
  ContextCompilerService,
} from "./compiler/context-compiler.service";
import { OpenAiContextModelGateway } from "./compiler/openai-context-model.gateway";
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
    ContextCompilerService,
    OpenAiContextModelGateway,
    BullGenerationJobs,
    { provide: GENERATION_DB, useValue: prisma },
    { provide: COMPILER_DB, useValue: prisma },
    {
      provide: CONTEXT_MODEL,
      useExisting: OpenAiContextModelGateway,
    },
    { provide: GENERATION_JOBS, useExisting: BullGenerationJobs },
  ],
  exports: [GenerationService],
})
export class GenerationModule {}
