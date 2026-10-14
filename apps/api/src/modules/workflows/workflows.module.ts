import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { WorkflowsController } from "./workflows.controller";
import { WORKFLOWS_DB, WorkflowsService } from "./workflows.service";

@Module({
  controllers: [WorkflowsController],
  providers: [WorkflowsService, { provide: WORKFLOWS_DB, useValue: prisma }],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
