import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { AiModule } from "../ai/ai.module";
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
  imports: [AiModule, FilesModule, GenerationModule, SecurityModule],
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
