import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "../studio/project-access.module";
import { FilesModule } from "../files/files.module";

import { DesignAssetsController } from "./design-assets.controller";
import {
  DESIGN_ASSETS_DB,
  DesignAssetsService,
} from "./design-assets.service";

@Module({
  imports: [FilesModule, ProjectAccessModule],
  controllers: [DesignAssetsController],
  providers: [
    DesignAssetsService,
    { provide: DESIGN_ASSETS_DB, useValue: prisma },
  ],
  exports: [DesignAssetsService],
})
export class DesignAssetsModule {}
