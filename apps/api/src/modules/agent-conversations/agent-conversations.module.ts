import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { ProjectAccessModule } from "../studio/project-access.module";
import { AiModule } from "../ai/ai.module";
import { AgentRunsModule } from "../agent-runs/agent-runs.module";
import { WorkflowRuntimeModule } from "../workflow-runtime/workflow-runtime.module";
import { FilesModule } from "../files/files.module";
import { GenerationModule } from "../generation/generation.module";
import { SecurityModule } from "../../security/security.module";
import {
  AgentConversationsController,
  ProjectAgentConversationsController,
} from "./agent-conversations.controller";
import {
  AGENT_CONVERSATIONS_DB,
  AgentConversationsService,
} from "./agent-conversations.service";

@Module({
  imports: [
    ProjectAccessModule,
    AiModule,
    FilesModule,
    GenerationModule,
    SecurityModule,
    AgentRunsModule,
    WorkflowRuntimeModule,
  ],
  controllers: [
    AgentConversationsController,
    ProjectAgentConversationsController,
  ],
  providers: [
    AgentConversationsService,
    { provide: AGENT_CONVERSATIONS_DB, useValue: prisma },
  ],
})
export class AgentConversationsModule {}
