import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { ProjectsController } from "./projects.controller";
import {
  PROJECTS_DB,
  ProjectsService,
} from "./projects.service";

@Module({
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
