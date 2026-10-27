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
  Headers,
  Res,
  Optional,
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
import { AssistantStreamsService } from "./assistant-streams.service";
import { AssistantCancellationService } from "./assistant-cancellation.service";
import type { Response } from "express";

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
    @Optional() @Inject(AssistantStreamsService) private readonly streams?: AssistantStreamsService,
    @Optional() @Inject(AssistantCancellationService) private readonly cancellation?: AssistantCancellationService,
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
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") conversationId: string,
    @Body() body: unknown,
    @Res() response: Response,
    @Headers("accept") accept?: string,
  ) {
    const id = parseOrThrow(agentIdSchema, conversationId);
    const input = parseOrThrow(sendAgentMessageSchema, body);
    if (!this.streams?.enabled(accept)) return response.json(await (this.streams ? this.streams.runCancelable(id, input.clientRequestId, observer => this.conversations.send(user.userId, id, input, observer), () => this.conversations.recoverStream(user.userId, id, input.clientRequestId)) : this.conversations.send(user.userId, id, input)));
    await this.conversations.authorizeStream(user.userId, id, true);
    return this.streams.start(response, id, input.clientRequestId, (observer) => this.conversations.send(user.userId, id, input, observer), () => this.conversations.recoverStream(user.userId, id, input.clientRequestId), JSON.stringify(input));
  }

  @Get(":id/message-streams/:requestId/events")
  async events(@CurrentUser() user: AuthenticatedUser, @Param("id") conversationId: string, @Param("requestId") requestId: string, @Query("after") after: string | undefined, @Res() response: Response) {
    const id = parseOrThrow(agentIdSchema, conversationId); const request = parseOrThrow(agentIdSchema, requestId);
    await this.conversations.authorizeStream(user.userId, id);
    if (!this.streams) return response.json(await this.conversations.recoverStream(user.userId, id, request));
    return this.streams.follow(response, id, request, after, () => this.conversations.recoverStream(user.userId, id, request), () => this.conversations.authorizeStream(user.userId, id));
  }

  @Post(":id/message-streams/:requestId/cancel")
  @UseGuards(RateLimitGuard)
  @RateLimit({ keyBy: "user", limit: 120, name: "assistant-cancel", windowSeconds: 60 })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param("id") conversationId: string, @Param("requestId") requestId: string) {
    if (!this.cancellation) throw new BadRequestException("停止回复暂不可用");
    return this.cancellation.cancel(user.userId, parseOrThrow(agentIdSchema, conversationId), parseOrThrow(agentIdSchema, requestId));
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

  @Get(":id/plans")
  plans(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") conversationId: string,
  ) {
    return this.conversations.plans(
      user.userId,
      parseOrThrow(agentIdSchema, conversationId),
    );
  }

  @Post(":id/plans")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    keyBy: "user",
    limit: 60,
    name: "agent-plan-create",
    windowSeconds: 60 * 60,
  })
  createPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") conversationId: string,
    @Body() body: unknown,
  ) {
    return this.conversations.createPlan(
      user.userId,
      parseOrThrow(agentIdSchema, conversationId),
      parseOrThrow(sendAgentMessageSchema, body),
    );
  }
}
