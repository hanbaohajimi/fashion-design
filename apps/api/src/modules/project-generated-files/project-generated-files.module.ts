import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "../studio/project-access.module";
import { S3FileStorage } from "../files/storage.service";
import { ProjectGeneratedFilesController } from "./project-generated-files.controller";
import { PROJECT_GENERATED_FILES_DB, ProjectGeneratedFilesService } from "./project-generated-files.service";

@Module({ imports: [ProjectAccessModule], controllers: [ProjectGeneratedFilesController], providers: [ProjectGeneratedFilesService, S3FileStorage, { provide: PROJECT_GENERATED_FILES_DB, useValue: prisma }] })
export class ProjectGeneratedFilesModule {}
