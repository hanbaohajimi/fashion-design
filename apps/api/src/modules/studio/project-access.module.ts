import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";
import { ProjectAccessPolicy, STUDIO_DB } from "./project-access.policy";

@Module({
  providers: [ProjectAccessPolicy, { provide: STUDIO_DB, useValue: prisma }],
  exports: [ProjectAccessPolicy, STUDIO_DB],
})
export class ProjectAccessModule {}
