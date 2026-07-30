import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { SecurityModule } from "../../security/security.module";
import { GenerationModule } from "../generation/generation.module";
import { FilesModule } from "../files/files.module";
import { CollectionsController } from "./collections.controller";
import {
  COLLECTIONS_DB,
  CollectionsService,
  DNA_EXTRACTOR,
} from "./collections.service";
import { OpenAiDnaExtractor } from "./dna-extractor";

@Module({
  imports: [FilesModule, GenerationModule, SecurityModule],
  controllers: [CollectionsController],
  providers: [
    CollectionsService,
    OpenAiDnaExtractor,
    { provide: COLLECTIONS_DB, useValue: prisma },
    { provide: DNA_EXTRACTOR, useExisting: OpenAiDnaExtractor },
  ],
})
export class CollectionsModule {}
