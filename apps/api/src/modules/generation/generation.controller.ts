import type {
  GenerationTaskEvent,
  GenerationTaskEventStatus,
} from "@fashion/shared";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Sse,
  UseGuards,
  type MessageEvent,
} from "@nestjs/common";
import type { Observable } from "rxjs";

import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { GenerationEventsService } from "./generation-events.service";
import { generationCreateRequestSchema } from "./generation.schemas";
import { GenerationMaskService } from "./generation-mask.service";
import { z } from "zod";
import {
  GenerationService,
  type GenerationTaskView,
} from "./generation.service";
import {
  RateLimit,
  RateLimitGuard,
} from "../../security/rate-limit.guard";

@Controller("generations")
export class GenerationController {
  constructor(
    @Inject(GenerationService)
    private readonly generationService: GenerationService,
    @Inject(GenerationEventsService)
    private readonly events: GenerationEventsService,
    @Inject(GenerationMaskService)
    private readonly masks: GenerationMaskService,
  ) {}

  @Post("masks/sign")
  async signMask(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const parsed = z
      .object({
        height: z.number().int().min(64).max(2048),
        projectId: z.string().min(1).max(128),
        size: z.number().int().positive().max(12 * 1024 * 1024),
        width: z.number().int().min(64).max(2048),
      })
      .safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_MASK",
        message: "掩码尺寸或文件大小不合法",
      });
    }
    return this.masks.sign(user.userId, parsed.data);
  }

  @Post()
  @HttpCode(202)
  @UseGuards(RateLimitGuard)
  @RateLimit({
    keyBy: "user",
    limit: 20,
    name: "generation-create",
    windowSeconds: 60 * 60,
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<{ task_id: string }> {
    const parsed = generationCreateRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_REQUEST",
        message: "生成参数不合法",
      });
    }
    const result = await this.generationService.create(
      user.userId,
      parsed.data,
    );
    return { task_id: result.taskId };
  }

  @Get(":id")
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") taskId: string,
  ): Promise<GenerationTaskView> {
    return this.generationService.get(user.userId, taskId);
  }

  @Delete(":id")
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") taskId: string,
  ): Promise<GenerationTaskView> {
    return this.generationService.cancel(user.userId, taskId);
  }

  @Sse(":id/events")
  async stream(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") taskId: string,
  ): Promise<Observable<MessageEvent>> {
    const task = await this.generationService.get(user.userId, taskId);
    const initial: GenerationTaskEvent = {
      taskId: task.id,
      status: task.status as GenerationTaskEventStatus,
      timestamp: task.updatedAt.toISOString(),
    };
    return this.events.stream(initial);
  }
}
