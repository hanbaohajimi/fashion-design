import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { promptEnhancementRequestSchema } from "@fashion/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { RateLimit, RateLimitGuard } from "../../security/rate-limit.guard";
import { PromptEnhancementService } from "./prompt-enhancement.service";

@Controller("projects/:projectId/assistant")
@UseGuards(RateLimitGuard)
export class PromptEnhancementController {
  constructor(
    @Inject(PromptEnhancementService)
    private readonly service: PromptEnhancementService,
  ) {}
  @Post("prompt-enhancements")
  @RateLimit({
    keyBy: "user",
    limit: 60,
    name: "prompt-enhancement",
    windowSeconds: 60 * 60,
  })
  enhance(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    const input = promptEnhancementRequestSchema.safeParse(body);
    if (!input.success)
      throw new BadRequestException(
        input.error.issues[0]?.message ?? "增强参数无效",
      );
    return this.service.enhance(user.userId, projectId, input.data);
  }
}
