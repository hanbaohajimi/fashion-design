import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";
import { GenerationModule } from "../generation/generation.module";
import { SecurityModule } from "../../security/security.module";
import { AgentRunsController } from "./agent-runs.controller";
import { AGENT_RUNS_DB, AgentRunsService } from "./agent-runs.service";

@Module({
  imports: [GenerationModule, SecurityModule],
  controllers: [AgentRunsController],
  providers: [AgentRunsService, { provide: AGENT_RUNS_DB, useValue: prisma }],
  exports: [AgentRunsService],
})
export class AgentRunsModule {}
