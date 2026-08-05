import {
  AgentMessageRole,
  AgentMessageStatus,
  FileStatus,
  Prisma,
  type PrismaClient,
} from "@fashion/db";
import type {
  AgentConversationSummary,
  AgentMessageContext,
  AgentMessageView,
} from "@fashion/shared";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";

import { AMUX_CLAUDE_CLIENT, type AmuxClaudeJsonClient } from "../ai/ai.tokens";
import { S3FileStorage } from "../files/storage.service";
import { GenerationService } from "../generation/generation.service";
import type {
  CreateAgentConversationInput,
  ListAgentConversationsInput,
  ListAgentMessagesInput,
  SendAgentMessageInput,
  UpdateAgentConversationInput,
} from "./agent-conversations.schemas";

export const AGENT_CONVERSATIONS_DB = Symbol("AGENT_CONVERSATIONS_DB");

const DEFAULT_TITLE = "新的设计对话";
const HISTORY_LIMIT = 20;
const AGENT_IMAGE_LIMIT = 5;

type AgentDatabase = Pick<
  PrismaClient,
  | "$transaction"
  | "agentConversation"
  | "agentMessage"
  | "boardElement"
  | "fileAsset"
  | "project"
>;

const agentDecisionSchema = z
  .object({
    action: z.enum(["reply", "generate"]),
    generation: z
      .object({
        background: z.enum(["auto", "opaque"]),
        height: z.union([z.literal(768), z.literal(1024)]),
        negativePrompt: z.string().max(3_000),
        outputFormat: z.enum(["jpeg", "png", "webp"]),
        prompt: z.string().trim().min(1).max(4_000),
        quality: z.enum(["auto", "low", "medium", "high"]),
        width: z.union([z.literal(768), z.literal(1024)]),
      })
      .nullable(),
    message: z.string().trim().min(1).max(2_000),
  })
  .refine(
    (value) => value.action === "reply" || value.generation !== null,
    "生成动作必须提供生成参数",
  );

const agentDecisionJsonSchema = {
  additionalProperties: false,
  properties: {
    action: { enum: ["reply", "generate"], type: "string" },
    generation: {
      anyOf: [
        { type: "null" },
        {
          additionalProperties: false,
          properties: {
            background: { enum: ["auto", "opaque"], type: "string" },
            height: { enum: [768, 1024], type: "integer" },
            negativePrompt: { maxLength: 3000, type: "string" },
            outputFormat: {
              enum: ["jpeg", "png", "webp"],
              type: "string",
            },
            prompt: { maxLength: 4000, minLength: 1, type: "string" },
            quality: {
              enum: ["auto", "low", "medium", "high"],
              type: "string",
            },
            width: { enum: [768, 1024], type: "integer" },
          },
          required: [
            "background",
            "height",
            "negativePrompt",
            "outputFormat",
            "prompt",
            "quality",
            "width",
          ],
          type: "object",
        },
      ],
    },
    message: { maxLength: 2000, minLength: 1, type: "string" },
  },
  required: ["action", "generation", "message"],
  type: "object",
} satisfies Record<string, unknown>;

@Injectable()
export class AgentConversationsService {
  constructor(
    @Inject(AGENT_CONVERSATIONS_DB)
    private readonly database: AgentDatabase,
    @Inject(AMUX_CLAUDE_CLIENT)
    private readonly model: AmuxClaudeJsonClient,
    @Inject(GenerationService)
    private readonly generation: GenerationService,
    @Inject(S3FileStorage)
    private readonly storage: S3FileStorage,
  ) {}

  async list(
    userId: string,
    projectId: string,
    input: ListAgentConversationsInput,
  ) {
    await this.assertProjectOwnership(userId, projectId);
    const conversations = await this.database.agentConversation.findMany({
      where: { archivedAt: null, createdById: userId, projectId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      take: input.limit + 1,
    });
    const hasMore = conversations.length > input.limit;
    const items = conversations.slice(0, input.limit);
    return {
      items: items.map(toConversation),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async create(
    userId: string,
    projectId: string,
    input: CreateAgentConversationInput,
  ): Promise<AgentConversationSummary> {
    await this.assertProjectOwnership(userId, projectId);
    return toConversation(
      await this.database.agentConversation.create({
        data: {
          createdById: userId,
          projectId,
          title: input.title ?? DEFAULT_TITLE,
        },
      }),
    );
  }

  async update(
    userId: string,
    conversationId: string,
    input: UpdateAgentConversationInput,
  ): Promise<AgentConversationSummary> {
    await this.assertConversationOwnership(userId, conversationId);
    return toConversation(
      await this.database.agentConversation.update({
        where: { id: conversationId },
        data: {
          ...(input.archived === undefined
            ? {}
            : { archivedAt: input.archived ? new Date() : null }),
          ...(input.title === undefined ? {} : { title: input.title }),
        },
      }),
    );
  }

  async messages(
    userId: string,
    conversationId: string,
    input: ListAgentMessagesInput,
  ) {
    await this.assertConversationOwnership(userId, conversationId);
    const messages = await this.database.agentMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      take: input.limit + 1,
    });
    const hasMore = messages.length > input.limit;
    const page = messages.slice(0, input.limit);
    return {
      items: page.reverse().map(toMessage),
      nextCursor: hasMore ? (page.at(0)?.id ?? null) : null,
    };
  }

  async send(
    userId: string,
    conversationId: string,
    input: SendAgentMessageInput,
  ) {
    const conversation = await this.assertConversationOwnership(
      userId,
      conversationId,
    );
    const replay = await this.findTurn(conversationId, input.clientRequestId);
    if (replay) return replay;

    const context = await this.validateContext(
      userId,
      conversation.projectId,
      input,
    );
    let turn: Awaited<ReturnType<typeof this.createPendingTurn>>;
    try {
      turn = await this.createPendingTurn(conversation, input, context);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const concurrent = await this.findTurn(
          conversationId,
          input.clientRequestId,
        );
        if (concurrent) return concurrent;
      }
      throw error;
    }

    try {
      const [history, images] = await Promise.all([
        this.loadHistory(conversationId, turn.userMessage.id),
        this.loadContextImages(userId, context.fileAssetIds),
      ]);
      const decision = await this.model.generateJson({
        images,
        instructions: agentInstructions,
        jsonSchema: agentDecisionJsonSchema,
        maxTokens: 1_200,
        parse: (value) => agentDecisionSchema.parse(value),
        prompt: buildAgentPrompt(input.content, history, context),
        schemaName: "fashion_agent_decision",
      });

      let taskId: string | null = null;
      if (decision.action === "generate" && decision.generation) {
        const result = await this.generation.create(
          userId,
          {
            background: decision.generation.background,
            cfg: 3.5,
            height: decision.generation.height,
            negativePrompt: decision.generation.negativePrompt,
            outputCompression: 90,
            outputFormat: decision.generation.outputFormat,
            projectId: conversation.projectId,
            prompt: decision.generation.prompt,
            quality: decision.generation.quality,
            shapeIds: [...context.shapeIds],
            steps: 28,
            taskType: "t2i",
            width: decision.generation.width,
          },
          `agent:${conversationId}:${input.clientRequestId}`,
        );
        taskId = result.taskId;
      }

      const assistantMessage = await this.database.agentMessage.update({
        where: { id: turn.assistantMessage.id },
        data: {
          content: decision.message,
          generationTaskId: taskId,
          status: AgentMessageStatus.COMPLETED,
        },
      });
      return {
        assistantMessage: toMessage(assistantMessage),
        taskId,
        userMessage: toMessage(turn.userMessage),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Agent 请求失败";
      const assistantMessage = await this.database.agentMessage.update({
        where: { id: turn.assistantMessage.id },
        data: {
          content: "我暂时无法完成这次请求。你可以检查上下文后重试。",
          errorCode: "AGENT_REQUEST_FAILED",
          errorMessage: errorMessage.slice(0, 1_000),
          status: AgentMessageStatus.FAILED,
        },
      });
      return {
        assistantMessage: toMessage(assistantMessage),
        taskId: null,
        userMessage: toMessage(turn.userMessage),
      };
    }
  }

  private async createPendingTurn(
    conversation: Awaited<
      ReturnType<AgentConversationsService["assertConversationOwnership"]>
    >,
    input: SendAgentMessageInput,
    context: AgentMessageContext,
  ) {
    return this.database.$transaction(async (transaction) => {
      const userMessage = await transaction.agentMessage.create({
        data: {
          clientRequestId: input.clientRequestId,
          content: input.content,
          context: context as unknown as Prisma.InputJsonValue,
          conversationId: conversation.id,
          role: AgentMessageRole.USER,
          status: AgentMessageStatus.COMPLETED,
        },
      });
      const assistantMessage = await transaction.agentMessage.create({
        data: {
          content: "正在理解你的设计需求…",
          conversationId: conversation.id,
          replyToId: userMessage.id,
          role: AgentMessageRole.ASSISTANT,
          status: AgentMessageStatus.PENDING,
        },
      });
      await transaction.agentConversation.update({
        where: { id: conversation.id },
        data: {
          ...(conversation.title === DEFAULT_TITLE
            ? { title: conversationTitle(input.content) }
            : {}),
          updatedAt: new Date(),
        },
      });
      return { assistantMessage, userMessage };
    });
  }

  private async findTurn(conversationId: string, clientRequestId: string) {
    const userMessage = await this.database.agentMessage.findUnique({
      where: {
        conversationId_clientRequestId: { conversationId, clientRequestId },
      },
    });
    if (!userMessage) return null;
    const assistantMessage = await this.database.agentMessage.findUnique({
      where: { replyToId: userMessage.id },
    });
    if (!assistantMessage) return null;
    return {
      assistantMessage: toMessage(assistantMessage),
      taskId: assistantMessage.generationTaskId,
      userMessage: toMessage(userMessage),
    };
  }

  private async loadHistory(conversationId: string, currentMessageId: string) {
    const messages = await this.database.agentMessage.findMany({
      where: {
        conversationId,
        id: { not: currentMessageId },
        status: AgentMessageStatus.COMPLETED,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: HISTORY_LIMIT,
      select: { content: true, role: true },
    });
    return messages.reverse().map((message) => ({
      content: message.content.slice(0, 2_000),
      role: message.role === AgentMessageRole.USER ? "user" : "assistant",
    }));
  }

  private async validateContext(
    userId: string,
    projectId: string,
    input: SendAgentMessageInput,
  ): Promise<AgentMessageContext> {
    const shapeIds = [...new Set(input.shapeIds)];
    const requestedFileIds = [...new Set(input.fileAssetIds)];
    const elements = shapeIds.length
      ? await this.database.boardElement.findMany({
          where: { deletedAt: null, projectId, shapeId: { in: shapeIds } },
          select: { fileAssetId: true, shapeId: true },
        })
      : [];
    if (elements.length !== shapeIds.length) {
      throw new BadRequestException({
        code: "INVALID_AGENT_SHAPES",
        message: "部分画布元素不存在或不属于当前项目",
      });
    }

    if (requestedFileIds.length > 0) {
      const attached = await this.database.boardElement.findMany({
        where: {
          deletedAt: null,
          fileAssetId: { in: requestedFileIds },
          projectId,
        },
        select: { fileAssetId: true },
      });
      const attachedIds = new Set(
        attached.flatMap((element) =>
          element.fileAssetId ? [element.fileAssetId] : [],
        ),
      );
      if (requestedFileIds.some((id) => !attachedIds.has(id))) {
        throw new BadRequestException({
          code: "INVALID_AGENT_FILES",
          message: "部分图片未挂载到当前项目白板",
        });
      }
    }

    const fileAssetIds = [
      ...new Set([
        ...requestedFileIds,
        ...elements.flatMap((element) =>
          element.fileAssetId ? [element.fileAssetId] : [],
        ),
      ]),
    ];
    if (fileAssetIds.length > 0) {
      const owned = await this.database.fileAsset.count({
        where: { id: { in: fileAssetIds }, ownerId: userId },
      });
      if (owned !== fileAssetIds.length) {
        throw new BadRequestException({
          code: "INVALID_AGENT_FILES",
          message: "部分图片不可访问",
        });
      }
    }
    return { fileAssetIds, shapeIds };
  }

  private async loadContextImages(
    userId: string,
    fileAssetIds: readonly string[],
  ) {
    if (fileAssetIds.length === 0) return [];
    const files = await this.database.fileAsset.findMany({
      where: {
        id: { in: [...fileAssetIds] },
        ownerId: userId,
        status: FileStatus.READY,
      },
      take: AGENT_IMAGE_LIMIT,
      select: { objectKey: true },
    });
    return Promise.all(
      files.map(async (file) => ({
        detail: "auto" as const,
        url: await this.storage.createDownloadUrl(file.objectKey, 60 * 60),
      })),
    );
  }

  private async assertProjectOwnership(userId: string, projectId: string) {
    const project = await this.database.project.findUnique({
      where: { id: projectId },
      select: {
        deletedAt: true,
        id: true,
        workspace: { select: { ownerId: true } },
      },
    });
    if (!project || project.deletedAt) {
      throw new NotFoundException({
        code: "PROJECT_NOT_FOUND",
        message: "项目不存在",
      });
    }
    if (project.workspace.ownerId !== userId) {
      throw new ForbiddenException({
        code: "PROJECT_FORBIDDEN",
        message: "无权访问该项目",
      });
    }
    return project;
  }

  private async assertConversationOwnership(
    userId: string,
    conversationId: string,
  ) {
    const conversation = await this.database.agentConversation.findUnique({
      where: { id: conversationId },
      include: {
        project: {
          select: {
            deletedAt: true,
            workspace: { select: { ownerId: true } },
          },
        },
      },
    });
    if (!conversation || conversation.project.deletedAt) {
      throw new NotFoundException({
        code: "AGENT_CONVERSATION_NOT_FOUND",
        message: "会话不存在",
      });
    }
    if (
      conversation.createdById !== userId ||
      conversation.project.workspace.ownerId !== userId
    ) {
      throw new ForbiddenException({
        code: "AGENT_CONVERSATION_FORBIDDEN",
        message: "无权访问该会话",
      });
    }
    return conversation;
  }
}

const agentInstructions = [
  "你是服装设计白板中的项目 Agent。",
  "先理解用户是否只需要建议，还是明确希望生成、绘制、制作或修改视觉方案。",
  "仅在明确需要产出图片时选择 generate；解释、讨论和澄清使用 reply。",
  "回复使用简体中文，简洁说明理解和下一步，不承诺未执行的操作。",
  "生成提示词应具体描述服装品类、廓形、材质、色彩、细节、视角和光线。",
].join("\n");

function buildAgentPrompt(
  content: string,
  history: readonly { readonly content: string; readonly role: string }[],
  context: AgentMessageContext,
): string {
  return JSON.stringify({
    canvasContext: context,
    currentUserMessage: content,
    recentConversation: history,
  });
}

function conversationTitle(content: string): string {
  const compact = content.replace(/\s+/gu, " ").trim();
  return compact.slice(0, 24) || DEFAULT_TITLE;
}

function toConversation(conversation: {
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly updatedAt: Date;
}): AgentConversationSummary {
  return {
    archivedAt: conversation.archivedAt?.toISOString() ?? null,
    createdAt: conversation.createdAt.toISOString(),
    id: conversation.id,
    projectId: conversation.projectId,
    title: conversation.title,
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

function toMessage(message: {
  readonly clientRequestId: string | null;
  readonly content: string;
  readonly context: Prisma.JsonValue | null;
  readonly createdAt: Date;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly generationTaskId: string | null;
  readonly id: string;
  readonly replyToId: string | null;
  readonly role: AgentMessageRole;
  readonly status: AgentMessageStatus;
  readonly updatedAt: Date;
}): AgentMessageView {
  const parsedContext = z
    .object({
      fileAssetIds: z.array(z.string()),
      shapeIds: z.array(z.string()),
    })
    .safeParse(message.context);
  return {
    clientRequestId: message.clientRequestId,
    content: message.content,
    context: parsedContext.success ? parsedContext.data : null,
    createdAt: message.createdAt.toISOString(),
    error:
      message.errorCode && message.errorMessage
        ? { code: message.errorCode, message: message.errorMessage }
        : null,
    generationTaskId: message.generationTaskId,
    id: message.id,
    replyToId: message.replyToId,
    role: message.role === AgentMessageRole.USER ? "user" : "assistant",
    status: message.status.toLowerCase() as AgentMessageView["status"],
    updatedAt: message.updatedAt.toISOString(),
  };
}
