import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { FilesModule } from "../files/files.module";
import { SecurityModule } from "../../security/security.module";
import { S3FileStorage } from "../files/storage.service";
import { BullThumbnailJobs } from "../files/thumbnail-queue.service";
import { FabricsController } from "./fabrics.controller";
import {
  FABRICS_DB,
  FABRICS_STORAGE,
  FABRICS_THUMBNAIL_JOBS,
  FabricsService,
} from "./fabrics.service";

@Module({
  imports: [FilesModule, SecurityModule],
  controllers: [FabricsController],
  providers: [
    FabricsService,
    { provide: FABRICS_DB, useValue: prisma },
    { provide: FABRICS_STORAGE, useExisting: S3FileStorage },
    { provide: FABRICS_THUMBNAIL_JOBS, useExisting: BullThumbnailJobs },
  ],
  exports: [FabricsService],
})
export class FabricsModule {}
