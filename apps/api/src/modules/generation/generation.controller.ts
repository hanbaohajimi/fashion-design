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
  type MessageEvent,
} from "@nestjs/common";
import type { Observable } from "rxjs";

import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { GenerationEventsService } from "./generation-events.service";
import { generationCreateRequestSchema } from "./generation.schemas";
import {
  GenerationService,
  type GenerationTaskView,
} from "./generation.service";

@Controller("generations")
export class GenerationController {
  constructor(
    @Inject(GenerationService)
    private readonly generationService: GenerationService,
    @Inject(GenerationEventsService)
    private readonly events: GenerationEventsService,
  ) {}

  @Post()
  @HttpCode(202)
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
