import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { GenerationModule } from "../generation/generation.module";
import { CollectionsController } from "./collections.controller";
import {
  COLLECTIONS_DB,
  CollectionsService,
  DNA_EXTRACTOR,
} from "./collections.service";
import { OpenAiDnaExtractor } from "./dna-extractor";

@Module({
  imports: [GenerationModule],
  controllers: [CollectionsController],
  providers: [
    CollectionsService,
    OpenAiDnaExtractor,
    { provide: COLLECTIONS_DB, useValue: prisma },
    { provide: DNA_EXTRACTOR, useExisting: OpenAiDnaExtractor },
  ],
})
export class CollectionsModule {}
