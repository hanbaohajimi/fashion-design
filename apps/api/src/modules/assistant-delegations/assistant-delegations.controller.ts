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
  Patch,
  Post,
} from "@nestjs/common";
import { z } from "zod";

import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import {
  assistantDelegationInputSchema,
  assistantDelegationStateSchema,
} from "@fashion/shared";
import { AssistantDelegationsService } from "./assistant-delegations.service";

const idSchema = z.string().trim().min(1).max(128);

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: "INVALID_ASSISTANT_DELEGATION",
      message: parsed.error.issues[0]?.message ?? "设计委托参数无效",
    });
  }
  return parsed.data;
}

@Controller()
export class AssistantDelegationsController {
  constructor(@Inject(AssistantDelegationsService) private readonly service: AssistantDelegationsService) {}

  @Get("projects/:projectId/assistant-delegations")
  @Header("Cache-Control", "private, no-store")
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.service.list(user.userId, parseOrThrow(idSchema, projectId));
  }

  @Post("projects/:projectId/assistant-delegations")
  @Header("Cache-Control", "private, no-store")
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Headers("idempotency-key") requestKey: string | undefined,
    @Body() body: unknown,
  ) {
    const key = parseOrThrow(z.string().trim().min(8).max(200), requestKey);
    return this.service.create(
      user.userId,
      parseOrThrow(idSchema, projectId),
      parseOrThrow(assistantDelegationInputSchema, body),
      key,
    );
  }

  @Patch("assistant-delegations/:id")
  @Header("Cache-Control", "private, no-store")
  updateState(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateState(
      user.userId,
      parseOrThrow(idSchema, id),
      parseOrThrow(assistantDelegationStateSchema, body).status,
    );
  }

  @Post("assistant-delegations/:id/run")
  @Header("Cache-Control", "private, no-store")
  runNow(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.runNow(user.userId, parseOrThrow(idSchema, id));
  }

  @Delete("assistant-delegations/:id")
  @Header("Cache-Control", "private, no-store")
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.remove(user.userId, parseOrThrow(idSchema, id));
  }
}
