import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "../studio/project-access.module";
import { S3FileStorage } from "../files/storage.service";
import { AssetLibraryController } from "./asset-library.controller";
import { ASSET_LIBRARY_DB, AssetLibraryService } from "./asset-library.service";

@Module({
  imports: [ProjectAccessModule],
  controllers: [AssetLibraryController],
  providers: [
    AssetLibraryService,
    S3FileStorage,
    { provide: ASSET_LIBRARY_DB, useValue: prisma },
  ],
})
export class AssetLibraryModule {}
