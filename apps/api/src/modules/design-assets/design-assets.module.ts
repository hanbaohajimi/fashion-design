import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { DesignAssetsController } from "./design-assets.controller";
import {
  DESIGN_ASSETS_DB,
  DesignAssetsService,
} from "./design-assets.service";

@Module({
  controllers: [DesignAssetsController],
  providers: [
    DesignAssetsService,
    { provide: DESIGN_ASSETS_DB, useValue: prisma },
  ],
  exports: [DesignAssetsService],
})
export class DesignAssetsModule {}
