import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { RateLimit, RateLimitGuard } from "../../security/rate-limit.guard";
import {
  agentIdSchema,
  createAgentConversationSchema,
  attachGenerationTaskSchema,
  listAgentConversationsSchema,
  listAgentMessagesSchema,
  sendAgentMessageSchema,
  updateAgentConversationSchema,
} from "./agent-conversations.schemas";
import { AgentConversationsService } from "./agent-conversations.service";

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: result.error.issues[0]?.message ?? "请求参数无效",
    });
  }
  return result.data;
}

@Controller("projects/:projectId/agent-conversations")
export class ProjectAgentConversationsController {
  constructor(
    @Inject(AgentConversationsService)
    private readonly conversations: AgentConversationsService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.conversations.list(
      user.userId,
      parseOrThrow(agentIdSchema, projectId),
      parseOrThrow(listAgentConversationsSchema, query),
    );
  }

  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit({
    keyBy: "user",
    limit: 30,
    name: "agent-conversation-create",
    windowSeconds: 60 * 60,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.conversations.create(
      user.userId,
      parseOrThrow(agentIdSchema, projectId),
      parseOrThrow(createAgentConversationSchema, body),
    );
  }
}

@Controller("agent-conversations")
export class AgentConversationsController {
  constructor(
    @Inject(AgentConversationsService)
    private readonly conversations: AgentConversationsService,
  ) {}

  @Patch(":id")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    keyBy: "user",
    limit: 120,
    name: "agent-conversation-update",
    windowSeconds: 60 * 60,
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") conversationId: string,
    @Body() body: unknown,
  ) {
    return this.conversations.update(
      user.userId,
      parseOrThrow(agentIdSchema, conversationId),
      parseOrThrow(updateAgentConversationSchema, body),
    );
  }

  @Get(":id/messages")
  messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") conversationId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.conversations.messages(
      user.userId,
      parseOrThrow(agentIdSchema, conversationId),
      parseOrThrow(listAgentMessagesSchema, query),
    );
  }

  @Post(":id/messages")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    keyBy: "user",
    limit: 60,
    name: "agent-message-create",
    windowSeconds: 60 * 60,
  })
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") conversationId: string,
    @Body() body: unknown,
  ) {
    return this.conversations.send(
      user.userId,
      parseOrThrow(agentIdSchema, conversationId),
      parseOrThrow(sendAgentMessageSchema, body),
    );
  }

  @Post(":id/generation-tasks/:taskId")
  attachGenerationTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") conversationId: string,
    @Param("taskId") taskId: string,
    @Body() body: unknown,
  ) {
    return this.conversations.attachGenerationTask(
      user.userId,
      parseOrThrow(agentIdSchema, conversationId),
      parseOrThrow(agentIdSchema, taskId),
      parseOrThrow(attachGenerationTaskSchema, body),
    );
  }
}
