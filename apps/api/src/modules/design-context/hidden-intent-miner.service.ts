import type { AmuxClaudeJsonClient } from "@fashion/ai";
import type { PrismaClient } from "@fashion/db";
import { ConflictException, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { z } from "zod";
import { AMUX_CLAUDE_CLIENT } from "../ai/ai.tokens";
import { contextContainsQuote, contextObject, contextText, safeContextText } from "./design-context.projector";
import { DESIGN_CONTEXT_DB, DesignContextService } from "./design-context.service";
import { projectVersionInputs, semanticVersionChanges, versionParent, versionPredecessorIds, type NodeVersionFact } from "./information-integration.projector";

const minedPreferencesSchema = z.object({ preferences: z.array(z.object({
  text: z.string().trim().min(1).max(1_000),
  evidence: z.array(z.object({ versionId: z.string().min(1).max(128), quote: z.string().trim().min(1).max(1_000) }).strict()).min(2).max(8),
}).strict()).max(5) }).strict();
export interface IntentMiningTrigger { executionId?: string; eventId?: string }
export interface IntentMiningResult { status: "created" | "skipped" | "stale" | "failed"; createdPreferenceIds: string[]; evidenceVersionIds: string[]; reason?: string }
const normalize = (value: string) => value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 40);

/** Independent Fig. 8 intention mining. Its failure never changes the committed execution facts. */
@Injectable()
export class HiddenIntentMiner {
  private readonly logger = new Logger(HiddenIntentMiner.name);
  constructor(
    @Inject(DESIGN_CONTEXT_DB) private readonly database: PrismaClient,
    @Inject(DesignContextService) private readonly contexts: DesignContextService,
    @Optional() @Inject(AMUX_CLAUDE_CLIENT) private readonly model?: AmuxClaudeJsonClient,
  ) {}

  async processChanges(userId: string, projectId: string, trigger: IntentMiningTrigger = {}): Promise<IntentMiningResult> {
    const skipped = (reason: string): IntentMiningResult => ({ status: "skipped", createdPreferenceIds: [], evidenceVersionIds: [], reason });
    try {
      if (!this.model) return skipped("model_unavailable");
      const project = await this.database.project.findFirst({ where: { id: projectId, deletedAt: null, archived: false, workspace: { ownerId: userId } }, select: { id: true } });
      if (!project) return skipped("project_unavailable");
      const foreground = await this.database.agentTurn.findFirst({ where: { projectId, userId, trigger: "user", status: { in: ["running", "committing"] }, leaseExpiresAt: { gt: new Date() } }, select: { id: true } });
      if (foreground) return skipped("foreground_user_turn_has_priority");
      let anchorNodeId: string | null = null;
      let anchorVersionId: string | null = null;
      if (trigger.executionId) {
        const execution = await this.database.workflowExecution.findFirst({ where: { id: trigger.executionId, projectId, userId } });
        if (!execution || !["completed", "succeeded"].includes(execution.status)) return skipped("technical_outcome_is_not_aesthetic_evidence");
        anchorNodeId = execution.toolNodeId;
        anchorVersionId = execution.nodeVersionId;
        if (!anchorVersionId) return skipped("execution_version_missing");
      }
      if (trigger.eventId) {
        const event = await this.database.workflowOutbox.findFirst({ where: { projectId, OR: [{ id: trigger.eventId }, { eventKey: trigger.eventId }] } });
        if (!event || !["workflow.semantic_changed", "execution.terminal"].includes(event.eventType)) return skipped("unsupported_event");
        const origin = contextText(contextObject(event.payload).origin, 40);
        if (event.eventType === "workflow.semantic_changed" && origin && !["user", "proposal"].includes(origin)) return skipped("non_user_semantic_change");
        if (event.eventType === "execution.terminal" && !trigger.executionId) return skipped("execution_identity_required");
      }
      const { graph } = await this.contexts.build(userId, projectId);
      const profile = await this.contexts.get(userId, projectId);
      const intentSnapshot = await this.database.agentConversation.findMany({ where: { projectId, createdById: userId, mode: "workflow" }, orderBy: { id: "asc" }, select: { id: true, intentEpoch: true } });
      const recent = await this.database.workflowNodeVersion.findMany({ where: { projectId, graphRevision: { lte: graph.revision } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 120 });
      const missing = [...new Set([...versionPredecessorIds(recent), ...(anchorVersionId ? [anchorVersionId] : [])])].filter((id) => !recent.some((version) => version.id === id));
      const predecessors = missing.length ? await this.database.workflowNodeVersion.findMany({ where: { projectId, graphRevision: { lte: graph.revision }, id: { in: missing } } }) : [];
      const versions = [...recent, ...predecessors];
      const graphIds = new Set(graph.nodes.map((node) => node.id));
      const changes = semanticVersionChanges(versions).filter((change) => graphIds.has(change.nodeId));
      const anchorVersion = anchorVersionId ? versions.find((version) => version.id === anchorVersionId && version.nodeId === anchorNodeId && version.projectId === projectId) : undefined;
      const anchorVersions = anchorVersion ? this.causalVersionIds(anchorVersion, versions) : null;
      const eligible = anchorNodeId ? changes.filter((change) => anchorVersions?.has(change.afterVersionId)) : changes;
      if (eligible.length < 2) return skipped("two_semantic_changes_required");
      const active = profile.state.preferences.filter((item) => item.status === "active");
      const inactive = profile.state.preferences.filter((item) => item.status === "inactive");
      const response = await this.model.generateJson({
        schemaName: "fashion_hidden_intent_mining", jsonSchema: z.toJSONSchema(minedPreferencesSchema), maxTokens: 2_000,
        instructions: "你是设计过程的隐含意图挖掘器，不是Planner。只依据至少两次真实人工确认的输入或参数变化，归纳同一因果分支中反复出现的偏好。每条推断引用不同afterVersionId及该变化evidenceAfter中的逐字quote；数字和布尔值用原始字符串表示。未变化的参数不是新证据。禁止从布局、系统填充、技术失败、取消、审核失败推断审美；禁止把推断变成硬要求；不能恢复已停用偏好（包括换一种说法）。无充分证据返回preferences:[]。",
        prompt: JSON.stringify({ semanticChanges: eligible.slice(-60), activePreferences: active, inactivePreferences: inactive, scope: "branch_only", sourceAuthority: "immutable_node_versions" }),
        parse: (value) => minedPreferencesSchema.parse(value),
      });
      const byChangeId = new Map(eligible.map((change) => [change.afterVersionId, change]));
      const byVersionId = new Map(versions.map((version) => [version.id, version]));
      const operations: Parameters<DesignContextService["patch"]>[2]["operations"] = [];
      const createdPreferenceIds: string[] = [], evidenceVersionIds = new Set<string>();
      for (const preference of response.preferences) {
        const evidence = [...new Map(preference.evidence.map((item) => [item.versionId, item])).values()];
        if (evidence.length < 2 || evidence.some((item) => {
          const change = byChangeId.get(item.versionId);
          return !change || !contextContainsQuote(change.evidenceAfter, item.quote);
        })) continue;
        const evidenceVersions = evidence.map((item) => byVersionId.get(item.versionId)).filter((value) => value !== undefined);
        const latest = [...evidenceVersions].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        if (!latest || !this.sameBranch(evidenceVersions, latest, versions)) continue;
        const sourceVersionIds = evidence.map((item) => item.versionId);
        if ([...active, ...inactive].some((item) => normalize(item.text) === normalize(preference.text) || item.sourceVersionIds?.some((id) => sourceVersionIds.includes(id)))) continue;
        const sourceNodeIds = [...new Set(evidenceVersions.map((version) => version.nodeId))];
        const sourceQuote = evidence.find((item) => item.versionId === latest.id)?.quote;
        if (!sourceQuote) continue;
        const id = `intent_${digest({ text: normalize(preference.text), sourceVersionIds: [...sourceVersionIds].sort() })}`;
        operations.push({ type: "upsert_item", item: { id, kind: "preference", text: safeContextText(preference.text, 1_000), origin: "inferred", priority: "prefer", status: "active", scope: "branch", branchNodeIds: [latest.nodeId], sourceNodeIds, sourceVersionIds, sourceMessageId: null, sourceQuote } });
        createdPreferenceIds.push(id); sourceVersionIds.forEach((id) => evidenceVersionIds.add(id));
      }
      if (!operations.length) return skipped("no_verified_new_preference");
      const latestGraph = await this.database.workflowGraph.findUnique({ where: { projectId }, select: { revision: true } });
      if (latestGraph?.revision !== graph.revision) return { status: "stale", createdPreferenceIds: [], evidenceVersionIds: [], reason: "graph_changed_during_mining" };
      const latestIntent = await this.database.agentConversation.findMany({ where: { projectId, createdById: userId, mode: "workflow" }, orderBy: { id: "asc" }, select: { id: true, intentEpoch: true } });
      if (JSON.stringify(latestIntent) !== JSON.stringify(intentSnapshot)) return { status: "stale", createdPreferenceIds: [], evidenceVersionIds: [], reason: "user_intent_changed_during_mining" };
      await this.database.$transaction(async (transaction) => {
        // Conversation -> context -> graph follows the same lock order as Coordinator commits.
        for (const conversation of intentSnapshot) {
          const locked = await transaction.agentConversation.updateMany({ where: { id: conversation.id, projectId, createdById: userId, intentEpoch: conversation.intentEpoch, activeTurnId: null }, data: { updatedAt: new Date() } });
          if (!locked.count) throw new ConflictException("用户意图已变化，舍弃旧偏好推断");
        }
        const lockedIntent = await transaction.agentConversation.findMany({ where: { projectId, createdById: userId, mode: "workflow" }, orderBy: { id: "asc" }, select: { id: true, intentEpoch: true } });
        if (JSON.stringify(lockedIntent) !== JSON.stringify(intentSnapshot)) throw new ConflictException("用户意图已变化，舍弃旧偏好推断");
        await this.contexts.patchInTransaction(userId, projectId, { baseRevision: profile.revision, mutationId: `hidden-intent:${digest({ event: trigger.eventId ?? trigger.executionId ?? null, createdPreferenceIds })}`, operations }, transaction, graph);
        const lockedGraph = await transaction.workflowGraph.updateMany({ where: { projectId, revision: graph.revision }, data: { updatedAt: new Date() } });
        if (!lockedGraph.count) throw new ConflictException("画布已变化，舍弃旧偏好推断");
      });
      return { status: "created", createdPreferenceIds, evidenceVersionIds: [...evidenceVersionIds] };
    } catch (error) {
      const stale = error instanceof Error && /上下文已变化|画布已变化|意图已变化|停用的偏好/iu.test(error.message);
      if (!stale) this.logger.warn(`隐含意图挖掘未完成：${error instanceof Error ? error.name : "unknown"}`);
      return { status: stale ? "stale" : "failed", createdPreferenceIds: [], evidenceVersionIds: [], reason: stale ? "context_changed_during_mining" : "mining_failed" };
    }
  }

  private sameBranch(evidence: readonly NodeVersionFact[], latest: NodeVersionFact, versions: readonly NodeVersionFact[]): boolean {
    const causalVersions = this.causalVersionIds(latest, versions);
    return evidence.every((version) => causalVersions.has(version.id));
  }

  private causalVersionIds(latest: NodeVersionFact, versions: readonly NodeVersionFact[]): Set<string> {
    const versionMap = new Map(versions.map((version) => [version.id, version]));
    const pending = [latest];
    const seen = new Set<string>();
    while (pending.length) {
      const current = pending.pop();
      if (!current) continue;
      if (seen.has(current.id)) continue;
      seen.add(current.id);
      for (const input of projectVersionInputs(current.inputBindings)) {
        const source = input.sourceNodeVersionId ? versionMap.get(input.sourceNodeVersionId) : undefined;
        if (source && source.projectId === current.projectId && source.nodeId === input.sourceNodeId) pending.push(source);
      }
      const previous = versionParent(current, versionMap);
      if (previous) pending.push(previous);
    }
    return seen;
  }
}
