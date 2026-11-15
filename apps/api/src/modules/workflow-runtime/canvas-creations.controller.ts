import { createCanvasCreationSchema, runCanvasCreationSchema, updateCanvasCreationSchema } from "@fashion/shared";
import { Body, Controller, Get, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { parseCanvas } from "../canvas/canvas.controller";
import { RateLimit, RateLimitGuard } from "../../security/rate-limit.guard";
import { CanvasCreationsService } from "./canvas-creations.service";

@Controller("projects/:projectId/canvas/creations")
@UseGuards(RateLimitGuard)
export class CanvasCreationsController {
  constructor(@Inject(CanvasCreationsService) private readonly creations: CanvasCreationsService) {}

  @Get() list(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string) {
    return this.creations.list(user.userId, projectId);
  }

  @Get(":id") read(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string, @Param("id") id: string) {
    return this.creations.read(user.userId, projectId, id);
  }

  @Post() create(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string, @Body() body: unknown) {
    return this.creations.create(user.userId, projectId, parseCanvas(createCanvasCreationSchema, body));
  }

  @Patch(":id") update(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string, @Param("id") id: string, @Body() body: unknown) {
    return this.creations.update(user.userId, projectId, id, parseCanvas(updateCanvasCreationSchema, body));
  }

  @Post(":id/runs")
  @RateLimit({ name: "canvas-creation-runs", limit: 30, windowSeconds: 60, keyBy: "user" })
  run(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string, @Param("id") id: string, @Body() body: unknown) {
    return this.creations.run(user.userId, projectId, id, parseCanvas(runCanvasCreationSchema, body));
  }
}
