import { BadRequestException, Body, Controller, Get, Header, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { RateLimit, RateLimitGuard } from "../../security/rate-limit.guard";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { WorkflowAssistantService, workflowContextCorrectionSchema, workflowMessageSchema } from "./workflow-assistant.service";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? "请求参数无效");
  return parsed.data;
}
const id = z.string().trim().min(1).max(128);

@Controller("agent-conversations/:id")
@UseGuards(RateLimitGuard)
@RateLimit({ keyBy: "user", limit: 120, name: "workflow-assistant", windowSeconds: 60 })
export class WorkflowAssistantController {
  constructor(@Inject(WorkflowAssistantService) private readonly assistant: WorkflowAssistantService) {}

  @Get("context")
  @Header("Cache-Control", "private, no-store")
  context(@CurrentUser() user: AuthenticatedUser, @Param("id") conversationId: string) {
    return this.assistant.getContext(user.userId, parse(id, conversationId));
  }

  @Get("plan")
  @Header("Cache-Control", "private, no-store")
  plan(@CurrentUser() user: AuthenticatedUser, @Param("id") conversationId: string) {
    return this.assistant.currentPlan(user.userId, parse(id, conversationId));
  }

  @Patch("context")
  correct(@CurrentUser() user: AuthenticatedUser, @Param("id") conversationId: string, @Body() body: unknown) {
    return this.assistant.correctContext(user.userId, parse(id, conversationId), parse(workflowContextCorrectionSchema, body));
  }

  @Post("workflow-messages")
  @RateLimit({ keyBy: "user", limit: 60, name: "workflow-assistant-turn", windowSeconds: 60 * 60 })
  send(@CurrentUser() user: AuthenticatedUser, @Param("id") conversationId: string, @Body() body: unknown) {
    return this.assistant.send(user.userId, parse(id, conversationId), parse(workflowMessageSchema, body));
  }
}
