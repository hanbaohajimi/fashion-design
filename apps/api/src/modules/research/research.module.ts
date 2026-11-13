import { Module } from "@nestjs/common";

import { ProjectAccessModule } from "../studio/project-access.module";
import { SecurityModule } from "../../security/security.module";
import { AiModule } from "../ai/ai.module";
import { ResearchController } from "./research.controller";
import { ResearchService } from "./research.service";

@Module({
  imports: [ProjectAccessModule, SecurityModule, AiModule],
  controllers: [ResearchController],
  providers: [ResearchService],
})
export class ResearchModule {}
