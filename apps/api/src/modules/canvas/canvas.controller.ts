import { canvasSaveSchema } from "@fashion/shared";
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
import { CanvasService } from "./canvas.service";

export function parseCanvas<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: result.error.issues[0]?.message ?? "白板请求无效",
    });
  return result.data;
}
@Controller("projects/:projectId/canvas")
export class CanvasController {
  constructor(@Inject(CanvasService) private readonly canvas: CanvasService) {}
  @Get() read(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.canvas.read(user.userId, projectId);
  }
  @Post("initialize") initialize(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.canvas.initialize(user.userId, projectId);
  }
  @Patch() save(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.canvas.save(
      user.userId,
      projectId,
      parseCanvas(canvasSaveSchema, body),
    );
  }
  @Patch("mode") mode(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.canvas.setMode(
      user.userId,
      projectId,
      parseCanvas(z.object({ mode: z.enum(["canvas", "node"]) }).strict(), body)
        .mode,
    );
  }
}
