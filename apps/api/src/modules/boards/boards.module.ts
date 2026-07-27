import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { BoardsController } from "./boards.controller";
import { BOARDS_DB, BoardsService } from "./boards.service";

@Module({
  controllers: [BoardsController],
  providers: [
    BoardsService,
    {
      provide: BOARDS_DB,
      useValue: prisma,
    },
  ],
})
export class BoardsModule {}
