import { Module } from "@nestjs/common";
import { prisma } from "@fashion/db";
import { FilesModule } from "../files/files.module";
import { ProjectAccessModule } from "../studio/project-access.module";
import { SecurityModule } from "../../security/security.module";
import { RealtimeTryOnController } from "./realtime-tryon.controller";
import { RealtimeTryOnService } from "./realtime-tryon.service";
import { REALTIME_TRYON_DB, RealtimeTryOnSessionRepository } from "./realtime-tryon-session.repository";
import { DECART_TOKEN_PROVIDER, OfficialDecartTokenProvider } from "./decart-token-provider";
import { WardrobeModule } from "../wardrobe/wardrobe.module";
@Module({
  imports: [FilesModule, ProjectAccessModule, SecurityModule, WardrobeModule],
  controllers: [RealtimeTryOnController],
  providers: [RealtimeTryOnService, RealtimeTryOnSessionRepository, { provide: REALTIME_TRYON_DB, useValue: prisma }, { provide: DECART_TOKEN_PROVIDER, useClass: OfficialDecartTokenProvider }],
})
export class RealtimeTryOnModule {}
