import { ProjectAccessModule } from "../studio/project-access.module";
import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { SecurityModule } from "../../security/security.module";
import { AiModule } from "../ai/ai.module";
import { GenerationModule } from "../generation/generation.module";
import { FilesModule } from "../files/files.module";
import { CollectionsController } from "./collections.controller";
import {
  COLLECTIONS_DB,
  CollectionsService,
  DNA_EXTRACTOR,
} from "./collections.service";
import { AmuxClaudeDnaExtractor } from "./dna-extractor";

@Module({
  imports: [ProjectAccessModule, AiModule, FilesModule, GenerationModule, SecurityModule],
  controllers: [CollectionsController],
  providers: [
    CollectionsService,
    AmuxClaudeDnaExtractor,
    { provide: COLLECTIONS_DB, useValue: prisma },
    { provide: DNA_EXTRACTOR, useExisting: AmuxClaudeDnaExtractor },
  ],
})
export class CollectionsModule {}
