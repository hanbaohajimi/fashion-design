import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { FilesModule } from "../files/files.module";
import { BoardImportsController, BoardsController } from "./boards.controller";
import { BOARDS_DB, BoardsService } from "./boards.service";

@Module({
  imports: [FilesModule],
  controllers: [BoardsController, BoardImportsController],
  providers: [
    BoardsService,
    {
      provide: BOARDS_DB,
      useValue: prisma,
    },
  ],
})
export class BoardsModule {}
