import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "../studio/project-access.module";
import { FilesModule } from "../files/files.module";
import { AiModule } from "../ai/ai.module";
import { SecurityModule } from "../../security/security.module";
import { ImageTextService } from "./image-text.service";
import { ImageTextController } from "./image-text.controller";

import { DesignAssetsController } from "./design-assets.controller";
import { ImageWorkspaceController, ImageShareController } from "./image-workspace.controller";
import { ImageWorkspaceService } from "./image-workspace.service";
import {
  DESIGN_ASSETS_DB,
  DesignAssetsService,
} from "./design-assets.service";

@Module({
  imports: [FilesModule, ProjectAccessModule, AiModule, SecurityModule],
  controllers: [DesignAssetsController, ImageWorkspaceController, ImageShareController, ImageTextController],
  providers: [
    DesignAssetsService,
    ImageWorkspaceService,
    ImageTextService,
    { provide: DESIGN_ASSETS_DB, useValue: prisma },
  ],
  exports: [DesignAssetsService, ImageWorkspaceService],
})
export class DesignAssetsModule {}
