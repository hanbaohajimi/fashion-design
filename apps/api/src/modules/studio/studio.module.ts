import { Module } from "@nestjs/common";
import { FilesModule } from "../files/files.module";
import { StudioController } from "./studio.controller";
import { StudioService } from "./studio.service";
import { ProjectAccessModule } from "./project-access.module";

@Module({
  imports: [FilesModule, ProjectAccessModule],
  controllers: [StudioController],
  providers: [StudioService],
  exports: [StudioService, ProjectAccessModule],
})
export class StudioModule {}
