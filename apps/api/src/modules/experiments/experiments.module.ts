import { Module } from "@nestjs/common";
import { prisma } from "@fashion/db";
import { StudioModule } from "../studio/studio.module";
import { GenerationModule } from "../generation/generation.module";
import { FilesModule } from "../files/files.module";
import { SecurityModule } from "../../security/security.module";
import { EXPERIMENTS_DB, ExperimentsService } from "./experiments.service";
import { ExperimentsController } from "./experiments.controller";
@Module({
  imports: [StudioModule, GenerationModule, FilesModule, SecurityModule],
  controllers: [ExperimentsController],
  providers: [
    ExperimentsService,
    { provide: EXPERIMENTS_DB, useValue: prisma },
  ],
})
export class ExperimentsModule {}
