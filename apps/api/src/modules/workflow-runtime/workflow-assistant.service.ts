import { AgentMessageRole, AgentMessageStatus, Prisma, appendWorkflowOutbox, type PrismaClient } from "@fashion/db";
import type { AmuxClaudeJsonClient } from "@fashion/ai";
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { AMUX_CLAUDE_CLIENT } from "../ai/ai.tokens";
import { DesignContextService } from "../design-context/design-context.service";
import { VisualContextService } from "../design-context/visual-context.service";
import type { PatchProjectDesignContextInput } from "../design-context/design-context.schemas";
import { WorkflowsService } from "../workflows/workflows.service";
import { WORKFLOW_RUNTIME_DB, WorkflowRuntimeService } from "./workflow-runtime.service";
import { WorkflowCoordinator, MAX_PLANNER_CALLS } from "./workflow-coordinator";

const nodeId = z.string().trim().min(1).max(128);
export const workflowMessageSchema = z.object({
  clientRequestId: z.string().trim().min(8).max(200),
  content: z.string().trim().min(1).max(4_000),
  referencedNodeIds: z.array(nodeId).max(16).default([]),
  focusNodeIds: z.array(nodeId).max(16).optional(),
  respondingToProposalId: nodeId.optional(),
}).strict();
export const workflowContextCorrectionSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  summaryRevision: z.number().int().nonnegative().optional(),
  mutationId: z.uuid(),
  currentObjective: z.string().trim().min(1).max(4_000).optional(),
  focusNodeIds: z.array(nodeId).max(16).optional(),
  disabledPreferenceIds: z.array(nodeId).max(100).optional(),
  updatedItems: z.array(z.object({ id: nodeId, text: z.string().trim().min(1).max(2_000).optional(), confirm: z.boolean().optional(), scope: z.enum(["project", "branch"]).optional() }).strict()).max(50).optional(),
}).strict().superRefine((value, context) => {
  if (value.focusNodeIds !== undefined && value.summaryRevision === undefined) context.addIssue({ code: "custom", path: ["summaryRevision"], message: "更正焦点需要当前会话上下文版本，请先刷新上下文" });
  if (value.currentObjective === undefined && value.focusNodeIds === undefined && !value.disabledPreferenceIds?.length && !value.updatedItems?.length) context.addIssue({ code: "custom", message: "请提供需要更正的目标、焦点或偏好" });
});
type MessageInput = z.infer<typeof workflowMessageSchema>;
type CorrectionInput = z.infer<typeof workflowContextCorrectionSchema>;
const TURN_TIMEOUT_MS = 15 * 60_000;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

@Injectable()
export class WorkflowAssistantService {
  private readonly logger = new Logger(WorkflowAssistantService.name);
  constructor(
    @Inject(WORKFLOW_RUNTIME_DB) private readonly database: PrismaClient,
    @Inject(WorkflowsService) private readonly workflows: WorkflowsService,
    @Inject(WorkflowRuntimeService) private readonly runtime: WorkflowRuntimeService,
    @Inject(DesignContextService) private readonly contexts: DesignContextService,
    @Inject(VisualContextService) private readonly visual: VisualContextService,
    @Inject(AMUX_CLAUDE_CLIENT) private readonly model: AmuxClaudeJsonClient,
    @Optional() @Inject(WorkflowCoordinator) private readonly coordinator?: WorkflowCoordinator,
  ) {}

  private async conversation(userId: string, id: string, write = false) {
    const conversation = await this.database.agentConversation.findFirst({ where: {
      id, createdById: userId, project: { deletedAt: null, workspace: { ownerId: userId } },
    } });
    if (!conversation) throw new NotFoundException("设计会话不存在");
    if (conversation.mode !== "workflow") throw new BadRequestException("历史会话仅供查看，请新建设计协作会话");
    if (write && conversation.archivedAt) throw new BadRequestException("已归档会话不能继续修改");
    if (write) {
      const project = await this.database.project.findUnique({ where: { id: conversation.projectId }, select: { archived: true } });
      if (project?.archived) throw new BadRequestException("已归档项目不能继续修改");
    }
    return conversation;
  }

  async getContext(userId: string, conversationId: string) {
    const conversation = await this.conversation(userId, conversationId);
    for (let attempt = 0; attempt < 2; attempt++) {
      const built = await this.contexts.build(userId, conversation.projectId, { conversationId });
      const [profile, visual] = await Promise.all([
        this.contexts.get(userId, conversation.projectId),
        this.visual.enrich(userId, conversation.projectId, built.graph.nodes, built.context.focusNodeIds),
      ]);
      if (profile.revision !== built.context.contextRevision) continue;
      const project = await this.database.project.findUniqueOrThrow({ where: { id: conversation.projectId } });
      return { ...built.context, ...profile, contextRevision: profile.revision, agentVersion: project.workflowAgentVersion,
        state: profile.state, visualIndex: visual.index, visualCoverage: visual.coverage, imageBindings: visual.imageBindings };
    }
    throw new ConflictException("设计上下文正在更新，请重新读取");
  }

  async correctContext(userId: string, conversationId: string, raw: CorrectionInput) {
    const input = workflowContextCorrectionSchema.parse(raw);
    const conversation = await this.conversation(userId, conversationId, true);
    const graph = await this.workflows.get(userId, conversation.projectId);
    const operations: PatchProjectDesignContextInput["operations"] = [];
    if (input.currentObjective) operations.push({ type: "set_objective", text: input.currentObjective, origin: "explicit" });
    for (const id of input.disabledPreferenceIds ?? []) operations.push({ type: "deactivate_item", id });
    if (input.updatedItems?.length) {
      const built = await this.contexts.build(userId, conversation.projectId, { conversationId });
      const profile = await this.contexts.get(userId, conversation.projectId);
      const available = [...profile.state.requirements, ...profile.state.preferences, ...built.context.requirements];
      for (const change of input.updatedItems) {
        const item = available.find((entry) => entry.id === change.id);
        if (!item) throw new BadRequestException("上下文条目不存在，请刷新后再更正");
        const scope = change.scope ?? item.scope;
        if (scope === "project" && item.scope === "branch" && !change.confirm) throw new BadRequestException("将分支理解用于整个项目需要明确确认");
        const changed = change.text !== undefined && change.text !== item.text;
        operations.push({ type: "upsert_item", item: { ...item, text: change.text ?? item.text,
          origin: change.confirm || changed ? "explicit" : item.origin, scope, branchNodeIds: scope === "project" ? [] : item.branchNodeIds,
          ...(changed ? { sourceQuote: null, sourceMessageId: null } : {}) } });
      }
    }
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    await this.database.$transaction(async (tx) => {
      const locked = await tx.agentConversation.updateMany({ where: { id: conversationId, archivedAt: null }, data: { updatedAt: new Date() } });
      if (locked.count !== 1) throw new ConflictException("会话已归档或失效");
      const active = await tx.agentConversation.findUniqueOrThrow({ where: { id: conversationId } });
      const summary = await tx.agentContextSummary.findUnique({ where: { conversationId } });
      const previousCorrection = object(object(summary?.summary).lastCorrection);
      if (previousCorrection.mutationId === input.mutationId) {
        if (previousCorrection.requestHash !== requestHash) throw new ConflictException("该更正编号已用于不同内容");
        return;
      }
      this.validateReferences(graph.nodes, input.focusNodeIds ?? []);
      if (input.summaryRevision !== undefined && input.summaryRevision !== (summary?.revision ?? 0)) throw new ConflictException("会话焦点已更新，请刷新后再修改");
      if (operations.length) await this.contexts.patchInTransaction(userId, conversation.projectId, { baseRevision: input.baseRevision, mutationId: input.mutationId, operations }, tx, graph);
      else {
        const state = await tx.projectDesignContext.findUnique({ where: { projectId: conversation.projectId } });
        if ((state?.revision ?? 0) !== input.baseRevision) throw new ConflictException("上下文已更新，请刷新后再修改");
      }
      const savedSummary = { ...object(summary?.summary), lastCorrection: { mutationId: input.mutationId, requestHash } };
      await tx.agentContextSummary.upsert({ where: { conversationId }, create: { conversationId, summary: json(savedSummary), graphRevision: graph.revision, focusNodeIds: input.focusNodeIds ?? [], revision: 1 },
        update: { summary: json(savedSummary), ...(input.focusNodeIds ? { focusNodeIds: input.focusNodeIds } : {}), graphRevision: graph.revision, revision: { increment: 1 } } });
      const observation = active.activeTurnId ? await tx.agentTurn.findFirst({ where: { conversationId, leaseToken: active.activeTurnId, trigger: "observation", status: "running" } }) : null;
      if (observation) await tx.agentTurn.updateMany({ where: { id: observation.id, status: "running", leaseToken: active.activeTurnId }, data: { status: "superseded", error: "用户的上下文更正优先", leaseToken: null, leaseExpiresAt: null } });
      await tx.agentConversation.update({ where: { id: conversationId }, data: { intentEpoch: { increment: 1 }, ...(observation ? { activeTurnId: null, activeTurnStartedAt: null } : {}) } });
    });
    return this.getContext(userId, conversationId);
  }

  async messages(userId: string, conversationId: string, input: { cursor?: string | undefined; limit: number }) {
    await this.conversation(userId, conversationId);
    await this.database.agentMessage.updateMany({ where: { conversationId, status: "PENDING", updatedAt: { lt: new Date(Date.now() - TURN_TIMEOUT_MS) } },
      data: { status: "FAILED", errorCode: "WORKFLOW_TURN_TIMEOUT", errorMessage: "本轮处理超时，可以重试", content: "本轮处理超时，请重试。" } });
    const rows = await this.database.agentMessage.findMany({ where: { conversationId }, include: { proposal: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}) });
    const page = rows.slice(0, input.limit);
    return { items: page.reverse().map(messageView), nextCursor: rows.length > input.limit ? page[0]?.id ?? null : null };
  }

  async reapExpiredTurns() {
    const rows = await this.database.agentTurn.findMany({ where: { status: { in: ["running", "committing"] }, leaseExpiresAt: { lte: new Date() } },
      orderBy: [{ leaseExpiresAt: "asc" }, { id: "asc" }], take: 100 });
    for (const turn of rows) await this.database.$transaction(async (tx) => {
      const expired = await tx.agentTurn.updateMany({ where: { id: turn.id, leaseToken: turn.leaseToken, status: { in: ["running", "committing"] }, leaseExpiresAt: { lte: new Date() } },
        data: { status: "failed", error: "本轮处理超时，可以重试", leaseToken: null, leaseExpiresAt: null } });
      if (!expired.count) return;
      await tx.agentConversation.updateMany({ where: { id: turn.conversationId, activeTurnId: turn.leaseToken }, data: { activeTurnId: null, activeTurnStartedAt: null } });
      await tx.agentMessage.updateMany({ where: { turnId: turn.id, status: "PENDING" }, data: { status: "FAILED", errorCode: "WORKFLOW_TURN_TIMEOUT", errorMessage: "本轮处理超时，可以重试", content: "本轮处理超时，请重试。" } });
    });
  }

  async send(userId: string, conversationId: string, raw: MessageInput) {
    const input = workflowMessageSchema.parse(raw);
    const conversation = await this.conversation(userId, conversationId, true);
    const project = await this.database.project.findUniqueOrThrow({ where: { id: conversation.projectId } });
    if (project.workflowAgentVersion !== 2) throw new BadRequestException("该项目已暂停新版设计协作，可在更多菜单重新启用");
    const graph = await this.workflows.get(userId, conversation.projectId);
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const lease = randomUUID();
    const turn = await this.database.$transaction(async (tx) => {
      const previous = await tx.agentMessage.findUnique({ where: { conversationId_clientRequestId: { conversationId, clientRequestId: input.clientRequestId } }, include: { reply: { include: { proposal: true } } } });
      if (previous) {
        if (object(previous.context).requestFingerprint !== fingerprint) throw new ConflictException("请求编号已用于不同内容或引用");
        if (previous.reply && previous.reply.status !== "FAILED" && !(previous.reply.status === "PENDING" && previous.reply.updatedAt.getTime() < Date.now() - TURN_TIMEOUT_MS))
          return { userMessage: previous, assistantMessage: previous.reply, replay: true, lease, turnId: "", epoch: 0 };
      }
      this.validateReferences(graph.nodes, [...input.referencedNodeIds, ...(input.focusNodeIds ?? [])]);
      const current = await tx.agentConversation.findUniqueOrThrow({ where: { id: conversationId } });
      const background = current.activeTurnId ? await tx.agentTurn.findFirst({ where: { conversationId, leaseToken: current.activeTurnId, trigger: "observation", status: "running" } }) : null;
      const claimed = await tx.agentConversation.updateMany({ where: { id: conversationId, archivedAt: null,
        OR: [{ activeTurnId: null }, { activeTurnStartedAt: { lt: new Date(Date.now() - TURN_TIMEOUT_MS) } }, ...(background ? [{ activeTurnId: current.activeTurnId }] : [])] },
        data: { activeTurnId: lease, activeTurnStartedAt: new Date(), intentEpoch: { increment: 1 } } });
      if (claimed.count !== 1) throw new ConflictException("上一条消息正在处理，请等待完成后再发送");
      if (background) await tx.agentTurn.updateMany({ where: { id: background.id, status: "running" }, data: { status: "superseded", error: "用户的新请求优先", leaseToken: null, leaseExpiresAt: null } });
      await tx.agentMessage.updateMany({ where: { conversationId, status: "PENDING", updatedAt: { lt: new Date(Date.now() - TURN_TIMEOUT_MS) } }, data: { status: "FAILED", errorCode: "WORKFLOW_TURN_TIMEOUT", errorMessage: "本轮处理超时，可以重试" } });
      const epoch = (await tx.agentConversation.findUniqueOrThrow({ where: { id: conversationId } })).intentEpoch;
      const record = await tx.agentTurn.upsert({ where: { conversationId_clientRequestId: { conversationId, clientRequestId: input.clientRequestId } },
        create: { projectId: conversation.projectId, conversationId, userId, clientRequestId: input.clientRequestId, intentEpoch: epoch, trigger: "user", status: "running", leaseToken: lease, leaseExpiresAt: new Date(Date.now() + TURN_TIMEOUT_MS) },
        update: { intentEpoch: epoch, status: "running", leaseToken: lease, leaseExpiresAt: new Date(Date.now() + TURN_TIMEOUT_MS), error: null } });
      const userMessage = previous ?? await tx.agentMessage.create({ data: { conversationId, role: "USER", content: input.content,
        turnId: record.id, clientRequestId: input.clientRequestId, context: json({ requestFingerprint: fingerprint, referencedNodeIds: input.referencedNodeIds, focusNodeIds: input.focusNodeIds ?? null, respondingToProposalId: input.respondingToProposalId ?? null, fileAssetIds: [], shapeIds: [] }) } });
      const assistantMessage = previous?.reply
        ? await tx.agentMessage.update({ where: { id: previous.reply.id }, data: { turnId: record.id, status: "PENDING", content: "正在理解画布与设计过程…", errorCode: null, errorMessage: null, kind: null, proposalId: null } })
        : await tx.agentMessage.create({ data: { conversationId, turnId: record.id, role: "ASSISTANT", status: "PENDING", content: "正在理解画布与设计过程…", replyToId: userMessage.id } });
      const summary = await tx.agentContextSummary.findUnique({ where: { conversationId } });
      const focusNodeIds = input.focusNodeIds ?? (input.referencedNodeIds.length ? input.referencedNodeIds : summary?.focusNodeIds ?? []);
      await tx.agentContextSummary.upsert({ where: { conversationId },
        create: { conversationId, summary: { text: "", sourceMessageIds: [] }, graphRevision: graph.revision, focusNodeIds },
        update: { focusNodeIds, revision: { increment: 1 } } });
      if (input.respondingToProposalId) {
        const proposal = await tx.workflowProposal.findFirst({ where: { id: input.respondingToProposalId, projectId: conversation.projectId, conversationId, userId } });
        if (!proposal) throw new BadRequestException("被调整的提案不属于当前会话");
        await tx.workflowProposal.updateMany({ where: { id: proposal.id, status: "pending" }, data: { status: "superseded" } });
        await appendWorkflowOutbox(tx, { projectId: conversation.projectId, eventKey: "proposal:" + proposal.id + ":adjust:" + input.clientRequestId,
          eventType: "proposal.decision", payload: { proposalId: proposal.id, kind: "adjusted", userId, reason: input.content } });
      }
      return { userMessage, assistantMessage, replay: false, lease, turnId: record.id, epoch };
    });
    if (turn.replay) return turnView(turn);
    try {
      const assistantMessage = await this.completeTurn(userId, conversationId, conversation.projectId, turn, input);
      return turnView({ userMessage: turn.userMessage, assistantMessage });
    } catch (error) {
      const failed = await this.failTurn(conversationId, turn, error, turn.assistantMessage.id);
      if (!failed) throw error;
      return turnView({ userMessage: turn.userMessage, assistantMessage: failed });
    }
  }

  private coordinatorService() {
    return this.coordinator ?? new WorkflowCoordinator(this.database, this.workflows, this.contexts, this.visual, this.model);
  }

  async currentPlan(userId: string, conversationId: string): Promise<{ revision: number; plan: Prisma.JsonValue | null; graphRevision?: number; contextRevision?: number; status: string; createdAt?: string }> {
    await this.conversation(userId, conversationId);
    const latest = await this.database.agentPlanRevision.findFirst({ where: { conversationId }, orderBy: { revision: "desc" } });
    return latest ? { revision: latest.revision, plan: latest.plan, graphRevision: latest.graphRevision, contextRevision: latest.contextRevision, status: latest.status, createdAt: latest.createdAt.toISOString() }
      : { revision: 0, plan: null, status: "unplanned" };
  }

  async observeExecution(eventId: string): Promise<"completed" | "deferred" | "superseded"> {
    const event = await this.database.workflowOutbox.findUniqueOrThrow({ where: { id: eventId } });
    if (!event.executionId) return "completed";
    const execution = await this.database.workflowExecution.findUnique({ where: { id: event.executionId } });
    if (!execution?.conversationId) return "completed";
    const conversationId = execution.conversationId;
    const conversation = await this.database.agentConversation.findFirst({ where: { id: conversationId, projectId: execution.projectId, createdById: execution.userId,
      project: { deletedAt: null, workspace: { ownerId: execution.userId } } } });
    if (!conversation) return "completed";
    const lease = randomUUID();
    const reserved = await this.database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM agent_conversations WHERE id = ${conversationId} FOR UPDATE`;
      const live = await tx.agentConversation.findUniqueOrThrow({ where: { id: conversationId } });
      const existing = await tx.agentTurn.findUnique({ where: { sourceEventId: eventId } });
      const factKey = "execution-receipt:" + execution.id;
      await tx.agentMessage.upsert({ where: { conversationId_clientRequestId: { conversationId, clientRequestId: factKey } }, update: {}, create: { conversationId, role: "ASSISTANT", kind: "reply", origin: "execution_result", sourceEventId: eventId, executionId: execution.id,
        clientRequestId: factKey, content: execution.status === "completed" ? "工具已完成，实际结果已保存到画布。正在结合结果整理后续建议。" : "本次工具执行已结束：" + execution.status + "。实际结果和失败原因已记录，未自动重试生成。",
        context: json({ executionId: execution.id, fileAssetIds: [], shapeIds: [], sourceEventId: eventId }) } });
      if (existing && ["completed", "superseded"].includes(existing.status)) return null;
      if (execution.intentEpoch !== null && execution.intentEpoch !== live.intentEpoch) {
        await tx.agentTurn.upsert({ where: { sourceEventId: eventId }, create: { projectId: execution.projectId, conversationId, userId: execution.userId,
          trigger: "observation", sourceEventId: eventId, intentEpoch: execution.intentEpoch, status: "superseded", error: "执行期间用户意图已变化，仅保留事实回执" },
          update: { status: "superseded", error: "执行期间用户意图已变化，仅保留事实回执", leaseToken: null, leaseExpiresAt: null } });
        return "superseded" as const;
      }
      const project = await tx.project.findUnique({ where: { id: execution.projectId } });
      if (live.archivedAt || project?.archived || project?.workflowAgentVersion !== 2) return null;
      const claimed = await tx.agentConversation.updateMany({ where: { id: conversationId, archivedAt: null, intentEpoch: live.intentEpoch,
        OR: [{ activeTurnId: null }, { activeTurnStartedAt: { lt: new Date(Date.now() - TURN_TIMEOUT_MS) } }] },
        data: { activeTurnId: lease, activeTurnStartedAt: new Date() } });
      if (claimed.count !== 1) return "deferred" as const;
      await tx.agentContextSummary.upsert({ where: { conversationId }, update: {}, create: { conversationId, summary: { text: "", sourceMessageIds: [] }, graphRevision: 0 } });
      const record = await tx.agentTurn.upsert({ where: { sourceEventId: eventId },
        create: { projectId: execution.projectId, conversationId, userId: execution.userId, trigger: "observation", sourceEventId: eventId,
          intentEpoch: live.intentEpoch, status: "running", leaseToken: lease, leaseExpiresAt: new Date(Date.now() + TURN_TIMEOUT_MS) },
        update: { intentEpoch: live.intentEpoch, status: "running", leaseToken: lease, leaseExpiresAt: new Date(Date.now() + TURN_TIMEOUT_MS), error: null } });
      return { lease, turnId: record.id, epoch: live.intentEpoch };
    });
    if (reserved === "deferred") return "deferred";
    if (reserved === "superseded") return "superseded";
    if (!reserved) return "completed";
    try {
      await this.completeTurn(execution.userId, conversationId, execution.projectId, reserved, {
        clientRequestId: "observation:" + eventId, content: "工具执行已结束。请读取本次真实执行记录和结果，更新当前阶段计划，解释与原目标的关系并给出一项待审下一步；如属技术失败仅解释恢复方式，不推断设计缺陷，不执行工具。",
        referencedNodeIds: [execution.toolNodeId],
      }, { eventId, executionId: execution.id });
      return "completed";
    } catch (error) {
      await this.failTurn(conversationId, reserved, error);
      const current = await this.database.agentTurn.findUnique({ where: { id: reserved.turnId } });
      if (current?.status === "superseded") return "superseded";
      throw error;
    }
  }

  private async completeTurn(userId: string, conversationId: string, projectId: string,
    turn: { lease: string; turnId: string; epoch: number; assistantMessage?: { id: string } },
    input: MessageInput, observation?: { eventId: string; executionId: string }) {
    const previousPlan = await this.database.agentPlanRevision.findFirst({ where: { conversationId }, orderBy: { revision: "desc" } });
    const turnRecord = await this.database.agentTurn.findUniqueOrThrow({ where: { id: turn.turnId } });
    const storedBudget = object(turnRecord.budget);
    const initialBudget = { modelCalls: typeof storedBudget.modelCalls === "number" ? storedBudget.modelCalls : 0,
      readRounds: typeof storedBudget.readRounds === "number" ? storedBudget.readRounds : 0, repairUsed: storedBudget.repairUsed === true };
    const result = await this.coordinatorService().run({ userId, projectId, conversationId, request: input.content, referencedNodeIds: input.referencedNodeIds,
      deadlineAt: turnRecord.leaseExpiresAt?.getTime() ?? Date.now() + TURN_TIMEOUT_MS,
      trigger: observation ? "observation" : "user", previousPlan: previousPlan?.plan, initialBudget,
      reserveBudget: async (budget) => {
        await this.database.$transaction(async (tx) => {
          const held = await tx.agentConversation.updateMany({ where: { id: conversationId, intentEpoch: turn.epoch, activeTurnId: turn.lease,
            activeTurnStartedAt: { gte: new Date(Date.now() - TURN_TIMEOUT_MS) }, archivedAt: null }, data: { updatedAt: new Date() } });
          if (held.count !== 1) throw new ConflictException("本轮已被更新的用户意图替代");
          const saved = await tx.agentTurn.updateMany({ where: { id: turn.turnId, leaseToken: turn.lease, status: "running" }, data: { budget } });
          if (saved.count !== 1) throw new ConflictException("本轮预算租约已失效");
        });
      } });
    const { decision, built, visual } = result;
    if (decision.kind === "read") throw new Error("补读尚未形成最终回复");
    const memoryOperations: PatchProjectDesignContextInput["operations"] = [];
    if (!observation && decision.objectiveUpdate) memoryOperations.push({ type: "set_objective", ...decision.objectiveUpdate, origin: "explicit" });
    // Hidden intent is mined independently from durable changes, never fabricated by the planner.
    const saved = await this.database.$transaction(async (tx) => {
      const claim = await tx.agentConversation.updateMany({ where: { id: conversationId, intentEpoch: turn.epoch, activeTurnId: turn.lease,
        activeTurnStartedAt: { gte: new Date(Date.now() - TURN_TIMEOUT_MS) }, archivedAt: null },
        data: { activeTurnId: null, activeTurnStartedAt: null } });
      if (claim.count !== 1) throw new ConflictException("本轮已被更新的用户意图替代");
      const lease = await tx.agentTurn.updateMany({ where: { id: turn.turnId, status: "running", leaseToken: turn.lease }, data: { status: "committing" } });
      if (lease.count !== 1) throw new ConflictException("本轮租约已失效");
      const summary = await tx.agentContextSummary.updateMany({ where: { conversationId, revision: built.context.summaryRevision }, data: { updatedAt: new Date() } });
      if (!summary.count) throw new ConflictException("会话焦点已变化，请重新讨论");
      const state = await tx.projectDesignContext.updateMany({ where: { projectId, revision: built.context.contextRevision }, data: { updatedAt: new Date() } });
      if (!state.count) throw new ConflictException("项目上下文已变化，请重新讨论");
      await tx.workflowGraph.upsert({ where: { projectId }, create: { projectId }, update: {} });
      const graph = await tx.workflowGraph.updateMany({ where: { projectId, revision: built.graph.revision }, data: { updatedAt: new Date() } });
      if (!graph.count) throw new ConflictException("画布设计内容已更新，请重新讨论");
      const latest = await tx.agentPlanRevision.findFirst({ where: { conversationId }, orderBy: { revision: "desc" } });
      if ((latest?.revision ?? 0) !== (previousPlan?.revision ?? 0)) throw new ConflictException("协作计划已更新");
      let contextRevision = built.context.contextRevision;
      if (memoryOperations.length) contextRevision = (await this.contexts.patchInTransaction(userId, projectId, {
        baseRevision: contextRevision, mutationId: turn.lease, ...(observation ? {} : { sourceMessageId: (await tx.agentMessage.findUnique({ where: { conversationId_clientRequestId: { conversationId, clientRequestId: input.clientRequestId } } }))?.id }),
        operations: memoryOperations,
      }, tx, built.graph)).revision;
      let planRevision = latest?.revision;
      if (decision.plan) {
        planRevision = (latest?.revision ?? 0) + 1;
        await tx.agentPlanRevision.create({ data: { projectId, conversationId, revision: planRevision, turnId: turn.turnId, intentEpoch: turn.epoch,
          graphRevision: built.graph.revision, contextRevision, plan: json(decision.plan) } });
      }
      if (!observation && decision.understanding.changesTask && decision.understanding.currentStepGoal)
        await tx.agentContextSummary.update({ where: { conversationId }, data: { currentTask: decision.understanding.currentStepGoal } });
      if (!observation) await tx.agentConversation.updateMany({ where: { id: conversationId, title: "新的设计对话" }, data: { title: input.content.slice(0, 24) } });
      const proposal = decision.action ? await this.runtime.prepareAction(userId, projectId, {
        content: input.content, referencedNodeIds: [...new Set([...input.referencedNodeIds, ...built.context.focusNodeIds])],
        mutationId: turn.lease, conversationId, graphRevision: built.graph.revision, contextRevision,
        ...(planRevision === undefined ? {} : { planRevision }), action: decision.action,
      }, tx) : null;
      const data = { status: "COMPLETED" as const, role: "ASSISTANT" as const, kind: decision.kind, content: decision.message,
        turnId: turn.turnId, origin: observation ? "background_analysis" : "user", sourceEventId: observation?.eventId ?? null,
        executionId: observation?.executionId ?? null, proposalId: proposal?.id ?? null,
        context: json({ version: "workflow-message-context/2", graphRevision: built.graph.revision, contextRevision, planRevision,
          referencedNodeIds: input.referencedNodeIds, focusNodeIds: built.context.focusNodeIds, coverage: result.coverage,
          visualCoverage: visual.coverage, imageBindings: visual.imageBindings, understanding: decision.understanding, fileAssetIds: [], shapeIds: [] }) };
      const assistantMessage = turn.assistantMessage
        ? await tx.agentMessage.update({ where: { id: turn.assistantMessage.id, status: "PENDING" }, data, include: { proposal: true } })
        : await tx.agentMessage.create({ data: { ...data, conversationId }, include: { proposal: true } });
      await tx.agentTurn.update({ where: { id: turn.turnId }, data: { status: "completed", graphRevision: built.graph.revision,
        contextRevision, summaryRevision: built.context.summaryRevision, planRevision: planRevision ?? null,
        snapshots: json({ observation: result.observation, decision, reads: result.readResults }),
        budget: { modelCalls: result.calls, readRounds: result.readRounds, repairUsed: result.repairUsed }, leaseToken: null, leaseExpiresAt: null } });
      return assistantMessage;
    });
    await this.contexts.refreshSummary(userId, projectId, conversationId).catch(() => this.logger.warn("会话摘要缓存更新失败，原文和执行事实已保存"));
    return saved;
  }

  private async failTurn(conversationId: string, turn: { lease: string; turnId: string }, error: unknown, messageId?: string) {
    const record = await this.database.agentTurn.findUnique({ where: { id: turn.turnId }, select: { budget: true } });
    const budgetExhausted = Number(object(record?.budget).modelCalls ?? 0) >= MAX_PLANNER_CALLS || error instanceof Error && "code" in error && error.code === "WORKFLOW_BUDGET_EXHAUSTED";
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || "code" in error && error.code === "WORKFLOW_TURN_TIMEOUT");
    const code = budgetExhausted ? "WORKFLOW_BUDGET_EXHAUSTED" : timedOut ? "WORKFLOW_TURN_TIMEOUT" : "WORKFLOW_ASSISTANT_FAILED";
    return this.database.$transaction(async (tx) => {
      const claimed = await tx.agentConversation.updateMany({ where: { id: conversationId, activeTurnId: turn.lease }, data: { activeTurnId: null, activeTurnStartedAt: null } });
      const ended = await tx.agentTurn.updateMany({ where: { id: turn.turnId, leaseToken: turn.lease, status: { in: ["running", "committing"] } },
        data: { status: claimed.count ? "failed" : "superseded", error: error instanceof Error ? error.message.slice(0, 1000) : "处理失败", leaseToken: null, leaseExpiresAt: null } });
      if (messageId) {
        if (ended.count) await tx.agentMessage.updateMany({ where: { id: messageId, status: "PENDING" }, data: { status: "FAILED", errorCode: code,
          errorMessage: budgetExhausted ? "本轮调用次数已用尽，请发送新请求" : timedOut ? "本轮处理超时，可以重试" : error instanceof ConflictException ? error.message : "设计助手暂时无法完成请求，可以重试", content: budgetExhausted ? "本轮调用次数已用尽，请发送新请求。" : error instanceof ConflictException ? error.message : "本轮分析未完成，请重试。" } });
        return tx.agentMessage.findUniqueOrThrow({ where: { id: messageId }, include: { proposal: true } });
      }
      return null;
    });
  }

  private validateReferences(nodes: readonly { id: string }[], ids: readonly string[]) {
    if (ids.some((id) => !nodes.some((node) => node.id === id))) throw new BadRequestException("引用或焦点必须属于当前项目画布");
  }
}

type MessageRow = {
  id: string; role: AgentMessageRole; status: AgentMessageStatus; content: string; context: unknown;
  kind?: string | null; clientRequestId: string | null; replyToId: string | null; generationTaskId: string | null;
  createdAt: Date; updatedAt: Date; errorCode: string | null; errorMessage: string | null;
  origin?: string; executionId?: string | null; sourceEventId?: string | null;
  proposal?: { id: string; baseRevision: number; status: string; diff: unknown; evidence: unknown; createdAt: Date;
    schemaVersion?: number; targetNodeVersionId?: string | null; planRevision?: number | null; rejectionReason?: string | null } | null;
};
function messageView(row: MessageRow) {
  const raw = object(row.context);
  const context = Object.fromEntries(["version", "graphRevision", "contextRevision", "planRevision", "understanding", "referencedNodeIds", "focusNodeIds", "respondingToProposalId", "coverage", "visualCoverage", "imageBindings", "fileAssetIds", "shapeIds"].filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]));
  const evidence = object(row.proposal?.evidence);
  return { id: row.id, role: row.role === "USER" ? "user" : "assistant", status: row.status.toLowerCase(), content: row.content,
    kind: row.kind ?? null, context, clientRequestId: row.clientRequestId, replyToId: row.replyToId, generationTaskId: row.generationTaskId,
    origin: row.origin ?? "user", executionId: row.executionId ?? null, sourceEventId: row.sourceEventId ?? null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    error: row.errorCode ? { code: row.errorCode, message: row.errorMessage ?? "本轮处理失败" } : null,
    proposal: row.proposal ? { id: row.proposal.id, baseRevision: row.proposal.baseRevision, status: row.proposal.status, operations: row.proposal.diff,
      content: evidence.content, rationale: evidence.rationale, referencedNodeIds: evidence.referencedNodeIds, toolNodeId: evidence.toolNodeId,
      schemaVersion: row.proposal.schemaVersion ?? 1, targetNodeVersionId: row.proposal.targetNodeVersionId ?? null,
      planRevision: row.proposal.planRevision ?? null, rejectionReason: row.proposal.rejectionReason ?? null,
      action: evidence.action ?? null, preview: evidence.preview ?? null, preserve: evidence.preserve ?? [], createdAt: row.proposal.createdAt.toISOString() } : null };
}
function turnView(turn: { userMessage: MessageRow; assistantMessage: MessageRow }) {
  return { userMessage: messageView(turn.userMessage), assistantMessage: messageView(turn.assistantMessage) };
}
