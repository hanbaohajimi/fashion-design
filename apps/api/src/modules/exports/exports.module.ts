import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { BullExportJobs } from "./export-queue.service";
import { ExportsController } from "./exports.controller";
import {
  EXPORTS_DB,
  EXPORT_JOBS,
  EXPORT_STORAGE,
  ExportsService,
} from "./exports.service";
import { FilesModule } from "../files/files.module";
import { S3FileStorage } from "../files/storage.service";

@Module({
  imports: [FilesModule],
  controllers: [ExportsController],
  providers: [
    ExportsService,
    BullExportJobs,
    { provide: EXPORTS_DB, useValue: prisma },
    { provide: EXPORT_JOBS, useExisting: BullExportJobs },
    { provide: EXPORT_STORAGE, useExisting: S3FileStorage },
  ],
  exports: [EXPORT_JOBS, BullExportJobs],
})
export class ExportsModule {}
