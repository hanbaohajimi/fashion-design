import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { ProjectAccessModule } from "../studio/project-access.module";
import { FilesModule } from "../files/files.module";
import { VISUAL_CONTEXT_DB, VisualContextService } from "./visual-context.service";
import { BullVisualSummaryJobs } from "./visual-summary-queue.service";

@Module({
  imports: [FilesModule, ProjectAccessModule],
  providers: [VisualContextService, BullVisualSummaryJobs, { provide: VISUAL_CONTEXT_DB, useValue: prisma }],
  exports: [VisualContextService],
})
export class VisualContextModule {}
