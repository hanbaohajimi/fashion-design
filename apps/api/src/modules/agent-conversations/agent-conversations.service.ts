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
import { RETIRED_BOARD_SHAPE_TYPE } from "../boards/boards.schemas";
import type {
  AttachGenerationTaskInput,
  CreateAgentConversationInput,
  ListAgentConversationsInput,
  ListAgentMessagesInput,
  SendAgentMessageInput,
  UpdateAgentConversationInput,
} from "./agent-conversations.schemas";

export const AGENT_CONVERSATIONS_DB = Symbol("AGENT_CONVERSATIONS_DB");

const DEFAULT_TITLE = "新的设计对话";
const HISTORY_LIMIT = 20;
const AGENT_IMAGE_LIMIT = 16;
const AGENT_IMAGE_MAX_BYTES = 7 * 1024 * 1024;
const AGENT_IMAGE_TOTAL_MAX_BYTES = 20 * 1024 * 1024;
const IDEMPOTENCY_REPLAY_ATTEMPTS = 3;
const CLAUDE_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const FIXED_GENERATION_PARAMETERS = {
  background: "opaque" as const,
  cfg: 3.5,
  outputCompression: 90,
  outputFormat: "png" as const,
  quality: "high" as const,
  steps: 28,
};

type AgentDatabase = Pick<
  PrismaClient,
  | "$transaction"
  | "agentConversation"
  | "agentMessage"
  | "boardElement"
  | "fabric"
  | "fileAsset"
  | "generationTask"
  | "project"
>;

interface AgentCanvasElementContext {
  readonly color?: string;
  readonly fabricId?: string;
  readonly fabricTags?: readonly string[];
  readonly label?: string;
  readonly role: string;
  readonly roleLabel?: string;
  readonly shapeId: string;
  readonly shapeType: string;
  readonly text?: string;
}

interface ValidatedAgentContext extends AgentMessageContext {
  readonly elements: readonly AgentCanvasElementContext[];
}

const agentDecisionSchema = z
  .object({
    action: z.enum(["reply", "generate"]),
    generation: z
      .object({
        negativePrompt: z.string().max(3_000),
        prompt: z.string().trim().min(1).max(4_000),
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
            negativePrompt: { maxLength: 3000, type: "string" },
            prompt: { maxLength: 4000, minLength: 1, type: "string" },
          },
          required: ["negativePrompt", "prompt"],
          type: "object",
        },
      ],
    },
    message: { maxLength: 2000, minLength: 1, type: "string" },
  },
  required: ["action", "generation", "message"],
  type: "object",
} satisfies Record<string, unknown>;

function normalizeAgentDecision(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const decision = { ...(value as Record<string, unknown>) };
  if (decision.action === "reply") {
    decision.generation = null;
    return decision;
  }
  if (typeof decision.generation !== "string") return decision;

  const serialized = decision.generation.trim();
  if (!serialized || serialized === "null") {
    decision.generation = null;
    return decision;
  }
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      decision.generation = parsed;
      return decision;
    }
  } catch {
    // Some compatible providers return the image prompt directly in this field.
  }
  decision.generation = {
    negativePrompt: "",
    prompt: serialized,
  };
  return decision;
}

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

  async attachGenerationTask(
    userId: string,
    conversationId: string,
    generationTaskId: string,
    input: AttachGenerationTaskInput,
  ): Promise<AgentMessageView> {
    const conversation = await this.assertConversationOwnership(
      userId,
      conversationId,
    );
    if (conversation.archivedAt) {
      throw new BadRequestException({
        code: "AGENT_CONVERSATION_ARCHIVED",
        message: "已归档会话不能继续添加生成记录",
      });
    }
    const task = await this.database.generationTask.findFirst({
      where: {
        id: generationTaskId,
        projectId: conversation.projectId,
        userId,
      },
    });
    if (!task) {
      throw new NotFoundException("生成任务不存在或无权访问");
    }
    const existing = await this.database.agentMessage.findUnique({
      where: { generationTaskId },
    });
    if (existing) {
      if (existing.conversationId !== conversationId) {
        throw new BadRequestException("生成任务已关联其他会话");
      }
      return toMessage(existing);
    }

    const context = {
      fileAssetIds: input.fileAssetIds,
      shapeIds: input.shapeIds,
    } satisfies AgentMessageContext;
    const message = await this.database.$transaction(async (transaction) => {
      const created = await transaction.agentMessage.create({
        data: {
          content: input.content,
          context: context as unknown as Prisma.InputJsonValue,
          conversationId,
          generationTaskId,
          role: AgentMessageRole.ASSISTANT,
          status: AgentMessageStatus.COMPLETED,
        },
      });
      await transaction.agentConversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      return created;
    });
    return toMessage(message);
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
    if (conversation.archivedAt) {
      throw new BadRequestException({
        code: "AGENT_CONVERSATION_ARCHIVED",
        message: "已归档会话不能继续发送消息",
      });
    }
    const replay = await this.findTurn(conversationId, input.clientRequestId);
    if (
      replay &&
      replay.assistantMessage.status !== AgentMessageStatus.FAILED
    ) {
      return toTurnResponse(replay);
    }

    const context = await this.validateContext(
      userId,
      conversation.projectId,
      input,
    );
    let turn: Awaited<ReturnType<typeof this.createPendingTurn>>;
    if (replay) {
      this.assertRetryMatchesOriginal(replay.userMessage, input, context);
      const assistantMessage = await this.database.agentMessage.update({
        where: { id: replay.assistantMessage.id },
        data: {
          content: "正在理解你的设计需求…",
          errorCode: null,
          errorMessage: null,
          generationTaskId: null,
          status: AgentMessageStatus.PENDING,
        },
      });
      turn = { assistantMessage, userMessage: replay.userMessage };
    } else {
      try {
        turn = await this.createPendingTurn(conversation, input, context);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const concurrent = await this.waitForTurn(
            conversationId,
            input.clientRequestId,
          );
          if (concurrent) return toTurnResponse(concurrent);
        }
        throw error;
      }
    }

    try {
      const [history, imageContext] = await Promise.all([
        this.loadHistory(conversationId, turn.userMessage.id),
        this.loadContextImages(userId, context.fileAssetIds),
      ]);
      const decision = await this.model.generateJson({
        images: imageContext.images,
        instructions: agentInstructions,
        jsonSchema: agentDecisionJsonSchema,
        maxTokens: 1_200,
        parse: (value) =>
          agentDecisionSchema.parse(normalizeAgentDecision(value)),
        prompt: buildAgentPrompt(input.content, history, context),
        schemaName: "fashion_agent_decision",
      });

      let taskId: string | null = null;
      if (decision.action === "generate" && decision.generation) {
        const outputSize = generationSizeFrom(imageContext.primaryDimensions);
        const result = await this.generation.create(
          userId,
          {
            ...FIXED_GENERATION_PARAMETERS,
            height: outputSize.height,
            negativePrompt: decision.generation.negativePrompt,
            projectId: conversation.projectId,
            prompt: decision.generation.prompt,
            shapeIds: [...context.shapeIds],
            taskType: "t2i",
            width: outputSize.width,
          },
          `agent:${conversationId}:${input.clientRequestId}`,
          input.content,
        );
        taskId = result.taskId;
      }

      const assistantMessage = await this.database.agentMessage.update({
        where: { id: turn.assistantMessage.id },
        data: {
          content: decision.message,
          errorCode: null,
          errorMessage: null,
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
    return { assistantMessage, userMessage };
  }

  private async waitForTurn(conversationId: string, clientRequestId: string) {
    for (let attempt = 0; attempt < IDEMPOTENCY_REPLAY_ATTEMPTS; attempt += 1) {
      const turn = await this.findTurn(conversationId, clientRequestId);
      if (turn) return turn;
      if (attempt === IDEMPOTENCY_REPLAY_ATTEMPTS - 1) break;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, (attempt + 1) * 10);
      });
    }
    return null;
  }

  private assertRetryMatchesOriginal(
    userMessage: Parameters<typeof toMessage>[0],
    input: SendAgentMessageInput,
    context: AgentMessageContext,
  ): void {
    const originalContext = toMessage(userMessage).context;
    if (
      userMessage.content !== input.content ||
      !sameIds(originalContext?.shapeIds ?? [], context.shapeIds) ||
      !sameIds(originalContext?.fileAssetIds ?? [], context.fileAssetIds)
    ) {
      throw new BadRequestException({
        code: "AGENT_IDEMPOTENCY_CONFLICT",
        message: "重试请求与原始消息不一致",
      });
    }
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
  ): Promise<ValidatedAgentContext> {
    const shapeIds = [...new Set(input.shapeIds)];
    const requestedFileIds = [...new Set(input.fileAssetIds)];
    const elements = shapeIds.length
      ? await this.database.boardElement.findMany({
          where: {
            deletedAt: null,
            projectId,
            shapeId: { in: shapeIds },
            shapeType: { not: RETIRED_BOARD_SHAPE_TYPE },
          },
          select: {
            fileAssetId: true,
            record: true,
            role: true,
            roleLabel: true,
            shapeId: true,
            shapeType: true,
          },
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
          shapeType: { not: RETIRED_BOARD_SHAPE_TYPE },
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

    const elementByShapeId = new Map(
      elements.map((element) => [element.shapeId, element] as const),
    );
    const fileAssetIds = [
      ...new Set([
        ...requestedFileIds,
        ...shapeIds.flatMap((shapeId) => {
          const element = elementByShapeId.get(shapeId);
          return element?.fileAssetId ? [element.fileAssetId] : [];
        }),
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
    const fabricIds = elements.flatMap((element) => {
      const props = propsOf(element.record);
      return typeof props.fabricId === "string" && props.fabricId.trim()
        ? [props.fabricId.trim()]
        : [];
    });
    const fabrics = fabricIds.length
      ? await this.database.fabric.findMany({
          where: { id: { in: [...new Set(fabricIds)] }, ownerId: userId },
          select: { id: true, tags: true },
        })
      : [];
    const fabricById = new Map(fabrics.map((fabric) => [fabric.id, fabric]));
    const elementContexts = shapeIds.flatMap((shapeId) => {
      const element = elementByShapeId.get(shapeId);
      if (!element) return [];
      const props = propsOf(element.record);
      const fabricId = cleanContextText(props.fabricId, 128);
      const fabric = fabricId ? fabricById.get(fabricId) : undefined;
      const roleLabel =
        cleanContextText(element.roleLabel, 120) ??
        cleanContextText(props.roleLabel, 120);
      const text = cleanContextText(props.text, 1_000);
      const color = cleanContextText(props.color, 32);
      const label = cleanContextText(props.label, 120);
      const fallbackFabricTags = cleanContextTags(props.fabricTags);
      return [
        {
          role: element.role,
          shapeId: element.shapeId,
          shapeType: element.shapeType,
          ...(roleLabel ? { roleLabel } : {}),
          ...(text ? { text } : {}),
          ...(color ? { color } : {}),
          ...(label ? { label } : {}),
          ...(fabricId ? { fabricId } : {}),
          ...(fabric
            ? { fabricTags: fabric.tags }
            : fallbackFabricTags.length > 0
              ? { fabricTags: fallbackFabricTags }
              : {}),
        },
      ];
    });
    return { elements: elementContexts, fileAssetIds, shapeIds };
  }

  private async loadContextImages(
    userId: string,
    fileAssetIds: readonly string[],
  ) {
    if (fileAssetIds.length === 0) {
      return { images: [], primaryDimensions: null };
    }
    const files = await this.database.fileAsset.findMany({
      where: {
        id: { in: [...fileAssetIds] },
        ownerId: userId,
        status: FileStatus.READY,
      },
      take: AGENT_IMAGE_LIMIT,
      select: {
        height: true,
        id: true,
        mimeType: true,
        objectKey: true,
        thumbnail1024Key: true,
        width: true,
      },
    });
    const fileById = new Map(files.map((file) => [file.id, file] as const));
    const orderedFiles = fileAssetIds.flatMap((id) => {
      const file = fileById.get(id);
      return file ? [file] : [];
    });
    const primary = orderedFiles.find(
      (file) =>
        typeof file.width === "number" &&
        file.width > 0 &&
        typeof file.height === "number" &&
        file.height > 0,
    );
    const loadedImages = await Promise.all(
      orderedFiles.map(async (file) => {
        const useThumbnail = Boolean(file.thumbnail1024Key);
        const objectKey = file.thumbnail1024Key ?? file.objectKey;
        const mimeType = useThumbnail ? "image/webp" : file.mimeType;
        if (!CLAUDE_IMAGE_MIME_TYPES.has(mimeType)) {
          throw new Error(`Agent 不支持参考图片格式：${mimeType}`);
        }
        const bytes = await this.storage.readPrefix(
          objectKey,
          AGENT_IMAGE_MAX_BYTES + 1,
        );
        if (bytes.byteLength === 0) {
          throw new Error("Agent 参考图片为空");
        }
        if (bytes.byteLength > AGENT_IMAGE_MAX_BYTES) {
          throw new Error("Agent 单张参考图片超过 7MB，请压缩后重试");
        }
        return {
          byteLength: bytes.byteLength,
          image: {
            detail: "auto" as const,
            url: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
          },
        };
      }),
    );
    const totalBytes = loadedImages.reduce(
      (total, image) => total + image.byteLength,
      0,
    );
    if (totalBytes > AGENT_IMAGE_TOTAL_MAX_BYTES) {
      throw new Error("Agent 参考图片总大小超过 20MB，请减少选中图片后重试");
    }
    const images = loadedImages.map((loaded) => loaded.image);
    return {
      images,
      primaryDimensions: primary
        ? { height: primary.height as number, width: primary.width as number }
        : null,
    };
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
  "选中图片后，用户出现修改、替换、调整、生成、绘制、制作等明确视觉操作意图时选择 generate；咨询、分析、解释和澄清使用 reply。",
  "action 为 reply 时 generation 必须是 JSON null；action 为 generate 时 generation 只包含 prompt 与 negativePrompt，禁止输出尺寸、质量、格式、背景、采样步数或 CFG。",
  "回复使用简体中文，简洁说明理解和下一步，不承诺未执行的操作。",
  "canvasContext.elements 是从当前项目读取并校验过的权威事实；必须使用其中的便签、色值、标签和面料参数，禁止补造缺失属性。",
  "生成提示词应具体描述服装品类、廓形、材质、色彩、细节、视角和光线。",
  "除非 currentUserMessage 明确要求模特试穿、真人上身或等价表达，否则生成提示词必须使用服装单品展示、平铺、人台、衣架或服装效果图，不得自行加入真人、人物、模特、试穿、T台或生活方式摄影。",
].join("\n");

function buildAgentPrompt(
  content: string,
  history: readonly { readonly content: string; readonly role: string }[],
  context: ValidatedAgentContext,
): string {
  return JSON.stringify({
    canvasContext: context,
    currentUserMessage: content,
    recentConversation: history,
  });
}

function generationSizeFrom(
  dimensions: { readonly height: number; readonly width: number } | null,
): { readonly height: 768 | 1024; readonly width: 768 | 1024 } {
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return { height: 1024, width: 1024 };
  }
  const ratio = dimensions.width / dimensions.height;
  if (ratio > 1) return { height: 768, width: 1024 };
  if (ratio < 1) return { height: 1024, width: 768 };
  return { height: 1024, width: 1024 };
}

function propsOf(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const props = (value as Record<string, unknown>).props;
  return props && typeof props === "object" && !Array.isArray(props)
    ? (props as Record<string, unknown>)
    : {};
}

function cleanContextText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function cleanContextTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.flatMap((tag) => {
        const cleaned = cleanContextText(tag, 30);
        return cleaned ? [cleaned] : [];
      }),
    ),
  ].slice(0, 12);
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

function toTurnResponse(turn: {
  readonly assistantMessage: Parameters<typeof toMessage>[0];
  readonly userMessage: Parameters<typeof toMessage>[0];
}) {
  return {
    assistantMessage: toMessage(turn.assistantMessage),
    taskId: turn.assistantMessage.generationTaskId,
    userMessage: toMessage(turn.userMessage),
  };
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}
