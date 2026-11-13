import { Module } from "@nestjs/common";
import { prisma } from "@fashion/db";

import { ProjectAccessModule } from "../studio/project-access.module";
import { AssistantSkillsController } from "./assistant-skills.controller";
import {
  ASSISTANT_SKILLS_DB,
  AssistantSkillsService,
} from "./assistant-skills.service";

@Module({
  imports: [ProjectAccessModule],
  controllers: [AssistantSkillsController],
  providers: [
    AssistantSkillsService,
    { provide: ASSISTANT_SKILLS_DB, useValue: prisma },
  ],
})
export class AssistantSkillsModule {}

