import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "../studio/project-access.module";
import { RunwayController } from "./runway.controller";
import { RunwayService, RUNWAY_DB } from "./runway.service";
import { RunwayStorage } from "./runway-storage.service";

@Module({
  imports: [ProjectAccessModule],
  controllers: [RunwayController],
  providers: [
    RunwayService,
    RunwayStorage,
    { provide: RUNWAY_DB, useValue: prisma },
  ],
  exports: [RunwayService],
})
export class RunwayModule {}
