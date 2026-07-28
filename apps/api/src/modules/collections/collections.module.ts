import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { CollectionsController } from "./collections.controller";
import {
  COLLECTIONS_DB,
  CollectionsService,
  DNA_EXTRACTOR,
} from "./collections.service";
import { OpenAiDnaExtractor } from "./dna-extractor";

@Module({
  controllers: [CollectionsController],
  providers: [
    CollectionsService,
    OpenAiDnaExtractor,
    { provide: COLLECTIONS_DB, useValue: prisma },
    { provide: DNA_EXTRACTOR, useExisting: OpenAiDnaExtractor },
  ],
})
export class CollectionsModule {}
