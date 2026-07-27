import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
} from "@nestjs/common";
import { z } from "zod";

import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { boardPatchSchema } from "./boards.schemas";
import { BoardsService } from "./boards.service";

const projectIdSchema = z.string().min(1).max(100);

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: result.error.issues[0]?.message ?? "画布请求无效",
    });
  }

  return result.data;
}

@Controller("projects/:projectId/board")
export class BoardsController {
  constructor(private readonly boardsService: BoardsService) {}

  @Get()
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.boardsService.get(
      user.userId,
      parseOrThrow(projectIdSchema, projectId),
    );
  }

  @Patch()
  patch(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.boardsService.patch(
      user.userId,
      parseOrThrow(projectIdSchema, projectId),
      parseOrThrow(boardPatchSchema, body),
    );
  }
}
