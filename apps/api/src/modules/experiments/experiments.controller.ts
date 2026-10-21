import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  DESIGN_CAPABILITIES,
  experimentActionSchema,
  experimentCreateSchema,
} from "@fashion/shared";
import { z } from "zod";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { RateLimit, RateLimitGuard } from "../../security/rate-limit.guard";
import { ExperimentsService } from "./experiments.service";
@Controller("projects/:projectId/experiments")
export class ExperimentsController {
  constructor(
    @Inject(ExperimentsService) private readonly service: ExperimentsService,
  ) {}
  @Get()
  @Header("Cache-Control", "private, no-store")
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.service.list(user.userId, projectId);
  }
  @Get("capabilities")
  capabilities() {
    return DESIGN_CAPABILITIES;
  }
  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: unknown,
  ) {
    const input = experimentCreateSchema.safeParse(body);
    const requestKey = z.string().min(8).max(200).safeParse(key);
    if (!input.success || !requestKey.success)
      throw new BadRequestException({
        code: "INVALID_EXPERIMENT",
        message: input.success
          ? "缺少有效请求编号"
          : input.error.issues[0]?.message,
      });
    return this.service.create(
      user.userId,
      projectId,
      input.data,
      requestKey.data,
    );
  }
  @Post(":id/actions")
  @HttpCode(202)
  @UseGuards(RateLimitGuard)
  @RateLimit({
    keyBy: "user",
    limit: 20,
    name: "experiment-dispatch",
    windowSeconds: 60 * 60,
  })
  act(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = experimentActionSchema.safeParse(body);
    if (!input.success) throw new BadRequestException("实验操作参数无效");
    return this.service.act(
      user.userId,
      projectId,
      id,
      input.data.itemIds,
      input.data.action,
    );
  }
}
