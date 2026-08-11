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
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Sse,
  UseGuards,
  type MessageEvent,
} from "@nestjs/common";
import type { Observable } from "rxjs";

import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { GenerationEventsService } from "./generation-events.service";
import {
  generationCreateRequestSchema,
  generationListQuerySchema,
} from "./generation.schemas";
import { GenerationMaskService } from "./generation-mask.service";
import { z } from "zod";
import {
  GenerationService,
  type GenerationTaskListView,
  type GenerationTaskView,
} from "./generation.service";
import { RateLimit, RateLimitGuard } from "../../security/rate-limit.guard";

const maskChecksumSchema = z
  .string()
  .regex(/^[A-Za-z0-9+/]{43}=$/u)
  .refine((value) => Buffer.from(value, "base64").toString("base64") === value);

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
  @Header("Cache-Control", "private, no-store")
  async signMask(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const parsed = z
      .object({
        checksumSha256: maskChecksumSchema,
        height: z.number().int().min(64).max(2048),
        projectId: z.string().min(1).max(128),
        size: z
          .number()
          .int()
          .positive()
          .max(12 * 1024 * 1024),
        width: z.number().int().min(64).max(2048),
      })
      .safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_MASK",
        message: "掩码尺寸、文件大小或摘要不合法",
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
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<{ task_id: string }> {
    const parsed = generationCreateRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_REQUEST",
        message: "生成参数不合法",
      });
    }
    const parsedKey = z
      .string()
      .trim()
      .min(8)
      .max(200)
      .safeParse(idempotencyKey);
    if (!parsedKey.success) {
      throw new BadRequestException({
        code: "INVALID_IDEMPOTENCY_KEY",
        message: "缺少有效的 Idempotency-Key 请求头",
      });
    }
    const result = await this.generationService.create(
      user.userId,
      parsed.data,
      parsedKey.data,
    );
    return { task_id: result.taskId };
  }

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<GenerationTaskListView> {
    const parsed = generationListQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_REQUEST",
        message: "生成任务查询参数不合法",
      });
    }
    return this.generationService.list(user.userId, parsed.data);
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

  @Patch(":id/candidates/:index")
  async setCandidateDisposition(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") taskId: string,
    @Param("index") rawIndex: string,
    @Body() body: unknown,
  ): Promise<GenerationTaskView> {
    const parsed = z
      .object({
        disposition: z.enum(["adopted", "dismissed"]),
        index: z.coerce.number().int().min(0).max(15),
      })
      .safeParse({
        ...(body && typeof body === "object" ? body : {}),
        index: rawIndex,
      });
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_CANDIDATE_DISPOSITION",
        message: "候选序号或处置状态不合法",
      });
    }
    return this.generationService.setCandidateDisposition(
      user.userId,
      taskId,
      parsed.data.index,
      parsed.data.disposition,
    );
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
