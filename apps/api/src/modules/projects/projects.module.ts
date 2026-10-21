import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { ProjectAccessModule } from "../studio/project-access.module";

import { ProjectsController } from "./projects.controller";
import {
  PROJECTS_DB,
  ProjectsService,
} from "./projects.service";

@Module({
  imports: [ProjectAccessModule],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    {
      provide: PROJECTS_DB,
      useValue: prisma,
    },
  ],
})
export class ProjectsModule {}
