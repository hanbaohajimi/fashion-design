import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { RateLimit, RateLimitGuard } from "../../security/rate-limit.guard";
import { agentIdSchema } from "../agent-conversations/agent-conversations.schemas";
import {
  agentRunRevisionSchema,
  reviewAgentRunSchema,
  updateAgentRunStepSchema,
} from "./agent-runs.schemas";
import { AgentRunsService } from "./agent-runs.service";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: result.error.issues[0]?.message ?? "请求参数无效",
    });
  return result.data;
}

@Controller("agent-runs")
@UseGuards(RateLimitGuard)
@RateLimit({
  keyBy: "user",
  limit: 120,
  name: "agent-run-control",
  windowSeconds: 60,
})
export class AgentRunsController {
  constructor(
    @Inject(AgentRunsService) private readonly runs: AgentRunsService,
  ) {}

  @Get(":id")
  @Header("Cache-Control", "private, no-store")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.runs.get(user.userId, parse(agentIdSchema, id));
  }

  @Patch(":id/steps/:stepId")
  updateStep(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("stepId") stepId: string,
    @Body() body: unknown,
  ) {
    return this.runs.updateStep(
      user.userId,
      parse(agentIdSchema, id),
      parse(agentIdSchema, stepId),
      parse(updateAgentRunStepSchema, body),
    );
  }

  @Post(":id/execute")
  execute(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.runs.execute(
      user.userId,
      parse(agentIdSchema, id),
      parse(agentRunRevisionSchema, body).revision,
    );
  }

  @Post(":id/review")
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.runs.review(
      user.userId,
      parse(agentIdSchema, id),
      parse(reviewAgentRunSchema, body),
    );
  }

  @Post(":id/pause")
  pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.runs.pause(
      user.userId,
      parse(agentIdSchema, id),
      parse(agentRunRevisionSchema, body).revision,
    );
  }

  @Post(":id/cancel")
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.runs.cancel(
      user.userId,
      parse(agentIdSchema, id),
      parse(agentRunRevisionSchema, body).revision,
    );
  }
}
