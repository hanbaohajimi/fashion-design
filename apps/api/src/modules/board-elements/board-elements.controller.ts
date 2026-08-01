import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { z } from "zod";

import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import {
  inferRoleSchema,
  projectIdSchema,
  setElementRolesSchema,
  shapeIdSchema,
} from "./board-elements.schemas";
import { BoardElementsService } from "./board-elements.service";

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: result.error.issues[0]?.message ?? "元素角色请求无效",
    });
  }
  return result.data;
}

@Controller("projects/:projectId/board-elements")
export class BoardElementsController {
  constructor(
    @Inject(BoardElementsService)
    private readonly boardElementsService: BoardElementsService,
  ) {}

  @Post(":shapeId/infer")
  infer(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("shapeId") shapeId: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(inferRoleSchema, body);
    return this.boardElementsService.registerInference(
      user.userId,
      parseOrThrow(projectIdSchema, projectId),
      parseOrThrow(shapeIdSchema, shapeId),
      input.fileId,
    );
  }

  @Get(":shapeId/role")
  getRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("shapeId") shapeId: string,
  ) {
    return this.boardElementsService.getRole(
      user.userId,
      parseOrThrow(projectIdSchema, projectId),
      parseOrThrow(shapeIdSchema, shapeId),
    );
  }

  @Patch("roles")
  setRoles(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.boardElementsService.setRoles(
      user.userId,
      parseOrThrow(projectIdSchema, projectId),
      parseOrThrow(setElementRolesSchema, body),
    );
  }
}
