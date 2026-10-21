import { ProjectAccessModule } from "../studio/project-access.module";
import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";
import { SecurityModule } from "../../security/security.module";
import { AiModule } from "../ai/ai.module";
import { FilesModule } from "../files/files.module";
import { GenerationModule } from "../generation/generation.module";
import { DesignAssetsModule } from "../design-assets/design-assets.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { DesignContextModule } from "../design-context/design-context.module";
import { VisualContextModule } from "../design-context/visual-context.module";
import { WorkflowAssistantService } from "./workflow-assistant.service";
import { WorkflowAssistantController } from "./workflow-assistant.controller";
import { WorkflowCoordinator } from "./workflow-coordinator";
import { WorkflowOutboxConsumer } from "./workflow-outbox.consumer";
import { TaskDispatchService } from "./task-dispatch.service";
import { ExportsModule } from "../exports/exports.module";
import { WorkflowRuntimeController } from "./workflow-runtime.controller";
import {
  WORKFLOW_RUNTIME_DB,
  WorkflowRuntimeService,
} from "./workflow-runtime.service";

@Module({
  imports: [ProjectAccessModule,
    AiModule,
    FilesModule,
    GenerationModule,
    DesignAssetsModule,
    SecurityModule,
    WorkflowsModule,
    DesignContextModule,
    VisualContextModule,
    ExportsModule,
  ],
  controllers: [WorkflowRuntimeController, WorkflowAssistantController],
  providers: [
    WorkflowRuntimeService,
    WorkflowAssistantService,
    WorkflowCoordinator,
    WorkflowOutboxConsumer,
    TaskDispatchService,
    { provide: WORKFLOW_RUNTIME_DB, useValue: prisma },
  ],
  exports: [WorkflowAssistantService],
})
export class WorkflowRuntimeModule {}
