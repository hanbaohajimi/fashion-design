import type { PrismaClient } from "@fashion/db";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { contextObject, contextText, relatedNodeIds, safeContextText } from "./design-context.projector";
import { DESIGN_CONTEXT_DB, DesignContextService, type DesignContextSnapshot } from "./design-context.service";
import { compareVersionTime, projectVersionEpisodes, semanticVersionChanges, versionPredecessorIds } from "./information-integration.projector";

export interface IntegrationOptions {
  conversationId?: string;
  referencedNodeIds?: readonly string[];
  focusNodeIds?: readonly string[];
  built?: Awaited<ReturnType<DesignContextService["build"]>>;
  visual?: { index: unknown; coverage: unknown; images?: unknown; imageBindings?: unknown };
  tools?: readonly unknown[];
  currentStep?: unknown;
}
function bounded<T>(values: readonly T[], limit: number, compact?: (item: T) => T) {
  let used = 2, compacted = 0;
  const items: T[] = [];
  for (const value of values) {
    let item = value;
    let cost = JSON.stringify(item).length + Number(items.length > 0);
    if (used + cost > limit && compact) {
      item = compact(value); cost = JSON.stringify(item).length + Number(items.length > 0);
    }
    if (used + cost > limit) continue;
    if (item !== value) compacted += 1;
    items.push(item); used += cost;
  }
  return { items, omitted: values.length - items.length, compacted };
}
type VersionEpisode = ReturnType<typeof projectVersionEpisodes>[number];
function compactEpisode(episode: VersionEpisode): VersionEpisode {
  return { ...episode, detailsIncluded: false,
    node: { id: episode.node.id, kind: episode.node.kind, type: episode.node.type, title: episode.node.title, status: episode.node.status, detailIncluded: false },
    inputs: [], changes: [], attempts: [], decisions: [], executions: [],
    historyCoverage: { ...episode.historyCoverage,
      inputs: { ...episode.historyCoverage.inputs, included: 0, omitted: episode.historyCoverage.inputs.total },
      attempts: { ...episode.historyCoverage.attempts, included: 0, omittedForBudget: episode.historyCoverage.attempts.loadedMatches },
      decisions: { ...episode.historyCoverage.decisions, included: 0, omittedForBudget: episode.historyCoverage.decisions.loadedMatches },
      executions: { ...episode.historyCoverage.executions, included: 0, omittedForBudget: episode.historyCoverage.executions.loadedMatches },
    },
    description: `${safeContextText(episode.node.title, 120)} v${episode.version}（预算仅保留版本元数据，输入、参数变化和关联历史详情未包含；不能据此判断没有变化或没有执行）`,
  };
}
type SemanticChange = ReturnType<typeof semanticVersionChanges>[number];
function compactChange(change: SemanticChange): SemanticChange {
  return { ...change, before: { ...change.before, parameters: {}, inputs: [], content: "" }, after: { ...change.after, parameters: {}, inputs: [], content: "" }, evidenceAfter: { parameters: {}, inputs: [], content: "" }, detailsIncluded: false, detailNote: "预算仅保留发生变化的字段与真实版本来源；前后值及证据正文未包含，空字段不能解释为参数被清空。" };
}

/** Fig. 8 Information Integration: factual projections precede a single Planner. */
@Injectable()
export class InformationIntegrationService {
  constructor(
    @Inject(DESIGN_CONTEXT_DB) private readonly database: PrismaClient,
    @Inject(DesignContextService) private readonly contexts: DesignContextService,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy = new ProjectAccessPolicy(database),
  ) {}

  async integrate(userId: string, projectId: string, options: IntegrationOptions = {}) {
    // Even a supplied snapshot must pass current project access checks.
    await this.access.require(userId, projectId, "read");
    if (options.conversationId) {
      const conversation = await this.database.agentConversation.findFirst({ where: { id: options.conversationId, projectId, createdById: userId }, select: { id: true } });
      if (!conversation) throw new NotFoundException("会话不存在或不属于当前项目");
    }
    const built = options.built ?? await this.contexts.build(userId, projectId, options);
    if (built.graph.projectId !== projectId || built.context.projectId !== projectId) throw new Error("上下文快照不属于当前项目");
    const exactFocus = new Set([...(options.referencedNodeIds ?? built.context.referencedNodeIds), ...(options.focusNodeIds ?? built.context.focusNodeIds)].filter((id) => built.graph.nodes.some((node) => node.id === id)));
    const relatedFocus = exactFocus.size ? relatedNodeIds(built.graph, [...exactFocus]) : new Set<string>();
    const versionOrder = [{ graphRevision: "desc" }, { createdAt: "desc" }, { version: "desc" }, { id: "desc" }] as const;
    const [versions, versionCount, mutations, mutationCount, proposals, executions, knownVersionNodes, objectiveRevisions, focusHeads, focusVersions] = await Promise.all([
      this.database.workflowNodeVersion.findMany({ where: { projectId, graphRevision: { lte: built.graph.revision } }, orderBy: [...versionOrder], take: 201 }),
      this.database.workflowNodeVersion.count({ where: { projectId, graphRevision: { lte: built.graph.revision } } }),
      this.database.workflowMutation.findMany({ where: { projectId, resultRevision: { lte: built.graph.revision } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 101 }),
      this.database.workflowMutation.count({ where: { projectId, resultRevision: { lte: built.graph.revision } } }),
      options.conversationId ? this.database.workflowProposal.findMany({ where: { projectId, conversationId: options.conversationId, userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 101, select: { id: true, status: true, rejectionReason: true, actionFingerprint: true, createdAt: true, updatedAt: true } }) : [],
      this.database.workflowExecution.findMany({ where: { projectId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51, select: { id: true, toolNodeId: true, nodeVersionId: true, conversationId: true, status: true, expectedAttempts: true, requestSnapshot: true, completedAt: true, createdAt: true } }),
      this.database.workflowNodeVersion.findMany({ where: { projectId, graphRevision: { lte: built.graph.revision } }, distinct: ["nodeId"], select: { nodeId: true } }),
      this.database.projectDesignContextRevision.findMany({ where: { projectId, revision: { lte: built.context.contextRevision } }, orderBy: { revision: "desc" }, take: 51, select: { revision: true, state: true, sourceMessageId: true, createdAt: true } }),
      exactFocus.size ? this.database.workflowNodeVersion.findMany({ where: { projectId, graphRevision: { lte: built.graph.revision }, nodeId: { in: [...exactFocus] } }, distinct: ["nodeId"], orderBy: [...versionOrder] }) : [],
      relatedFocus.size ? this.database.workflowNodeVersion.findMany({ where: { projectId, graphRevision: { lte: built.graph.revision }, nodeId: { in: [...relatedFocus] } }, orderBy: [...versionOrder], take: 200 }) : [],
    ]);
    const pool = [...new Map([...focusHeads, ...focusVersions, ...versions.slice(0, 200)].map((version) => [version.id, version])).values()];
    const latestByNode = new Map<string, (typeof pool)[number]>();
    for (const version of pool) {
      const current = latestByNode.get(version.nodeId);
      if (!current || compareVersionTime(current, version) < 0) latestByNode.set(version.nodeId, version);
    }
    const newestRevision = pool.reduce((latest, version) => Math.max(latest, version.graphRevision), -1);
    const tier = (version: (typeof pool)[number]) => exactFocus.has(version.nodeId) && latestByNode.get(version.nodeId)?.id === version.id ? 0 : version.graphRevision === newestRevision ? 1 : relatedFocus.has(version.nodeId) ? 2 : 3;
    // Select by relevance/recency first. Chronological display ordering happens only after budgeting.
    const loadedVersions = pool.sort((a, b) => tier(a) - tier(b) || compareVersionTime(b, a)).slice(0, 200);
    const missingPredecessors = versionPredecessorIds(loadedVersions).filter((id) => !loadedVersions.some((version) => version.id === id));
    // One predecessor lookup keeps boundary changes truthful without pretending to read full history.
    const predecessors = missingPredecessors.length ? await this.database.workflowNodeVersion.findMany({ where: { projectId, graphRevision: { lte: built.graph.revision }, id: { in: missingPredecessors } } }) : [];
    const allVersions = [...new Map([...loadedVersions, ...predecessors].map((version) => [version.id, version])).values()];
    const versionIds = new Set(loadedVersions.map((version) => version.id));
    const priority = new Map(loadedVersions.map((version, index) => [version.id, index]));
    const attemptsCoverage = contextObject(built.context.coverage.attempts);
    const projected = projectVersionEpisodes(allVersions, built.context.attempts, built.context.decisions, {
      attemptsComplete: typeof attemptsCoverage.total === "number" && attemptsCoverage.total === attemptsCoverage.included && attemptsCoverage.omitted === 0,
      executions: executions.slice(0, 50), executionsComplete: executions.length <= 50,
      // Base decisions are scoped to active assets and bounded independently; absence is not proved.
      decisionsComplete: false,
    }).filter((episode) => versionIds.has(episode.nodeVersionId)).sort((a, b) => (priority.get(a.nodeVersionId) ?? 200) - (priority.get(b.nodeVersionId) ?? 200));
    const episodes = bounded(projected, 48_000, compactEpisode);
    episodes.items.sort((a, b) => a.graphRevision - b.graphRevision || a.createdAt.localeCompare(b.createdAt) || a.version - b.version || a.nodeVersionId.localeCompare(b.nodeVersionId));
    const projectedChanges = semanticVersionChanges(allVersions).filter((change) => versionIds.has(change.afterVersionId)).sort((a, b) => (priority.get(a.afterVersionId) ?? 200) - (priority.get(b.afterVersionId) ?? 200));
    const changes = bounded(projectedChanges, 24_000, compactChange);
    changes.items.sort((a, b) => a.graphRevision - b.graphRevision || a.createdAt.localeCompare(b.createdAt) || a.afterVersionId.localeCompare(b.afterVersionId));
    const mutationProjection = bounded(mutations.slice(0, 100).map((mutation) => {
      const before = contextObject(mutation.beforeSnapshot), after = contextObject(mutation.afterSnapshot);
      return { id: mutation.id, mutationId: mutation.mutationId, origin: mutation.origin, baseRevision: mutation.baseRevision, resultRevision: mutation.resultRevision,
        beforeNodeIds: (Array.isArray(before.nodes) ? before.nodes : []).map((node) => contextText(contextObject(node).id, 128)).filter(Boolean),
        afterNodeIds: (Array.isArray(after.nodes) ? after.nodes : []).map((node) => contextText(contextObject(node).id, 128)).filter(Boolean),
        beforeEdgeIds: (Array.isArray(before.edges) ? before.edges : []).map((edge) => contextText(contextObject(edge).id, 128)).filter(Boolean),
        afterEdgeIds: (Array.isArray(after.edges) ? after.edges : []).map((edge) => contextText(contextObject(edge).id, 128)).filter(Boolean),
        hasSnapshots: Boolean(mutation.beforeSnapshot && mutation.afterSnapshot), createdAt: mutation.createdAt.toISOString() };
    }), 16_000);
    const mutationFacts = mutationProjection.items;
    const objectiveHistory = objectiveRevisions.slice(0, 50).reverse().map((revision) => {
      const state = contextObject(revision.state);
      return { revision: revision.revision, currentObjective: safeContextText(state.currentObjective, 4_000) || null, sourceMessageId: revision.sourceMessageId, sourceNodeIds: Array.isArray(state.objectiveSourceNodeIds) ? state.objectiveSourceNodeIds.filter((value): value is string => typeof value === "string").slice(0, 16) : [], sourceQuote: safeContextText(state.objectiveSourceQuote, 2_000) || null, createdAt: revision.createdAt.toISOString() };
    }).filter((revision, index, all) => index === 0 || revision.currentObjective !== all[index - 1]?.currentObjective);
    const proposalDecisions = proposals.slice(0, 100).map((proposal) => ({ id: proposal.id, status: proposal.status, rejectionReason: safeContextText(proposal.rejectionReason, 1_000) || null, actionFingerprint: proposal.actionFingerprint, createdAt: proposal.createdAt.toISOString(), updatedAt: proposal.updatedAt.toISOString(), preferenceEvidence: proposal.status === "rejected" && Boolean(proposal.rejectionReason) }));
    const executionFacts = executions.slice(0, 50).map((execution) => ({ id: execution.id, toolNodeId: execution.toolNodeId, nodeVersionId: execution.nodeVersionId, conversationId: execution.conversationId, status: execution.status, expectedAttempts: execution.expectedAttempts, completedAt: execution.completedAt?.toISOString() ?? null, createdAt: execution.createdAt.toISOString(), classification: ["failed", "partial_failed", "canceled", "moderation_failed"].includes(execution.status) ? "technical_outcome" : "execution_fact" }));
    const current = contextObject(options.currentStep);
    const plan = contextObject(current.plan ?? options.currentStep);
    const context = { ...built.context, versionHistory: episodes.items, semanticChanges: changes.items, mutations: mutationFacts, proposalDecisions, executions: executionFacts, objectiveHistory };
    const coverage = {
      ...built.context.coverage,
      versionHistory: {
        total: versionCount, included: episodes.items.length, omitted: Math.max(0, versionCount - episodes.items.length),
        selectedVersions: loadedVersions.length, retrievedVersions: new Set([...pool, ...predecessors].map((version) => version.id)).size,
        missingHistoryNodeIds: built.graph.nodes.filter((node) => !knownVersionNodes.some((version) => version.nodeId === node.id)).map((node) => node.id),
        notLoadedNodeIds: built.graph.nodes.filter((node) => knownVersionNodes.some((version) => version.nodeId === node.id) && ![...pool, ...predecessors].some((version) => version.nodeId === node.id)).map((node) => node.id),
        notProjectedNodeIds: built.graph.nodes.filter((node) => knownVersionNodes.some((version) => version.nodeId === node.id) && !episodes.items.some((episode) => episode.nodeId === node.id)).map((node) => node.id),
        omittedVersionIds: loadedVersions.filter((version) => !episodes.items.some((episode) => episode.nodeVersionId === version.id)).map((version) => version.id),
        metadataOnlyVersions: episodes.compacted, metadataOnlyVersionIds: episodes.items.filter((episode) => !episode.detailsIncluded).map((episode) => episode.nodeVersionId),
        requestedPredecessorVersionIds: missingPredecessors, missingPredecessorVersionIds: missingPredecessors.filter((id) => !predecessors.some((version) => version.id === id)),
        omittedEpisodeDetails: episodes.omitted, omittedChangeDetails: changes.omitted, metadataOnlyChanges: changes.compacted,
        selection: "focus_latest_then_latest_revision_then_focus_branch_then_recent",
      },
      mutations: { total: mutationCount, included: mutationFacts.length, omitted: Math.max(0, mutationCount - mutationFacts.length) },
      objectiveHistory: { included: objectiveHistory.length, hasMore: objectiveRevisions.length > 50 },
      proposalDecisions: { included: proposalDecisions.length, hasMore: proposals.length > 100 },
      executions: { included: executionFacts.length, hasMore: executions.length > 50 },
      visual: options.visual?.coverage ?? { status: "not_loaded", note: "图片未读取，不得声称已观察图片内容" },
      historyNote: "历史按焦点、最近变更和预算读取。空的执行尝试、执行分组或人工决定只表示已读范围没有匹配记录，不能声称从未发生；detailsIncluded=false表示仅保留版本元数据。资产决定是带时间的资产事件，不代表节点版本创建时的决定状态。",
    };
    const slots = {
      initialGoal: { initialObjective: context.initialObjective, currentObjective: context.currentObjective, objectiveOrigin: context.objectiveOrigin, objectiveHistory, requirements: context.requirements, ambiguities: context.ambiguities },
      currentStepGoal: { currentTask: context.currentTask, focusNodeIds: context.focusNodeIds, referencedNodeIds: context.referencedNodeIds, plan: Object.keys(plan).length ? plan : null, note: "会话任务和当前步骤目标不能替代项目设计目标" },
      designTrajectory: { nodes: context.nodes, edges: context.edges, trajectory: context.trajectory, episodes: episodes.items, semanticChanges: changes.items, mutations: mutationFacts, attempts: context.attempts, executions: executionFacts, decisions: context.decisions, visualIndex: options.visual?.index ?? [], visualCoverage: coverage.visual, historyCoverage: coverage.versionHistory, historyNote: coverage.historyNote },
      dialogue: { messages: context.dialog, summary: context.dialogSummary, proposalDecisions, note: "最新提案状态和拒绝理由是事实；没有理由的跳过不能形成偏好" },
      implicitIntent: { preferences: context.preferences, scopedMemory: context.scopedMemory, note: "推断仅为有来源的分支偏好，不是项目硬约束；停用记录禁止自动恢复" },
      toolInformation: { tools: options.tools ?? [], selection: "complete_catalog", note: "当前四类工具全量提供；参数能力以合法工具契约为准" },
    };
    return { graph: built.graph, context: { ...context, coverage }, slots, coverage };
  }
}

export type IntegratedDesignContext = Awaited<ReturnType<InformationIntegrationService["integrate"]>>;
export type IntegratedContextSnapshot = DesignContextSnapshot & IntegratedDesignContext["context"];
