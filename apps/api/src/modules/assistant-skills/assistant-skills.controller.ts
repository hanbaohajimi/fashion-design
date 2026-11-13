import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  Inject,
  Param,
  Post,
} from "@nestjs/common";
import { z } from "zod";

import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { createAssistantSkillSchema } from "./assistant-skills.schemas";
import { AssistantSkillsService } from "./assistant-skills.service";

@Controller("projects/:projectId/assistant-skills")
export class AssistantSkillsController {
  constructor(@Inject(AssistantSkillsService) private readonly service: AssistantSkillsService) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.service.list(user.userId, projectId);
  }

  @Post()
  @Header("Cache-Control", "private, no-store")
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const parsed = createAssistantSkillSchema.safeParse(body);
    const key = z.string().trim().min(8).max(200).safeParse(idempotencyKey);
    if (!parsed.success || !key.success)
      throw new BadRequestException({
        code: "INVALID_ASSISTANT_SKILL",
        message: parsed.success
          ? "缺少有效的请求编号"
          : parsed.error.issues[0]?.message,
      });
    return this.service.create(user.userId, projectId, parsed.data, key.data);
  }

  @Delete(":id")
  @Header("Cache-Control", "private, no-store")
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("id") skillId: string,
  ) {
    return this.service.remove(user.userId, projectId, skillId);
  }
}

