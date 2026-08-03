import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { TrendsController } from "./trends.controller";
import { TRENDS_DB, TrendsService } from "./trends.service";

@Module({
  controllers: [TrendsController],
  providers: [
    TrendsService,
    { provide: TRENDS_DB, useValue: prisma },
  ],
  exports: [TrendsService],
})
export class TrendsModule {}
