import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "../studio/project-access.module";
import { FilesModule } from "../files/files.module";

import { DesignAssetsController } from "./design-assets.controller";
import { ImageWorkspaceController, ImageShareController } from "./image-workspace.controller";
import { ImageWorkspaceService } from "./image-workspace.service";
import {
  DESIGN_ASSETS_DB,
  DesignAssetsService,
} from "./design-assets.service";

@Module({
  imports: [FilesModule, ProjectAccessModule],
  controllers: [DesignAssetsController, ImageWorkspaceController, ImageShareController],
  providers: [
    DesignAssetsService,
    ImageWorkspaceService,
    { provide: DESIGN_ASSETS_DB, useValue: prisma },
  ],
  exports: [DesignAssetsService, ImageWorkspaceService],
})
export class DesignAssetsModule {}
