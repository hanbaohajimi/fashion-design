import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { HealthController } from "./health.controller";
import { AuthGuard } from "./modules/auth/auth.guard";
import { AuthModule } from "./modules/auth/auth.module";
import { BoardElementsModule } from "./modules/board-elements/board-elements.module";
import { BoardsModule } from "./modules/boards/boards.module";
import { FilesModule } from "./modules/files/files.module";
import { ProjectsModule } from "./modules/projects/projects.module";

@Module({
  imports: [
    AuthModule,
    BoardElementsModule,
    BoardsModule,
    FilesModule,
    ProjectsModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
