import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";
import { SecurityModule } from "../../security/security.module";
import { AiModule } from "../ai/ai.module";
import { FilesModule } from "../files/files.module";
import { GenerationModule } from "../generation/generation.module";
import { DesignAssetsModule } from "../design-assets/design-assets.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { WorkflowRuntimeController } from "./workflow-runtime.controller";
import {
  WORKFLOW_RUNTIME_DB,
  WorkflowRuntimeService,
} from "./workflow-runtime.service";

@Module({
  imports: [
    AiModule,
    FilesModule,
    GenerationModule,
    DesignAssetsModule,
    SecurityModule,
    WorkflowsModule,
  ],
  controllers: [WorkflowRuntimeController],
  providers: [
    WorkflowRuntimeService,
    { provide: WORKFLOW_RUNTIME_DB, useValue: prisma },
  ],
})
export class WorkflowRuntimeModule {}
