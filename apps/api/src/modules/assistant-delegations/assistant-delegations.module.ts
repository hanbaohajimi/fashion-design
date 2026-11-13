import { Module } from "@nestjs/common";
import { prisma } from "@fashion/db";

import { ProjectAccessModule } from "../studio/project-access.module";
import { WorkflowRuntimeModule } from "../workflow-runtime/workflow-runtime.module";
import { AssistantDelegationsController } from "./assistant-delegations.controller";
import {
  ASSISTANT_DELEGATIONS_DB,
  AssistantDelegationsService,
} from "./assistant-delegations.service";

@Module({
  imports: [ProjectAccessModule, WorkflowRuntimeModule],
  controllers: [AssistantDelegationsController],
  providers: [
    AssistantDelegationsService,
    { provide: ASSISTANT_DELEGATIONS_DB, useValue: prisma },
  ],
})
export class AssistantDelegationsModule {}
