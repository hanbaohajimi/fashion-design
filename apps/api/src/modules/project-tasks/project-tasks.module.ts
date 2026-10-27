import { Module } from "@nestjs/common";
import { prisma } from "@fashion/db";
import { ProjectAccessModule } from "../studio/project-access.module";
import { ProjectTasksController } from "./project-tasks.controller";
import { PROJECT_TASKS_DB, ProjectTasksService } from "./project-tasks.service";

@Module({ imports: [ProjectAccessModule], controllers: [ProjectTasksController], providers: [ProjectTasksService, { provide: PROJECT_TASKS_DB, useValue: prisma }] })
export class ProjectTasksModule {}
