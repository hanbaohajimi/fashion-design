import { Module } from "@nestjs/common";
import { prisma } from "@fashion/db";

import { ProjectAccessModule } from "../studio/project-access.module";
import { FilesModule } from "../files/files.module";
import { SecurityModule } from "../../security/security.module";
import { PublicStudioSharesController, StudioSharesController } from "./studio-shares.controller";
import { STUDIO_SHARES_DB, StudioSharesService } from "./studio-shares.service";

@Module({
  imports: [ProjectAccessModule, FilesModule, SecurityModule],
  controllers: [StudioSharesController, PublicStudioSharesController],
  providers: [StudioSharesService, { provide: STUDIO_SHARES_DB, useValue: prisma }],
})
export class StudioSharesModule {}

