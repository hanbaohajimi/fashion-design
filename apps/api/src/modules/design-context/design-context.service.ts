import { Prisma, type PrismaClient } from "@fashion/db";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { WorkflowsService } from "../workflows/workflows.service";
import {
  contextContainsQuote, contextObject, contextText, graphTrajectory, projectAttempt, projectGraphRequirements, projectNode,
  relatedNodeIds, safeContextText, stringIds, type ContextGraph,
} from "./design-context.projector";
import {
  emptyProjectDesignContext, patchProjectDesignContextSchema, projectDesignContextStateSchema,
  updateContextSummarySchema, type ContextItem, type PatchProjectDesignContextInput,
  type ProjectDesignContextState, type UpdateContextSummaryInput,
} from "./design-context.schemas";
import { mergeDialogSummary, summaryCorrectionMetadata } from "./design-context.summary";

export const DESIGN_CONTEXT_DB = Symbol("DESIGN_CONTEXT_DB");
const LIMITS = { detailedNodes: 40, nodeCharacters: 45_000, attempts: 30, attemptCharacters: 24_000, decisions: 100, decisionCharacters: 12_000, dialog: 40, dialogCharacters: 18_000, historyScan: 200, summaryCharacters: 12_000, memoryCharacters: 16_000 } as const;
type BuildOptions = { conversationId?: string; referencedNodeIds?: readonly string[]; focusNodeIds?: readonly string[] };
export interface ContextSummaryRecord {
  conversationId: string;
  summary: Prisma.JsonValue;
  throughMessageId: string | null;
  graphRevision: number;
  revision: number;
  focusNodeIds: string[];
  currentTask: string | null;
  updatedAt: Date;
}
const asJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function stateFrom(value: unknown): ProjectDesignContextState {
  const parsed = projectDesignContextStateSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException("项目设计上下文格式不完整，请从修订记录恢复");
  return parsed.data;
}

function hashRequest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Bounded retrieval never claims omitted information was inspected. */
function withinBudget<T>(values: readonly T[], budget: number): { items: T[]; omitted: number } {
  const items: T[] = [];
  let used = 0;
  for (const value of values) {
    const length = JSON.stringify(value).length;
    if (used + length > budget) continue;
    items.push(value); used += length;
  }
  return { items, omitted: values.length - items.length };
}

@Injectable()
export class DesignContextService {
  constructor(
    @Inject(DESIGN_CONTEXT_DB) private readonly database: PrismaClient,
    @Inject(WorkflowsService) private readonly workflows: WorkflowsService,
  ) {}

  async get(userId: string, projectId: string) {
    await this.assertProject(userId, projectId);
    const [current, history] = await Promise.all([
      this.database.projectDesignContext.findUnique({ where: { projectId } }),
      this.database.projectDesignContextRevision.findMany({ where: { projectId }, orderBy: { revision: "desc" }, take: 20 }),
    ]);
    return {
      projectId, revision: current?.revision ?? 0,
      state: current ? stateFrom(current.state) : emptyProjectDesignContext(),
      history: history.map((entry) => ({ revision: entry.revision, state: stateFrom(entry.state), sourceMessageId: entry.sourceMessageId, createdAt: entry.createdAt.toISOString() })),
    };
  }

  async patch(userId: string, projectId: string, raw: PatchProjectDesignContextInput) {
    const input = patchProjectDesignContextSchema.parse(raw);
    const graph = await this.workflows.get(userId, projectId);
    await this.assertProject(userId, projectId, true);
    const requestHash = hashRequest(input);
    const replay = input.mutationId ? await this.database.projectDesignContextRevision.findUnique({ where: { projectId_mutationId: { projectId, mutationId: input.mutationId } } }) : null;
    if (replay) {
      if (replay.requestHash !== requestHash) throw new ConflictException("该请求编号已用于其他设计上下文更新");
      return this.get(userId, projectId);
    }
    try {
      await this.database.$transaction((transaction) => this.patchInTransaction(userId, projectId, input, transaction, graph));
    } catch (error) {
      if (input.mutationId) {
        const committed = await this.database.projectDesignContextRevision.findUnique({ where: { projectId_mutationId: { projectId, mutationId: input.mutationId } } });
        if (committed) {
          if (committed.requestHash !== requestHash) throw new ConflictException("该请求编号已用于其他设计上下文更新");
          return this.get(userId, projectId);
        }
      }
      throw error;
    }
    return this.get(userId, projectId);
  }

  /** Caller may hold the active-turn lease; this method never starts a nested transaction. */
  async patchInTransaction(userId: string, projectId: string, raw: PatchProjectDesignContextInput, transaction: Prisma.TransactionClient, suppliedGraph?: ContextGraph) {
    const input = patchProjectDesignContextSchema.parse(raw);
    const project = await transaction.project.findFirst({ where: { id: projectId, deletedAt: null, workspace: { ownerId: userId } }, select: { id: true, archived: true } });
    if (!project) throw new NotFoundException("项目不存在或无权访问");
    if (project.archived) throw new BadRequestException("已归档项目不能修改设计上下文");
    const storedGraph = await transaction.workflowGraph.findUnique({ where: { projectId }, select: { revision: true } });
    const graph = suppliedGraph ?? {
      projectId, revision: storedGraph?.revision ?? 0,
      nodes: await transaction.workflowNode.findMany({ where: { projectId } }),
      edges: await transaction.workflowEdge.findMany({ where: { projectId } }),
    };
    if (graph.projectId !== projectId || (storedGraph?.revision ?? 0) !== graph.revision) throw new ConflictException("画布已变化，请重新确认设计上下文来源");
    const requestHash = hashRequest(input);
    const replay = input.mutationId ? await transaction.projectDesignContextRevision.findUnique({ where: { projectId_mutationId: { projectId, mutationId: input.mutationId } } }) : null;
    if (replay) {
      if (replay.requestHash !== requestHash) throw new ConflictException("该请求编号已用于其他设计上下文更新");
      const latest = await transaction.projectDesignContext.findUniqueOrThrow({ where: { projectId } });
      return { revision: latest.revision, state: stateFrom(latest.state) };
    }
    const current = await transaction.projectDesignContext.upsert({ where: { projectId }, update: {}, create: { projectId, state: asJson(this.bootstrapState(graph)) } });
    if (current.revision !== input.baseRevision) throw new ConflictException("设计上下文已变化，请刷新后重新修改");
    let state = stateFrom(current.state);
    if (input.sourceMessageId) await this.assertMessage(transaction, userId, projectId, input.sourceMessageId);
    for (const operation of input.operations) {
      if (operation.type === "set_objective") {
        if (operation.sourceQuote) await this.assertQuote(transaction, userId, projectId, operation.sourceQuote, input.sourceMessageId ?? null, [], graph);
        state = { ...state, initialObjective: state.initialObjective ?? operation.text, currentObjective: operation.text, objectiveOrigin: operation.origin, objectiveSourceMessageId: input.sourceMessageId ?? null, objectiveSourceNodeIds: [], objectiveSourceQuote: operation.sourceQuote ?? null };
      } else if (operation.type === "deactivate_item") {
        if (![...state.requirements, ...state.preferences].some((item) => item.id === operation.id)) throw new BadRequestException("待停用的上下文条目不存在");
        state = { ...state, requirements: state.requirements.map((item) => item.id === operation.id ? { ...item, status: "inactive" } : item), preferences: state.preferences.map((item) => item.id === operation.id ? { ...item, status: "inactive" } : item) };
      } else {
        const item = { ...operation.item, sourceMessageId: operation.item.sourceMessageId ?? input.sourceMessageId ?? null, priority: operation.item.origin === "inferred" ? "prefer" as const : operation.item.priority };
        for (const id of [...item.branchNodeIds, ...item.sourceNodeIds]) if (!graph.nodes.some((node) => node.id === id)) throw new BadRequestException("设计上下文引用的节点必须属于当前项目");
        if (item.sourceMessageId) await this.assertMessage(transaction, userId, projectId, item.sourceMessageId);
        if (item.sourceVersionIds?.length) {
          const versions = await transaction.workflowNodeVersion.findMany({ where: { projectId, id: { in: item.sourceVersionIds } } });
          if (versions.length !== new Set(item.sourceVersionIds).size || versions.some((version) => !item.sourceNodeIds.includes(version.nodeId))) throw new BadRequestException("偏好版本依据必须属于真实来源节点");
          const sourceQuote = item.sourceQuote;
          if (sourceQuote && !versions.some((version) => contextContainsQuote(projectNode({ id: version.nodeId, kind: version.kind, type: version.type, title: version.title, status: "version_snapshot", payload: version.payload }, true), sourceQuote))) throw new BadRequestException("偏好引文必须命中真实版本快照");
        } else if (item.sourceQuote) await this.assertQuote(transaction, userId, projectId, item.sourceQuote, item.sourceMessageId, item.sourceNodeIds, graph);
        if (item.origin === "inferred" && !item.sourceMessageId && !item.sourceNodeIds.length) throw new BadRequestException("推断偏好必须保留真实消息或节点来源");
        if (item.origin === "inferred" && state.preferences.some((entry) => entry.status === "inactive" && (entry.id === item.id || entry.text.trim() === item.text.trim() || Boolean(entry.sourceVersionIds?.length && item.sourceVersionIds?.length && item.sourceVersionIds.some((id) => entry.sourceVersionIds?.includes(id)))))) throw new BadRequestException("已停用的偏好不能由自动推断恢复，请由设计师明确更正");
        const requirements = state.requirements.filter((entry) => entry.id !== item.id);
        const preferences = state.preferences.filter((entry) => entry.id !== item.id);
        (item.kind === "requirement" ? requirements : preferences).push(item);
        state = { ...state, requirements, preferences };
      }
    }
    state = projectDesignContextStateSchema.parse(state);
    const updated = await transaction.projectDesignContext.updateMany({ where: { projectId, revision: input.baseRevision }, data: { revision: { increment: 1 }, state: asJson(state) } });
    if (!updated.count) throw new ConflictException("设计上下文已变化，请刷新后重新修改");
    await transaction.projectDesignContextRevision.create({ data: { projectId, revision: input.baseRevision + 1, state: asJson(state), sourceMessageId: input.sourceMessageId ?? null, mutationId: input.mutationId ?? null, requestHash } });
    await transaction.workflowProposal.updateMany({ where: { projectId, status: "pending", OR: [{ contextRevision: null }, { contextRevision: { not: input.baseRevision + 1 } }] }, data: { status: "superseded" } });
    return { revision: input.baseRevision + 1, state };
  }

  async build(userId: string, projectId: string, options: BuildOptions = {}) {
    const graph = await this.workflows.get(userId, projectId);
    if (options.conversationId) await this.assertConversation(userId, projectId, options.conversationId);
    const [initialStored, summary, attemptCount, recentDecisions, dialogData] = await Promise.all([
      this.database.projectDesignContext.upsert({ where: { projectId }, update: {}, create: { projectId, state: asJson(this.bootstrapState(graph)) } }),
      options.conversationId ? this.database.agentContextSummary.findUnique({ where: { conversationId: options.conversationId } }) : null,
      this.database.workflowAttempt.count({ where: { projectId } }),
      this.database.designAssetDecision.findMany({ where: { userId, asset: { projectId, archivedAt: null } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: LIMITS.decisions + 1, select: { id: true, assetId: true, kind: true, reason: true, createdAt: true } }),
      options.conversationId ? this.dialog(options.conversationId) : { messages: [], count: 0 },
    ]);
    const stored = await this.captureInitialObjective(projectId, graph, initialStored);
    const state = stored ? stateFrom(stored.state) : emptyProjectDesignContext();
    const ids = new Set(graph.nodes.map((node) => node.id));
    const references = [...new Set(options.referencedNodeIds ?? [])];
    if (references.some((id) => !ids.has(id))) throw new BadRequestException("引用节点必须属于当前画布");
    const focusNodeIds = [...new Set(options.focusNodeIds ?? (references.length ? references : summary?.focusNodeIds ?? []))].filter((id) => ids.has(id)).slice(0, 16);
    const related = relatedNodeIds(graph, focusNodeIds);
    const relatedToolIds = graph.nodes.filter((node) => node.kind === "tool" && related.has(node.id)).map((node) => node.id);
    const focusedAssetIds = new Set(graph.nodes.filter((node) => related.has(node.id)).map((node) => contextText(contextObject(node.payload).assetId, 128)).filter(Boolean));
    const [branchAttempts, recentAttempts, relatedAttemptCount, branchDecisions] = await Promise.all([
      relatedToolIds.length ? this.database.workflowAttempt.findMany({ where: { projectId, toolNodeId: { in: relatedToolIds } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: LIMITS.attempts }) : [],
      this.database.workflowAttempt.findMany({ where: { projectId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: LIMITS.attempts }),
      relatedToolIds.length ? this.database.workflowAttempt.count({ where: { projectId, toolNodeId: { in: relatedToolIds } } }) : 0,
      focusedAssetIds.size ? this.database.designAssetDecision.findMany({ where: { userId, assetId: { in: [...focusedAssetIds] }, asset: { projectId, archivedAt: null } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: LIMITS.decisions + 1, select: { id: true, assetId: true, kind: true, reason: true, createdAt: true } }) : [],
    ]);
    const attempts = [...new Map([...branchAttempts, ...recentAttempts].map((attempt) => [attempt.id, attempt])).values()];
    const decisions = [...new Map([...branchDecisions, ...recentDecisions].map((decision) => [decision.id, decision])).values()];
    const detailOrder = [...graph.nodes].sort((a, b) => Number(references.includes(b.id)) - Number(references.includes(a.id)) || Number(related.has(b.id)) - Number(related.has(a.id)) || Number(b.type === "brief" || b.type === "constraint") - Number(a.type === "brief" || a.type === "constraint"));
    const detailed = withinBudget(detailOrder.slice(0, LIMITS.detailedNodes).map((node) => projectNode(node, true)), LIMITS.nodeCharacters);
    const detailById = new Map(detailed.items.map((node) => [node.id, node]));
    const nodes = graph.nodes.map((node) => detailById.get(node.id) ?? projectNode(node, false));
    const attemptProjection = withinBudget(attempts.sort((a, b) => Number(related.has(b.toolNodeId)) - Number(related.has(a.toolNodeId))).map(projectAttempt), LIMITS.attemptCharacters);
    const applicable = (item: ContextItem) => item.status === "active" && (item.scope === "project" || item.branchNodeIds.some((id) => related.has(id)));
    const storedItems = [...state.requirements, ...state.preferences].map((item) => ({ ...item, text: safeContextText(item.text, 2_000), sourceQuote: safeContextText(item.sourceQuote, 2_000) || null }));
    const storedIds = new Set(storedItems.map((item) => item.id));
    const graphRequirements = projectGraphRequirements(graph, related, focusNodeIds.length > 0).filter((item) => !storedIds.has(item.id));
    const memory = withinBudget([...storedItems.filter(applicable), ...graphRequirements].sort((a, b) => Number(b.priority === "must") - Number(a.priority === "must")), LIMITS.memoryCharacters);
    const decisionProjection = withinBudget(decisions.slice(0, LIMITS.decisions).sort((a, b) => {
      return Number(focusedAssetIds.has(b.assetId)) - Number(focusedAssetIds.has(a.assetId));
    }).map((decision) => ({ ...decision, reason: safeContextText(decision.reason, 1_000), createdAt: decision.createdAt.toISOString() })), LIMITS.decisionCharacters);
    const projectedDecisions = decisionProjection.items;
    const orderedMessages = dialogData.messages.slice().reverse();
    const dialog = withinBudget(orderedMessages.slice(-LIMITS.dialog).map((message) => {
      const source = safeContextText(message.content, message.content.length);
      const content = safeContextText(message.content, 4_000);
      return { id: message.id, role: message.role.toLowerCase(), kind: message.kind, content,
        contentTruncated: content.length < source.length, contentCharacters: source.length,
        referencedNodeIds: stringIds(contextObject(message.context).referencedNodeIds), proposalId: message.proposalId ?? null,
        proposal: message.proposal ? { id: message.proposal.id, status: message.proposal.status, rejectionReason: safeContextText(message.proposal.rejectionReason, 1_000) || null } : null,
        createdAt: message.createdAt.toISOString() };
    }).reverse(), LIMITS.dialogCharacters).items.reverse();
    const checkpoint = summary?.throughMessageId
      ? orderedMessages.find((message) => message.id === summary.throughMessageId) ?? await this.database.agentMessage.findFirst({ where: { id: summary.throughMessageId, ...(options.conversationId ? { conversationId: options.conversationId } : {}) }, select: { id: true, createdAt: true } })
      : null;
    const historical = orderedMessages.filter((message) => !dialog.some((entry) => entry.id === message.id) && (!checkpoint || message.createdAt > checkpoint.createdAt || message.createdAt.getTime() === checkpoint.createdAt.getTime() && message.id > checkpoint.id));
    const summarized = mergeDialogSummary(summary?.summary, historical);
    const semanticMessageIds = [...new Set(summarized.semanticMemory.evidenceRefs.map((ref) => ref.messageId))];
    const includedDialogIds = new Set([...dialog.map((message) => message.id), ...summarized.sourceMessageIds, ...semanticMessageIds]);
    const goalNodes = graph.nodes.filter((node) => node.type === "brief");
    const unambiguousGoal = goalNodes.length === 1 ? contextText(contextObject(goalNodes[0]?.payload).text, 4_000) || null : null;
    const initialObjective = state.initialObjective ?? unambiguousGoal;
    const ambiguities = !state.currentObjective && goalNodes.length > 1 ? ["画布存在多个设计需求，尚未确认项目当前目标；请依据引用分支或向设计师澄清，不能擅自沿用第一条需求。"] : [];
    const context = {
      version: "design-context/1" as const, projectId, graphRevision: graph.revision, contextRevision: stored?.revision ?? 0, summaryRevision: summary?.revision ?? 0,
      initialObjective, currentObjective: state.currentObjective ?? initialObjective,
      objectiveSourceMessageId: state.objectiveSourceMessageId, objectiveSourceNodeIds: state.objectiveSourceNodeIds, objectiveSourceQuote: safeContextText(state.objectiveSourceQuote, 2_000) || null,
      objectiveOrigin: state.objectiveOrigin, currentTask: summary?.currentTask ?? null,
      goals: goalNodes.map((node) => ({ id: node.id, title: safeContextText(node.title, 120), text: safeContextText(contextObject(node.payload).text, Math.max(80, Math.floor(8_000 / Math.max(1, goalNodes.length)))) })),
      ambiguities,
      conversationId: options.conversationId ?? null, focusNodeIds, referencedNodeIds: references,
      requirements: memory.items.filter((item) => item.kind === "requirement"), preferences: memory.items.filter((item) => item.kind === "preference"),
      scopedMemory: [...state.requirements, ...state.preferences].filter((item) => item.status === "active" && item.scope === "branch").map((item) => ({ id: item.id, text: safeContextText(item.text, 300), branchNodeIds: item.branchNodeIds, applicable: applicable(item) })),
      nodes, edges: graph.edges.map(({ id, sourceNodeId, targetNodeId, sourcePort, targetPort }) => ({ id, sourceNodeId, targetNodeId, sourcePort, targetPort })),
      trajectory: graphTrajectory(graph), attempts: attemptProjection.items, decisions: projectedDecisions, dialog,
      dialogSummary: {
        text: summarized.text, sourceMessageIds: summarized.sourceMessageIds, entries: summarized.entries,
        legacyText: summarized.legacyText, legacySourceMessageIds: summarized.legacySourceMessageIds,
        omittedMessageCount: summarized.omittedMessageCount, coveredMessageCount: summarized.coveredMessageCount,
        truncatedMessageCount: summarized.truncatedMessageCount, pendingMessageCount: summarized.pendingMessageCount,
        method: summarized.method, priorThroughMessageId: summary?.throughMessageId ?? null,
        semanticMemory: summarized.semanticMemory,
      },
      coverage: {
        graph: { totalNodes: graph.nodes.length, includedNodes: nodes.length, totalEdges: graph.edges.length, includedEdges: graph.edges.length, detailedNodeIds: [...detailById.keys()], omittedDetailNodeIds: graph.nodes.filter((node) => !detailById.has(node.id)).map((node) => node.id) },
        attempts: { total: attemptCount, included: attemptProjection.items.length, omitted: attemptCount - attemptProjection.items.length, relevantTotal: relatedAttemptCount, relevantIncluded: attemptProjection.items.filter((attempt) => relatedToolIds.includes(attempt.toolNodeId)).length },
        decisions: { included: projectedDecisions.length, hasMore: decisions.length > LIMITS.decisions || decisionProjection.omitted > 0 },
        dialog: { total: dialogData.count, included: dialog.length, summarized: [...new Set([...summarized.sourceMessageIds, ...semanticMessageIds])].filter((id) => !dialog.some((message) => message.id === id)).length, semanticallyIndexed: semanticMessageIds.length, omitted: Math.max(0, dialogData.count - includedDialogIds.size), truncatedMessages: summarized.truncatedMessageCount + dialog.filter((message) => message.contentTruncated).length, truncatedMessageIds: dialog.filter((message) => message.contentTruncated).map((message) => message.id), pendingSummaryMessages: summarized.pendingMessageCount },
        memory: { included: memory.items.length, omitted: memory.omitted, graphRequirements: graphRequirements.length, includedGraphRequirements: memory.items.filter((item) => graphRequirements.some((requirement) => requirement.id === item.id)).length },
        note: "全图目录和端口关系完整；详情、历史、图片按预算读取。未包含的信息不能据此视为不存在。历史否决和分支推断不能自动成为项目级要求。",
      },
    };
    return { graph, context };
  }

  async updateSummary(userId: string, projectId: string, conversationId: string, raw: UpdateContextSummaryInput): Promise<ContextSummaryRecord> {
    const input = updateContextSummarySchema.parse(raw);
    await this.assertConversation(userId, projectId, conversationId);
    const graph = await this.workflows.get(userId, projectId);
    if (input.graphRevision !== graph.revision) throw new ConflictException("画布已变化，请重新整理会话上下文");
    if (input.focusNodeIds?.some((id) => !graph.nodes.some((node) => node.id === id))) throw new BadRequestException("会话焦点必须属于当前画布");
    for (const id of [...(input.summary?.sourceMessageIds ?? []), ...(input.throughMessageId ? [input.throughMessageId] : [])]) {
      const message = await this.database.agentMessage.findFirst({ where: { id, conversationId } });
      if (!message) throw new BadRequestException("摘要来源必须属于当前会话");
    }
    for (const evidence of input.summary?.semanticMemory?.evidenceRefs ?? []) {
      const message = await this.database.agentMessage.findFirst({ where: { id: evidence.messageId, conversationId } });
      if (!message || !message.content.includes(evidence.quote) || message.role.toLowerCase() !== evidence.role.toLowerCase()) throw new BadRequestException("语义记忆必须引用当前会话的逐字原文及真实角色");
    }
    if (input.summary?.semanticMemory) {
      const semantic = input.summary.semanticMemory;
      for (const entry of [...semantic.goalEvolution, ...semantic.rejectedUnderstandings, ...semantic.decisions, ...semantic.openQuestions]) {
        if (!entry.evidenceRefIds.length || !entry.evidenceRefIds.some((id) => semantic.evidenceRefs.some((ref) => ref.id === id && ref.quote === entry.text && ref.role.toLowerCase() === "user"))) throw new BadRequestException("语义记忆条目必须保留设计师原句，不能用助手猜测替换");
      }
    }
    return this.database.$transaction(async (transaction) => {
      const current = await transaction.agentContextSummary.upsert({ where: { conversationId }, update: {}, create: { conversationId, summary: asJson({ text: "", sourceMessageIds: [], omittedMessageCount: 0 }), graphRevision: graph.revision } });
      if (current.revision !== input.baseRevision) throw new ConflictException("会话上下文已变化，请刷新后重试");
      const result = await transaction.agentContextSummary.updateMany({ where: { conversationId, revision: input.baseRevision }, data: { revision: { increment: 1 }, graphRevision: graph.revision, ...(input.summary ? { summary: asJson({ ...input.summary, ...summaryCorrectionMetadata(current.summary) }) } : {}), ...(input.focusNodeIds ? { focusNodeIds: input.focusNodeIds } : {}), ...(input.currentTask !== undefined ? { currentTask: input.currentTask } : {}), ...(input.throughMessageId !== undefined ? { throughMessageId: input.throughMessageId } : {}) } });
      if (!result.count) throw new ConflictException("会话上下文已变化，请刷新后重试");
      return transaction.agentContextSummary.findUniqueOrThrow({ where: { conversationId } });
    });
  }

  private async dialog(conversationId: string) {
    const where = { conversationId, OR: [{ role: "USER" as const }, { status: "COMPLETED" as const }] };
    const [messages, count] = await Promise.all([
      this.database.agentMessage.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: LIMITS.historyScan, select: { id: true, role: true, kind: true, content: true, context: true, proposalId: true, proposal: { select: { id: true, status: true, rejectionReason: true } }, createdAt: true } }),
      this.database.agentMessage.count({ where }),
    ]);
    return { messages, count };
  }

  /** Invoke after committing a turn. It never changes project memory, focus or task. */
  async refreshSummary(userId: string, projectId: string, conversationId: string): Promise<{ updated: boolean; summary: ContextSummaryRecord | null }> {
    await this.assertConversation(userId, projectId, conversationId);
    const previous = await this.database.agentContextSummary.findUnique({ where: { conversationId } });
    const readable = { OR: [{ role: "USER" as const }, { status: "COMPLETED" as const }] };
    const recent = await this.database.agentMessage.findMany({ where: { conversationId, ...readable }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: LIMITS.dialog, select: { id: true, createdAt: true } });
    const boundary = recent.at(-1);
    if (!boundary || recent.length < LIMITS.dialog) return { updated: false, summary: previous };
    const cursor = previous?.throughMessageId ? await this.database.agentMessage.findFirst({ where: { id: previous.throughMessageId, conversationId }, select: { id: true, createdAt: true } }) : null;
    if (previous?.throughMessageId && !cursor) throw new ConflictException("会话摘要的来源游标已失效，请重新整理历史");
    const where = { conversationId, AND: [
      readable,
      { OR: [{ createdAt: { lt: boundary.createdAt } }, { createdAt: boundary.createdAt, id: { lt: boundary.id } }] },
      ...(cursor ? [{ OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] }] : []),
    ] };
    const [messages, eligibleCount] = await Promise.all([
      this.database.agentMessage.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: LIMITS.historyScan, select: { id: true, role: true, content: true } }),
      this.database.agentMessage.count({ where }),
    ]);
    if (!messages.length) return { updated: false, summary: previous };
    const merged = { ...mergeDialogSummary(previous?.summary, messages), pendingMessageCount: Math.max(0, eligibleCount - messages.length) };
    return this.database.$transaction(async (transaction) => {
      const current = await transaction.agentContextSummary.upsert({ where: { conversationId }, update: {}, create: { conversationId, summary: asJson({ text: "", sourceMessageIds: [], omittedMessageCount: 0 }), graphRevision: 0 } });
      if (current.revision !== (previous?.revision ?? 0)) return { updated: false, summary: current };
      const graph = await transaction.workflowGraph.findUnique({ where: { projectId }, select: { revision: true } });
      const result = await transaction.agentContextSummary.updateMany({ where: { conversationId, revision: current.revision, throughMessageId: previous?.throughMessageId ?? null }, data: { summary: asJson(merged), throughMessageId: messages.at(-1)?.id ?? null, graphRevision: graph?.revision ?? 0 } });
      return { updated: result.count === 1, summary: await transaction.agentContextSummary.findUniqueOrThrow({ where: { conversationId } }) };
    });
  }

  private bootstrapState(graph: ContextGraph): ProjectDesignContextState {
    const state = emptyProjectDesignContext();
    const briefs = graph.nodes.filter((node) => node.type === "brief");
    const brief = briefs.length === 1 ? briefs[0] : undefined;
    const objective = brief ? contextText(contextObject(brief.payload).text, 4_000) : "";
    return objective && brief ? { ...state, initialObjective: objective, currentObjective: objective, objectiveOrigin: "explicit", objectiveSourceNodeIds: [brief.id], objectiveSourceQuote: objective.slice(0, 2_000) } : state;
  }

  /** An assistant opened on an empty canvas must still remember its first unambiguous brief later. */
  private async captureInitialObjective(projectId: string, graph: ContextGraph, stored: { projectId: string; revision: number; state: Prisma.JsonValue }) {
    const state = stateFrom(stored.state);
    const initial = this.bootstrapState(graph);
    if (state.initialObjective || state.currentObjective || !initial.initialObjective) return stored;
    const next = { ...state, initialObjective: initial.initialObjective, currentObjective: initial.currentObjective,
      objectiveOrigin: initial.objectiveOrigin, objectiveSourceNodeIds: initial.objectiveSourceNodeIds, objectiveSourceQuote: initial.objectiveSourceQuote };
    return this.database.$transaction(async (transaction) => {
      const updated = await transaction.projectDesignContext.updateMany({ where: { projectId, revision: stored.revision },
        data: { state: asJson(next), revision: { increment: 1 } } });
      if (!updated.count) return transaction.projectDesignContext.findUniqueOrThrow({ where: { projectId } });
      const graphLock = await transaction.workflowGraph.updateMany({ where: { projectId, revision: graph.revision }, data: { updatedAt: new Date() } });
      if (!graphLock.count) throw new ConflictException("画布已变化，请重新读取初始设计目标");
      await transaction.projectDesignContextRevision.create({ data: { projectId, revision: stored.revision + 1, state: asJson(next),
        requestHash: hashRequest({ initialObjective: initial.initialObjective, sourceNodeIds: initial.objectiveSourceNodeIds, graphRevision: graph.revision }) } });
      await transaction.workflowProposal.updateMany({ where: { projectId, status: "pending" }, data: { status: "superseded" } });
      return { ...stored, revision: stored.revision + 1, state: asJson(next) as Prisma.JsonValue };
    });
  }

  private async assertProject(userId: string, projectId: string, writing = false) {
    const project = await this.database.project.findFirst({ where: { id: projectId, deletedAt: null, workspace: { ownerId: userId } }, select: { id: true, archived: true } });
    if (!project) throw new NotFoundException("项目不存在或无权访问");
    if (writing && project.archived) throw new BadRequestException("已归档项目不能修改设计上下文");
    return project;
  }

  private async assertConversation(userId: string, projectId: string, conversationId: string) {
    const conversation = await this.database.agentConversation.findFirst({ where: { id: conversationId, projectId, createdById: userId, project: { deletedAt: null, workspace: { ownerId: userId } } } });
    if (!conversation) throw new NotFoundException("会话不存在或不属于当前项目");
    return conversation;
  }

  private async assertMessage(database: Prisma.TransactionClient, userId: string, projectId: string, id: string) {
    const message = await database.agentMessage.findFirst({ where: { id, conversation: { projectId, createdById: userId } } });
    if (!message) throw new BadRequestException("设计上下文来源消息不属于当前项目");
    return message;
  }

  private async assertQuote(database: Prisma.TransactionClient, userId: string, projectId: string, quote: string, messageId: string | null, nodeIds: readonly string[], graph: ContextGraph) {
    const message = messageId ? await this.assertMessage(database, userId, projectId, messageId) : null;
    const texts = [message?.content ?? "", ...graph.nodes.filter((node) => nodeIds.includes(node.id)).map((node) => JSON.stringify(projectNode(node, true)))];
    if (!texts.some((text) => text.includes(quote))) throw new BadRequestException("上下文引文必须命中所引用消息或节点的真实文字");
  }
}

export type DesignContextView = Awaited<ReturnType<DesignContextService["get"]>>;
export type DesignContextSnapshot = Awaited<ReturnType<DesignContextService["build"]>>["context"];
