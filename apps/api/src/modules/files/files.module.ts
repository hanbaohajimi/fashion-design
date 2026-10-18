import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { FilesController } from "./files.controller";
import {
  FILE_STORAGE,
  FILES_DB,
  FilesService,
  THUMBNAIL_JOBS,
} from "./files.service";
import { S3FileStorage } from "./storage.service";
import { BullThumbnailJobs } from "./thumbnail-queue.service";
import { SecurityModule } from "../../security/security.module";
import { UploadsCleanupService } from "./uploads-cleanup.service";

@Module({
  imports: [SecurityModule],
  controllers: [FilesController],
  providers: [
    FilesService,
    UploadsCleanupService,
    S3FileStorage,
    BullThumbnailJobs,
    { provide: FILES_DB, useValue: prisma },
    { provide: FILE_STORAGE, useExisting: S3FileStorage },
    { provide: THUMBNAIL_JOBS, useExisting: BullThumbnailJobs },
  ],
  exports: [BullThumbnailJobs, S3FileStorage],
})
export class FilesModule {}
