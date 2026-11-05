import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "../studio/project-access.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { CanvasController } from "./canvas.controller";
import { CANVAS_DB, CanvasService } from "./canvas.service";
@Module({
  imports: [ProjectAccessModule, WorkflowsModule],
  controllers: [CanvasController],
  providers: [CanvasService, { provide: CANVAS_DB, useValue: prisma }],
  exports: [CanvasService],
})
export class CanvasModule {}
