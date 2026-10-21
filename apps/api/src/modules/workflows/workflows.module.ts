import { ProjectAccessModule } from "../studio/project-access.module";
import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { WorkflowsController } from "./workflows.controller";
import { WORKFLOWS_DB, WorkflowsService } from "./workflows.service";

@Module({
  imports: [ProjectAccessModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, { provide: WORKFLOWS_DB, useValue: prisma }],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
