import { Module } from "@nestjs/common";
import { prisma } from "@fashion/db";
import { FilesModule } from "../files/files.module";
import { GenerationModule } from "../generation/generation.module";
import { ProjectAccessModule } from "../studio/project-access.module";
import { WardrobeController } from "./wardrobe.controller";
import { WARDROBE_DB, WardrobeService } from "./wardrobe.service";

@Module({
  imports: [FilesModule, GenerationModule, ProjectAccessModule],
  controllers: [WardrobeController],
  providers: [WardrobeService, { provide: WARDROBE_DB, useValue: prisma }],
  exports: [WardrobeService],
})
export class WardrobeModule {}
