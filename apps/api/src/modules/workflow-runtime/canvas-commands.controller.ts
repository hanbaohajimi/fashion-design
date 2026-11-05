import { canvasCommandSchema } from "@fashion/shared";
import {
  Body,
  Controller,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { RateLimit, RateLimitGuard } from "../../security/rate-limit.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { parseCanvas } from "../canvas/canvas.controller";
import { CanvasCommandService } from "./canvas-command.service";
@Controller("projects/:projectId/canvas/commands")
@UseGuards(RateLimitGuard)
export class CanvasCommandsController {
  constructor(
    @Inject(CanvasCommandService)
    private readonly commands: CanvasCommandService,
  ) {}
  @Post()
  @RateLimit({
    name: "canvas-commands",
    limit: 60,
    windowSeconds: 60,
    keyBy: "user",
  })
  execute(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.commands.execute(
      user.userId,
      projectId,
      parseCanvas(canvasCommandSchema, body),
    );
  }
}
