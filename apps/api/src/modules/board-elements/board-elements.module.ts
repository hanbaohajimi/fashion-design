import { prisma } from "@fashion/db";
import { Module } from "@nestjs/common";

import { BoardElementsController } from "./board-elements.controller";
import {
  BOARD_ELEMENTS_DB,
  BoardElementsService,
  VLM_INFERENCE_JOBS,
} from "./board-elements.service";
import { BullVlmInferenceJobs } from "./vlm-inference-queue.service";

@Module({
  controllers: [BoardElementsController],
  providers: [
    BoardElementsService,
    BullVlmInferenceJobs,
    { provide: BOARD_ELEMENTS_DB, useValue: prisma },
    { provide: VLM_INFERENCE_JOBS, useExisting: BullVlmInferenceJobs },
  ],
})
export class BoardElementsModule {}
