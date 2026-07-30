import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";
import { FilesModule } from "../files/files.module";

import { DesignAssetsController } from "./design-assets.controller";
import {
  DESIGN_ASSETS_DB,
  DesignAssetsService,
} from "./design-assets.service";

@Module({
  imports: [FilesModule],
  controllers: [DesignAssetsController],
  providers: [
    DesignAssetsService,
    { provide: DESIGN_ASSETS_DB, useValue: prisma },
  ],
  exports: [DesignAssetsService],
})
export class DesignAssetsModule {}
