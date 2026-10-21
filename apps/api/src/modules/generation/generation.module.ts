import { ProjectAccessModule } from "../studio/project-access.module";
import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { SecurityModule } from "../../security/security.module";
import { AiModule } from "../ai/ai.module";
import { BillingModule } from "../billing/billing.module";
import { FilesModule } from "../files/files.module";
import {
  COMPILER_DB,
  CONTEXT_MODEL,
  ContextCompilerService,
} from "./compiler/context-compiler.service";
import { AmuxClaudeContextModelGateway } from "./compiler/amux-claude-context-model.gateway";
import { GenerationEventsService } from "./generation-events.service";
import { BullGenerationJobs } from "./generation-queue.service";
import { GenerationController } from "./generation.controller";
import {
  GENERATION_DB,
  GENERATION_JOBS,
  GenerationService,
} from "./generation.service";
import {
  GENERATION_MASK_DB,
  GenerationMaskService,
} from "./generation-mask.service";

@Module({
  imports: [ProjectAccessModule, AiModule, BillingModule, FilesModule, SecurityModule],
  controllers: [GenerationController],
  providers: [
    GenerationEventsService,
    GenerationService,
    GenerationMaskService,
    ContextCompilerService,
    AmuxClaudeContextModelGateway,
    BullGenerationJobs,
    { provide: GENERATION_DB, useValue: prisma },
    { provide: GENERATION_MASK_DB, useValue: prisma },
    { provide: COMPILER_DB, useValue: prisma },
    {
      provide: CONTEXT_MODEL,
      useExisting: AmuxClaudeContextModelGateway,
    },
    { provide: GENERATION_JOBS, useExisting: BullGenerationJobs },
  ],
  exports: [GenerationService, ContextCompilerService, GENERATION_JOBS, BullGenerationJobs],
})
export class GenerationModule {}
