import { StudioModule } from "./modules/studio/studio.module";
import { RunwayModule } from "./modules/runway/runway.module";
import { ExperimentsModule } from "./modules/experiments/experiments.module";
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { SentryGlobalFilter, SentryModule } from "@sentry/nestjs/setup";

import {
  HEALTH_DEPENDENCY_CHECKER,
  HealthController,
  InfrastructureHealthChecker,
} from "./health.controller";
import { AiModule } from "./modules/ai/ai.module";
import { AgentConversationsModule } from "./modules/agent-conversations/agent-conversations.module";
import { AuthGuard } from "./modules/auth/auth.guard";
import { OriginGuard } from "./security/origin.guard";
import { AuthModule } from "./modules/auth/auth.module";
import { BillingModule } from "./modules/billing/billing.module";
import { BoardElementsModule } from "./modules/board-elements/board-elements.module";
import { BoardsModule } from "./modules/boards/boards.module";
import { CollectionsModule } from "./modules/collections/collections.module";
import { DesignAssetsModule } from "./modules/design-assets/design-assets.module";
import { ExportsModule } from "./modules/exports/exports.module";
import { FabricsModule } from "./modules/fabrics/fabrics.module";
import { FilesModule } from "./modules/files/files.module";
import { GenerationModule } from "./modules/generation/generation.module";
import { ProjectsModule } from "./modules/projects/projects.module";
import { TrendsModule } from "./modules/trends/trends.module";
import { WorkflowsModule } from "./modules/workflows/workflows.module";
import { WorkflowRuntimeModule } from "./modules/workflow-runtime/workflow-runtime.module";
import { SecurityModule } from "./security/security.module";
import { SlowApiInterceptor } from "./observability/slow-api.interceptor";

@Module({
  imports: [
    SentryModule.forRoot(),
    StudioModule,
    RunwayModule,
    ExperimentsModule,
    SecurityModule,
    AiModule,
    AgentConversationsModule,
    AuthModule,
    BillingModule,
    BoardElementsModule,
    BoardsModule,
    CollectionsModule,
    DesignAssetsModule,
    ExportsModule,
    FabricsModule,
    FilesModule,
    GenerationModule,
    ProjectsModule,
    TrendsModule,
    WorkflowsModule,
    WorkflowRuntimeModule,
  ],
  controllers: [HealthController],
  providers: [
    InfrastructureHealthChecker,
    {
      provide: HEALTH_DEPENDENCY_CHECKER,
      useExisting: InfrastructureHealthChecker,
    },
    {
      provide: APP_GUARD,
      useClass: OriginGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: SlowApiInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
  ],
})
export class AppModule {}
