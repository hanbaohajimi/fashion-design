import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { ImageTransformQueue } from "./image-transform-queue.service";
import { requireProjectFile } from "../files/project-file-access";
import { FileStatus, Prisma, appendWorkflowOutbox, appendGenerationTerminalOutbox, ensureWorkflowNodeVersions, type PrismaClient, type WorkflowProposal } from "@fashion/db";
import { AmuxClaudeVlmClassifier, type AmuxClaudeImageInput, type AmuxClaudeJsonClient } from "@fashion/ai";
import type { AgentDesignBrief, AgentDesignEvidence, VlmRoleLabel } from "@fashion/shared";
import { imageFeedbackSchema, readSwatchColors, workflowInputConnectionError, getWorkflowToolCatalog, parseWorkflowToolParameters, workflowToolKeySchema } from "@fashion/shared";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { AMUX_CLAUDE_CLIENT } from "../ai/ai.tokens";
import { FashionAgentFramework } from "../agent-runs/fashion-agent-framework";
import { DesignContextService } from "../design-context/design-context.service";
import { S3FileStorage } from "../files/storage.service";
import { GenerationService } from "../generation/generation.service";
import {
  generationCreateRequestSchema,
  type GenerationCreateRequest,
} from "../generation/generation.schemas";
import { DesignAssetsService } from "../design-assets/design-assets.service";
import { WorkflowsService } from "../workflows/workflows.service";
import {
  workflowSemanticPatchSchema,
  type WorkflowSemanticPatchInput,
} from "../workflows/workflows.schemas";
import type {
  WorkflowExecuteRequest,
  WorkflowNodeDecision,
  WorkflowProposalDecision,
  WorkflowProposalRequest,
  WorkflowRoleInferenceRequest,
  WorkflowRejectRequest,
} from "./workflow-runtime.schemas";
import { compileWorkflowProposal, compileWorkflowAction, workflowActionFingerprint, type WorkflowAction, type WorkflowToolPlan } from "./workflow-planner";
import { WorkflowCoordinator } from "./workflow-coordinator";

import { WORKFLOW_RUNTIME_DB } from "./workflow-runtime.tokens";
export { WORKFLOW_RUNTIME_DB } from "./workflow-runtime.tokens";
type Graph = Awaited<ReturnType<WorkflowsService["get"]>>;
type Node = Graph["nodes"][number];
type Operation = WorkflowSemanticPatchInput["operations"][number];
export interface WorkflowProposalView {
  id: string; baseRevision: number; contextRevision: number | null; schemaVersion: number;
  targetNodeVersionId: string | null; planRevision: number | null; rejectionReason: string | null;
  status: string; operations: Prisma.JsonValue; rationale: unknown; toolNodeId: unknown; referencedNodeIds: unknown;
  action: unknown; preview: unknown; preserve: unknown; createdAt: Date;
}
type SyncedGraph = Graph & { proposals: WorkflowProposalView[] };
const ACTIVE_ATTEMPT_STATUSES = ["submitting", "running"];
const ROLE_INFERENCE_LEASE_MS = 15 * 60_000;
const ROLE_INFERENCE_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const WORKFLOW_NODE_WIDTH = 258;
const WORKFLOW_NODE_GAP = 40;
const MAX_LAYOUT_SLOT_CHECKS = 300;
const ROLE_BY_LABEL: Readonly<Record<VlmRoleLabel, "style_ref" | "silhouette_ref" | "detail_ref" | "fabric_texture" | "palette_ref">> = {
  color_palette: "palette_ref",
  fabric_texture: "fabric_texture",
  fashion_sketch: "silhouette_ref",
  garment_detail: "detail_ref",
  garment_photo: "style_ref",
  non_fashion: "style_ref",
  other_fashion: "style_ref",
  silhouette: "silhouette_ref",
};
const REFERENCE_ROLES = new Set(["style_ref", "silhouette_ref", "detail_ref", "fabric_texture", "palette_ref"]);

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
function nodeText(node: Node): string {
  const payload = object(node.payload);
  const brief = object(payload.brief);
  const params = object(payload.params);
  const constraints = Array.isArray(brief.constraints)
    ? brief.constraints.map((value) => { const constraint = object(value); return `${text(constraint.mode)}: ${text(constraint.requirement)}`; }).join("\n")
    : "";
  const palette = node.type === "swatch"
    ? readSwatchColors(payload, node.title).map((color) => `${color.name}: ${color.hex}`).join("\n")
    : text(payload.color);
  return [node.title, text(payload.text), text(brief.summary), constraints, palette, text(params.prompt), text(payload.rationale)]
    .filter(Boolean)
    .join("\n");
}
function incoming(graph: Graph, node: Node): Node[] {
  const ids = new Set(
    graph.edges
      .filter((edge) => edge.targetNodeId === node.id)
      .map((edge) => edge.sourceNodeId),
  );
  return graph.nodes.filter((item) => ids.has(item.id));
}

/** Cognition is limited to this candidate's ancestry; selected brief remains the sole check contract. */
export function projectCandidateEvaluationContext(
  built: Awaited<ReturnType<DesignContextService["build"]>>, candidate: Node, constraint: Node,
) {
  const upstream = (start: string) => {
    const ids = new Set([start]);
    const pending = [start];
    while (pending.length) {
      const current = pending.pop();
      for (const edge of built.graph.edges) {
        if (edge.targetNodeId === current && !ids.has(edge.sourceNodeId)) {
          ids.add(edge.sourceNodeId); pending.push(edge.sourceNodeId);
        }
      }
    }
    return ids;
  };
  const ancestors = upstream(candidate.id);
  const historyIds = new Set([...ancestors, ...upstream(constraint.id)]);
  const assetIds = new Set(built.graph.nodes.filter((item) => ancestors.has(item.id) && item.type === "candidate")
    .map((item) => text(object(item.payload).assetId)).filter(Boolean));
  const history = built.context.attempts.filter((attempt) => historyIds.has(attempt.toolNodeId));
  const decisions = built.context.decisions.filter((decision) => assetIds.has(decision.assetId));
  const preferences = built.context.preferences.filter((preference) => preference.status === "active" &&
    preference.scope === "branch" && preference.branchNodeIds.some((id) => ancestors.has(id)));
  return { version: "evaluation-context/1", graphRevision: built.context.graphRevision,
    contextRevision: built.context.contextRevision, candidateNodeId: candidate.id, constraintNodeId: constraint.id,
    history, decisions, preferences,
    coverage: { includedAttempts: history.length, includedDecisions: decisions.length, includedPreferences: preferences.length,
      source: { attempts: built.context.coverage.attempts, decisions: built.context.coverage.decisions, memory: built.context.coverage.memory },
      note: "仅供理解此候选产生与被选择/否决的过程；缺失历史不代表未发生。评价条件仅来自显式连接的冻结brief，辅助偏好不能成为硬条件。" },
  };
}


function persistedGenerationModel(task: { output: unknown; providerJob?: unknown }): string | undefined {
  return text(object(object(task.output).job).model) || text(object(task.providerJob).model) || undefined;
}

function roleFrozen(graph: Graph, node: Node): boolean {
  return node.status !== "ready" || graph.edges.some((edge) => edge.sourceNodeId === node.id && graph.nodes.some((target) => target.id === edge.targetNodeId && target.kind === "tool" && target.status !== "ready"));
}
function roleResolved(node: Node): boolean {
  const payload = object(node.payload);
  return payload.roleSource === "manual" || (payload.roleSource === "inferred" && payload.roleInferenceState === "ready");
}
function nodeHeight(node: Pick<Node, "kind" | "type">): number {
  if (node.type === "candidate" || node.type === "reference_image" || node.type === "sketch") return 300;
  if (node.type === "constraint" || node.type === "evaluation") return 236;
  return node.kind === "tool" ? 206 : 210;
}
function availableNodePosition(
  graph: Graph,
  pending: readonly Operation[],
  node: Pick<Node, "kind" | "type">,
  preferredX: number,
  preferredY: number,
): { x: number; y: number } {
  const x = Math.max(40, Math.round(preferredX));
  let y = Math.max(40, Math.round(preferredY));
  const height = nodeHeight(node);
  const occupied = [...graph.nodes, ...pending.flatMap((operation) => operation.type === "add_node" ? [operation.node] : [])];
  const sameTrack = occupied.filter((other) => x < other.x + WORKFLOW_NODE_WIDTH + WORKFLOW_NODE_GAP && x + WORKFLOW_NODE_WIDTH + WORKFLOW_NODE_GAP > other.x);
  for (let slot = 0; slot < MAX_LAYOUT_SLOT_CHECKS; slot++) {
    const collision = sameTrack.find((other) => y < other.y + nodeHeight(other) + WORKFLOW_NODE_GAP && y + height + WORKFLOW_NODE_GAP > other.y);
    if (!collision) return { x, y };
    y = Math.max(y + 1, collision.y + nodeHeight(collision) + WORKFLOW_NODE_GAP);
  }
  return { x, y: Math.max(y, ...sameTrack.map((other) => other.y + nodeHeight(other) + WORKFLOW_NODE_GAP)) };
}

@Injectable()
export class WorkflowRuntimeService {
  constructor(
    @Inject(WORKFLOW_RUNTIME_DB) private readonly database: PrismaClient,
    @Inject(WorkflowsService) private readonly workflows: WorkflowsService,
    @Inject(GenerationService) private readonly generation: GenerationService,
    @Inject(AMUX_CLAUDE_CLIENT) private readonly model: AmuxClaudeJsonClient,
    @Inject(S3FileStorage) private readonly storage: S3FileStorage,
    @Inject(DesignAssetsService) private readonly assets: DesignAssetsService,
    @Optional() @Inject(DesignContextService) private readonly contexts?: DesignContextService,
    @Optional() @Inject(WorkflowCoordinator) private readonly coordinator?: WorkflowCoordinator,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy = new ProjectAccessPolicy(database),
    @Optional() @Inject(ImageTransformQueue) private readonly transforms?: ImageTransformQueue,
  ) {}

  async toolCatalog(userId: string, projectId: string) {
    await this.workflows.get(userId, projectId);
    const project = await this.database.project.findUniqueOrThrow({ where: { id: projectId }, select: { workflowAgentVersion: true } });
    return { agentVersion: project.workflowAgentVersion, tools: getWorkflowToolCatalog() };
  }

  async setAgentVersion(userId: string, projectId: string, version: 1 | 2) {
    await this.access.require(userId, projectId, "edit");
    await this.workflows.get(userId, projectId);
    await this.database.$transaction(async (tx) => {
      await this.access.require(userId, projectId, "edit", tx);
      await tx.agentConversation.updateMany({ where: { projectId }, data: { intentEpoch: { increment: 1 } } });
      const changed = await tx.project.updateMany({ where: { id: projectId, deletedAt: null, archived: false }, data: { workflowAgentVersion: version } });
      if (!changed.count) throw new BadRequestException("项目不可修改");
      await tx.workflowProposal.updateMany({ where: { projectId, schemaVersion: 2, status: "pending" }, data: { status: "superseded" } });
    });
    return this.toolCatalog(userId, projectId);
  }

  /** Prepare a model-selected, validated proposal without running a tool. */
  async prepareProposal(userId: string, projectId: string, input: {
    content: string; referencedNodeIds: string[]; mutationId: string;
    conversationId: string; graphRevision: number; contextRevision: number;
    plan: WorkflowToolPlan;
  }, transaction?: Prisma.TransactionClient): Promise<WorkflowProposal> {
    await this.access.require(userId, projectId, "edit", transaction);
    const graph: Graph = transaction ? {
      projectId, revision: (await transaction.workflowGraph.findUnique({ where: { projectId } }))?.revision ?? 0,
      layoutRevision: 0, legacyAvailable: false,
      nodes: await transaction.workflowNode.findMany({ where: { projectId } }),
      edges: await transaction.workflowEdge.findMany({ where: { projectId } }),
    } : await this.workflows.get(userId, projectId);
    if (graph.revision !== input.graphRevision) throw new ConflictException("画布已变化，请重新讨论本次建议");
    const operations = compileWorkflowProposal(graph, input.plan, input.referencedNodeIds);
    const toolNodeId = operations.find((operation) => operation.type === "add_node" && operation.node.kind === "tool");
    return (transaction ?? this.database).workflowProposal.create({ data: {
      projectId, userId, baseRevision: graph.revision, contextRevision: input.contextRevision,
      conversationId: input.conversationId, mutationId: input.mutationId, status: "pending",
      diff: json(operations), evidence: json({ content: input.content, referencedNodeIds: input.referencedNodeIds,
        rationale: input.plan.rationale, toolNodeId: toolNodeId?.type === "add_node" ? toolNodeId.node.id : null }),
    } });
  }

  /** Compatibility endpoint delegates to the same planner; a discussion never fabricates a tool. */
  async propose(userId: string, projectId: string, input: WorkflowProposalRequest): Promise<WorkflowProposalView> {
    await this.access.require(userId, projectId, "edit");
    const replay = await this.database.workflowProposal.findUnique({ where: { projectId_mutationId: { projectId, mutationId: input.mutationId } } });
    if (replay) {
      const evidence = object(replay.evidence);
      if (replay.userId !== userId || evidence.content !== input.content || JSON.stringify(evidence.referencedNodeIds) !== JSON.stringify(input.referencedNodeIds))
        throw new ConflictException("该请求编号已用于其他工作流建议");
      return this.proposalView(replay);
    }
    if (!this.coordinator) throw new BadRequestException("请使用持续设计助手；旧关键词规划入口已停用");
    const result = await this.coordinator.run({ userId, projectId, request: input.content, referencedNodeIds: input.referencedNodeIds });
    if (!result.decision.action) throw new BadRequestException({ code: "NO_TOOL_ACTION", message: result.decision.message });
    return this.proposalView(await this.prepareAction(userId, projectId, {
      content: input.content, referencedNodeIds: input.referencedNodeIds, mutationId: input.mutationId,
      graphRevision: result.built.graph.revision, contextRevision: result.built.context.contextRevision, action: result.decision.action,
    }));
  }

  async prepareAction(userId: string, projectId: string, input: {
    content: string; referencedNodeIds: string[]; mutationId: string; conversationId?: string;
    graphRevision: number; contextRevision: number; planRevision?: number; action: WorkflowAction;
  }, suppliedTransaction?: Prisma.TransactionClient): Promise<WorkflowProposal> {
    if (!suppliedTransaction) return this.database.$transaction((tx) => this.prepareAction(userId, projectId, input, tx));
    const tx = suppliedTransaction;
    await this.access.require(userId, projectId, "edit", tx);
    const project = await tx.project.findFirst({ where: { id: projectId, deletedAt: null, archived: false } });
    if (!project) throw new NotFoundException("项目不存在或不可修改");
    if (project.workflowAgentVersion !== 2) throw new BadRequestException("当前项目已暂停新版设计协作");
    const graph: Graph = { projectId, revision: (await tx.workflowGraph.findUnique({ where: { projectId } }))?.revision ?? 0,
      layoutRevision: 0, legacyAvailable: false, nodes: await tx.workflowNode.findMany({ where: { projectId } }), edges: await tx.workflowEdge.findMany({ where: { projectId } }) };
    if (graph.revision !== input.graphRevision) throw new ConflictException("画布已变化，请重新讨论本次建议");
    const versions = await ensureWorkflowNodeVersions(tx, projectId, graph.revision, graph.nodes, graph.edges);
    const attempts = await tx.workflowAttempt.groupBy({ by: ["toolNodeId"], where: { projectId }, _count: true });
    const eligibility = Object.fromEntries([...versions].map(([id, version]) => [id, { nodeVersionId: version.id, copiedSnapshot: version.origin === "project_copy" && version.baseline, attemptCount: attempts.find((row) => row.toolNodeId === id)?._count ?? 0 }]));
    const operations = compileWorkflowAction(graph, input.action, input.referencedNodeIds, eligibility);
    const parameterOperation = operations.find((operation) => operation.type === "update_node" || operation.type === "add_node" && operation.node.kind === "tool");
    const compiledParameters = parameterOperation?.type === "update_node" ? object(parameterOperation.payload).params
      : parameterOperation?.type === "add_node" ? object(parameterOperation.node.payload).params : input.action.parameters;
    const actionFingerprint = workflowActionFingerprint({ ...input.action, parameters: object(compiledParameters) });
    const declined = await tx.workflowProposal.findFirst({ where: { projectId, ...(input.conversationId ? { conversationId: input.conversationId } : {}), status: "rejected", actionFingerprint } });
    if (declined) throw new BadRequestException("这项相同动作已被跳过，请明确改变参数或修改范围后再建议");
    const toolOperation = operations.find((operation) => operation.type === "add_node" && operation.node.kind === "tool");
    const target = graph.nodes.find((node) => node.id === input.action.targetNodeId);
    const configured = operations.find((operation) => operation.type === "update_node" && operation.nodeId === target?.id);
    const afterParameters = configured?.type === "update_node" ? object(configured.payload).params : input.action.parameters;
    const conversation = input.conversationId ? await tx.agentConversation.findFirst({ where: { id: input.conversationId, projectId, createdById: userId } }) : null;
    if (input.conversationId && !conversation) throw new BadRequestException("建议会话不属于当前项目");
    const evidence = { content: input.content, referencedNodeIds: input.referencedNodeIds, rationale: input.action.rationale,
      intentEpoch: conversation?.intentEpoch ?? null,
      toolNodeId: toolOperation?.type === "add_node" ? toolOperation.node.id : input.action.targetNodeId,
      action: input.action, preserve: input.action.preserve,
      preview: { before: target ? { nodeId: target.id, title: target.title, parameters: object(target.payload).params,
        inputs: graph.edges.filter((edge) => edge.targetNodeId === target.id).map((edge) => ({ nodeId: edge.sourceNodeId, port: edge.targetPort })) } : null,
        after: { title: input.action.title, parameters: afterParameters, inputs: input.action.inputs },
        effect: input.action.type === "configure_tool" ? "更新未执行工具并保存新版本" : input.action.type === "fork_tool" ? "保留已有执行并创建新分支" : "新增待执行工具" } };
    return tx.workflowProposal.create({ data: { projectId, userId, baseRevision: graph.revision, contextRevision: input.contextRevision,
      conversationId: input.conversationId ?? null, planRevision: input.planRevision ?? null, mutationId: input.mutationId, schemaVersion: 2,
      targetNodeVersionId: input.action.targetNodeVersionId, actionFingerprint, status: "pending", diff: json(operations), evidence: json(evidence) } });
  }

  async accept(userId: string, projectId: string, proposalId: string, input: WorkflowProposalDecision) {
    await this.access.require(userId, projectId, "edit");
    const graph = await this.workflows.get(userId, projectId);
    const proposal = await this.ownedProposal(userId, projectId, proposalId);
    if (proposal.status === "accepted") return graph;
    if (proposal.status !== "pending") throw new ConflictException("建议已被拒绝或失效");
    if (input.baseRevision !== proposal.baseRevision)
      throw new ConflictException("建议引用的画布已变化，请重新请求建议");
    const result = await this.workflows.applySystemMutation(projectId, workflowSemanticPatchSchema.parse({
      mode: "semantic", baseRevision: proposal.baseRevision,
      mutationId: stableMutationId(`proposal:${proposal.id}`), operations: proposal.diff,
    }), proposal.contextRevision ?? undefined, proposal.id);
    return result;
  }

  async reject(userId: string, projectId: string, proposalId: string, input: WorkflowRejectRequest): Promise<SyncedGraph> {
    await this.access.require(userId, projectId, "edit");
    await this.workflows.get(userId, projectId);
    const proposal = await this.ownedProposal(userId, projectId, proposalId);
    if (proposal.status === "accepted") throw new ConflictException("已接受的节点请在画布中处理");
    if (proposal.status === "rejected") return this.sync(userId, projectId);
    await this.database.$transaction(async (tx) => {
      const changed = await tx.workflowProposal.updateMany({ where: { id: proposal.id, status: { in: ["pending", "planning"] } }, data: { status: "rejected", rejectionReason: input.reason ?? null, evidence: json({ ...object(proposal.evidence), rejectionMutationId: input.mutationId }) } });
      if (changed.count !== 1) throw new ConflictException("建议状态已变化，请查看最新画布");
      await appendWorkflowOutbox(tx, { projectId, eventKey: `proposal:${proposal.id}:rejected`, eventType: "proposal.decision", payload: { proposalId, kind: "rejected", reason: input.reason ?? null, userId } });
    });
    return this.sync(userId, projectId);
  }

  async execute(userId: string, projectId: string, nodeId: string, input: WorkflowExecuteRequest) {
    await this.access.require(userId, projectId, "edit");
    let graph: Graph = await this.sync(userId, projectId);
    const node = graph.nodes.find((item) => item.id === nodeId && item.kind === "tool");
    if (!node) throw new NotFoundException("工具节点不存在");
    if (node.type === "restore_version") throw new BadRequestException("请从候选的版本历史恢复版本");
    const attempts = await this.database.workflowAttempt.findMany({ where: { projectId, toolNodeId: nodeId }, orderBy: { ordinal: "desc" } });
    if (attempts.some((attempt) => object(attempt.requestSnapshot).mutationId === input.mutationId)) return graph;
    if (node.status === "running") throw new ConflictException("该节点正在执行，请等待完成");
    if (node.status === "completed") return graph;
    const sources = incoming(graph, node);
    if (!sources.length) throw new BadRequestException("请连接该工具需要的输入素材");
    if (graph.edges.filter((edge) => edge.targetNodeId === node.id && edge.targetPort === "source").length > 1)
      throw new BadRequestException("原图存在多个来源，请整理连接或建立新分支后执行");
    for (const edge of graph.edges.filter((item) => item.targetNodeId === node.id)) {
      const source = graph.nodes.find((item) => item.id === edge.sourceNodeId);
      const reason = source?.kind === "asset" ? workflowInputConnectionError(source.type, node.type, edge, graph.edges.filter((item) => item.id !== edge.id)) : "请选择素材作为工具输入";
      if (reason) throw new BadRequestException(`来源连接需要整理：${reason}`);
    }
    if (sources.some((source) => source.status === "pending" || source.status === "running" || source.status === "failed"))
      throw new BadRequestException("输入尚未就绪");
    if (node.type === "analyze_brief" && !graph.edges.some((edge) => edge.targetNodeId === node.id && edge.targetPort === "goal"))
      throw new BadRequestException("需求分析需要设计需求输入");
    if (node.type === "edit_design" && graph.edges.filter((edge) => edge.targetNodeId === node.id && edge.targetPort === "source").length !== 1)
      throw new BadRequestException("局部修改必须连接一个原图，请将候选图或上传的参考图片连接为原图");
    const toolKey = workflowToolKeySchema.parse(node.type);
    const legacyParams = object(object(node.payload).params);
    const { maskImageUrl: legacyMask, ...safeParams } = legacyParams;
    const params = parseWorkflowToolParameters(toolKey, { ...safeParams, prompt: text(safeParams.prompt) || node.title,
      ...(toolKey === "edit_design" && legacyMask && !safeParams.mask ? { mask: await this.resolveLegacyMask(userId, projectId, text(legacyMask)) } : {}) });
    const count = typeof params.count === "number" ? params.count : 1;
    const transformSource = node.type === "transform_image" ? sources.find((source) => graph.edges.some((edge) => edge.sourceNodeId === source.id && edge.targetNodeId === nodeId && edge.targetPort === "source")) : null;
    const transformAssetId = transformSource ? text(object(transformSource.payload).assetId) : null;
    if (node.type === "transform_image") {
      if (!transformAssetId || !this.transforms) throw new BadRequestException("图片变换缺少原图或队列");
      await this.ownedAsset(userId, projectId, transformAssetId);
    }
    const ordinal = (attempts[0]?.ordinal ?? 0) + 1;
    const request = node.type === "generate_design" || node.type === "edit_design"
      ? await this.generationRequest(userId, projectId, { ...node, payload: json({ ...object(node.payload), params }) as Prisma.JsonValue }, sources, graph) : null;
    const execution = await this.database.$transaction(async (tx) => {
      await this.access.require(userId, projectId, "edit", tx);
      let intentEpoch: number | null = null;
      if (input.conversationId) {
        const conversation = await tx.agentConversation.findFirst({ where: { id: input.conversationId, projectId, createdById: userId, mode: "workflow", archivedAt: null } });
        if (!conversation) throw new BadRequestException("执行会话不属于当前项目或已归档");
        const locked = await tx.agentConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
        intentEpoch = locked.intentEpoch;
      }
      const versions = await ensureWorkflowNodeVersions(tx, projectId, graph.revision);
      const current = await tx.workflowGraph.findUnique({ where: { projectId } });
      if (current?.revision !== graph.revision) throw new ConflictException("执行前画布已变化，请重新确认输入");
      const nodeVersionId = versions.get(nodeId)?.id;
      if (!nodeVersionId) throw new ConflictException("节点版本缺失，请刷新后重试");
      const snapshot = json({ ...(transformAssetId ? { transformAssetId } : {}), executionActor: userId, mutationId: input.mutationId, params, toolVersion: "1", graphRevision: graph.revision,
        inputNodeIds: sources.map((source) => source.id), inputBindings: versions.get(nodeId)?.inputBindings,
        inputSnapshot: sources.map((source) => ({ id: source.id, nodeVersionId: versions.get(source.id)?.id, type: source.type, title: source.title, payload: source.payload })),
        ...(request ? { request } : { model: process.env.AMUX_CLAUDE_MODEL }) });
      const created = await tx.workflowExecution.create({ data: { projectId, toolNodeId: nodeId, nodeVersionId,
        conversationId: input.conversationId ?? null, userId, intentEpoch, executionKey: `workflow-execution:${projectId}:${nodeId}:${input.mutationId}`,
        status: "running", expectedAttempts: count, requestSnapshot: snapshot } });
      // Reserve every candidate before submitting any generation; recovery can finish partial submissions.
      for (let index = 0; index < count; index++) await tx.workflowAttempt.create({ data: {
        projectId, toolNodeId: nodeId, executionId: created.id, nodeVersionId, ordinal: ordinal + index,
        executionKey: `workflow:${projectId}:${nodeId}:${ordinal + index}`, status: request ? "submitting" : "running", requestSnapshot: snapshot,
      } });
      await this.workflows.applySystemMutation(projectId, { mode: "semantic", mutationId: stableMutationId(`execution:start:${created.id}`),
        baseRevision: graph.revision, operations: [{ type: "update_node", nodeId, status: "running" }] }, undefined, undefined, tx);
      return created;
    });
    graph = await this.workflows.get(userId, projectId);
    const reserved = await this.database.workflowAttempt.findMany({ where: { executionId: execution.id }, orderBy: { ordinal: "asc" } });
    try {
      if (transformAssetId) {
        if (!this.transforms) throw new BadRequestException("图片变换队列不可用");
        for (const attempt of reserved) await this.transforms.enqueue(attempt.id);
        return this.sync(userId, projectId);
      }
      if (request) {
        for (const attempt of reserved) {
          const result = await this.generation.createFromAgent(userId, request, attempt.executionKey, request.prompt);
          await this.linkTask(attempt.id, result.taskId);
        }
        return this.sync(userId, projectId);
      }
      const attempt = reserved[0];
      if (!attempt) throw new ConflictException("执行尝试预留失败");
      const evidence = this.evidence(sources);
      let outputType: "constraint" | "evaluation";
      let payload: Record<string, unknown>;
      if (node.type === "analyze_brief") {
        const result = await new FashionAgentFramework(this.model).curateBrief({
          intent: sources.map(nodeText).join("\n").slice(0, 4_000), evidence,
          images: await this.sourceImages(userId, projectId, sources),
          conversationContext: text(params.prompt),
        });
        outputType = "constraint";
        payload = { text: result.brief.summary, brief: result.brief, evidence: result.evidence };
      } else {
        const constraint = sources.find((source) => source.type === "constraint");
        if (!constraint) throw new BadRequestException("评估需要设计约束输入");
        const brief = object(constraint.payload).brief as AgentDesignBrief;
        if (!brief?.constraints) throw new BadRequestException("设计约束不完整，请先执行需求分析");
        const briefEvidence = object(constraint.payload).evidence as AgentDesignEvidence[];
        const candidateInputs = new Set(graph.edges.filter((edge) => edge.targetNodeId === node.id && edge.targetPort === "candidate").map((edge) => edge.sourceNodeId));
        const candidates = sources.filter((source) => source.type === "candidate" && candidateInputs.has(source.id)).slice(0, 4);
        const evaluationTask = text(params.prompt).slice(0, 4_000);
        const built = this.contexts ? await this.contexts.build(userId, projectId, {
          focusNodeIds: candidates.map((candidate) => candidate.id),
          referencedNodeIds: [...candidates.map((candidate) => candidate.id), constraint.id],
        }) : undefined;
        const evaluationInputs = [];
        for (const candidate of candidates) {
          const assetId = text(object(candidate.payload).assetId);
          const asset = await this.ownedAsset(userId, projectId, assetId);
          const parent = asset.parentAssetId ? await this.ownedAsset(userId, projectId, asset.parentAssetId) : null;
          const images = await this.loadImages([asset, ...(parent ? [parent] : [])]);
          const producerAttempt = text(object(candidate.payload).attemptId)
            ? await this.database.workflowAttempt.findFirst({ where: { id: text(object(candidate.payload).attemptId), projectId } }) : null;
          const frozenRequest = object(object(producerAttempt?.requestSnapshot).request);
          const actualPrompt = text(frozenRequest.prompt) || text(object(object(producerAttempt?.requestSnapshot).params).prompt) || brief.summary;
          const actualNegativePrompt = text(frozenRequest.negativePrompt);
          evaluationInputs.push({
            brief, evidence: briefEvidence ?? evidence, stepId: node.id, attemptId: attempt.id, assetId,
            step: { key: node.id, tool: parent ? "edit_design" as const : "generate_design" as const, title: node.title, instruction: node.title, prompt: actualPrompt, negativePrompt: actualNegativePrompt, sourceAssetId: parent?.id ?? null, sourceStepKey: null },
            prompt: actualPrompt, negativePrompt: actualNegativePrompt, images, evaluationTask,
            ...(built ? { auxiliaryContext: { ...projectCandidateEvaluationContext(built, candidate, constraint),
              producerAttemptId: producerAttempt?.id ?? null,
              promptSource: text(frozenRequest.prompt) ? "frozen_generation_request" :
                text(object(object(producerAttempt?.requestSnapshot).params).prompt) ? "frozen_tool_parameters" : "brief_summary_fallback",
            } } : {}),
          });
        }
        await this.database.workflowAttempt.update({ where: { id: attempt.id }, data: { requestSnapshot: json({
          ...object(attempt.requestSnapshot), evaluationTask,
          evaluationInputs: evaluationInputs.map((entry) => ({ assetId: entry.assetId, prompt: entry.prompt,
            negativePrompt: entry.negativePrompt, ...(entry.auxiliaryContext ? { auxiliaryContext: entry.auxiliaryContext } : {}) })),
        }) } });
        const evaluations = [];
        for (const evaluation of evaluationInputs) evaluations.push(await new FashionAgentFramework(this.model).evaluate(evaluation));
        if (!evaluations.length) throw new BadRequestException("请选择至少一个候选进行评估");
        outputType = "evaluation";
        payload = { text: evaluations.map((evaluation) => evaluation.summary).join("\n"), report: { evaluations, constraintNodeId: constraint.id, inputNodeIds: sources.map((source) => source.id) } };
      }
      graph = await this.workflows.get(userId, projectId);
      const outputId = randomUUID();
      const outputPosition = availableNodePosition(graph, [], { kind: "asset", type: outputType }, node.x + 340, node.y);
      graph = await this.persistAttemptResult(graph, attempt.id, { status: "completed", error: null }, [
        { type: "add_node", node: { id: outputId, kind: "asset", type: outputType, title: outputType === "constraint" ? "设计约束" : "评估报告", payload: { ...payload, attemptId: attempt.id }, ...outputPosition, status: "completed" } },
        { type: "add_edge", edge: { id: randomUUID(), sourceNodeId: node.id, targetNodeId: outputId, sourcePort: "out", targetPort: "source" } },
        { type: "update_node", nodeId, status: "completed" },
      ]);
      return graph;
    } catch (error) {
      // A committed transaction remains authoritative if its acknowledgement was
      // lost. Never overwrite a durable successful result with a failure receipt.
      const committed = await this.database.workflowExecution.findUnique({ where: { id: execution.id }, select: { status: true } });
      if (committed?.status === "completed") return this.sync(userId, projectId);
      const message = error instanceof Error ? error.message : "工具执行失败";
      await this.database.workflowAttempt.updateMany({ where: { toolNodeId: nodeId, status: { in: ACTIVE_ATTEMPT_STATUSES }, generationTaskId: null }, data: { status: "failed", error: message.slice(0, 2_000) } });
      const latest = await this.workflows.get(userId, projectId);
      await this.mutate(latest, [{ type: "update_node", nodeId, status: "failed", payload: { ...object(node.payload), error: message.slice(0, 2_000) } }]);
      await this.finalizeExecutions(projectId);
      throw error;
    }
  }

  async sync(userId: string, projectId: string): Promise<SyncedGraph> {
    for (let retry = 0; ; retry++) {
      try { return await this.syncOnce(userId, projectId); }
      catch (error) { if (!(error instanceof ConflictException) || retry >= 2) throw error; }
    }
  }

  private async syncOnce(userId: string, projectId: string) {
    const permissions = await this.access.require(userId, projectId, "read");
    let graph = await this.workflows.get(userId, projectId);
    if (!permissions.capabilities.edit) {
      const proposals = await this.database.workflowProposal.findMany({ where: { projectId, userId, status: { in: ["pending", "planning"] } }, orderBy: { createdAt: "desc" }, take: 10 });
      return { ...graph, proposals: proposals.map((proposal) => this.proposalView(proposal)) };
    }
    // A committed output is durable evidence even if updating the attempt or
    // acknowledging the graph transaction was interrupted afterwards.
    for (const output of graph.nodes.filter((node) => node.kind === "asset" && node.status === "completed")) {
      const attemptId = text(object(output.payload).attemptId);
      const producer = graph.edges.find((edge) => edge.targetNodeId === output.id)?.sourceNodeId;
      if (attemptId && producer) await this.database.workflowAttempt.updateMany({ where: { id: attemptId, projectId, toolNodeId: producer, status: { not: "completed" } }, data: { status: "completed", error: null } });
    }
    const attempts = await this.database.workflowAttempt.findMany({ where: { projectId, status: { in: ACTIVE_ATTEMPT_STATUSES } }, orderBy: { createdAt: "asc" } });
    for (const attempt of attempts) {
      const snapshot = object(attempt.requestSnapshot);
      if (snapshot.transformAssetId && this.transforms) {
        const result = await this.database.imageTransformResult.findUnique({ where: { attemptId: attempt.id } });
        if (!result) { await this.transforms.enqueue(attempt.id); continue; }
        const tool = graph.nodes.find((node) => node.id === attempt.toolNodeId);
        if (!tool) continue;
        if (result.error) {
          graph = await this.persistAttemptResult(graph, attempt.id, { status: "failed", error: result.error }, [{ type: "update_node", nodeId: tool.id, status: "failed" }]);
        } else if (result.assetId) {
          const asset = await this.ownedAsset(userId, projectId, result.assetId);
          const outputId = stableMutationId(`transform:output:${attempt.id}`);
          graph = await this.persistAttemptResult(graph, attempt.id, { status: "completed", error: null }, [
            { type: "add_node", node: { id: outputId, kind: "asset", type: "candidate", title: "调整尺寸结果", payload: { assetId: asset.id, parentAssetId: asset.parentAssetId, imageUrl: `/api/design-assets/${asset.id}/content`, width: asset.width, height: asset.height, attemptId: attempt.id, executionId: attempt.executionId }, ...availableNodePosition(graph, [], { kind: "asset", type: "candidate" }, tool.x + 340, tool.y), status: "completed" } },
            { type: "add_edge", edge: { id: stableMutationId(`transform:edge:${attempt.id}`), sourceNodeId: tool.id, targetNodeId: outputId, sourcePort: "out", targetPort: "source" } },
            { type: "update_node", nodeId: tool.id, status: "completed" },
          ]);
        }
        continue;
      }
      if (!attempt.generationTaskId) {
        if (!snapshot.request) {
          if (Date.now() - attempt.updatedAt.getTime() > 15 * 60_000)
            await this.database.workflowAttempt.update({ where: { id: attempt.id }, data: { status: "failed", error: "分析超过恢复时限，请重新执行；旧尝试已保留。" } });
          continue;
        }
        const execution = attempt.executionId ? await this.database.workflowExecution.findUnique({ where: { id: attempt.executionId }, select: { userId: true } }) : null;
        const executionActor = text(snapshot.executionActor) || execution?.userId || permissions.ownerId;
        try { await this.access.require(executionActor, projectId, "edit"); } catch (error) {
          if (!(error instanceof ForbiddenException || error instanceof NotFoundException)) throw error;
          await this.database.workflowAttempt.updateMany({ where: { id: attempt.id, generationTaskId: null, status: { in: ACTIVE_ATTEMPT_STATUSES } }, data: { status: "failed", error: "原执行者的编辑权限已撤销，请由有权限的成员明确重新执行。" } });
          continue;
        }
        const request = generationCreateRequestSchema.parse(snapshot.request);
        const result = await this.generation.createFromAgent(executionActor, request, attempt.executionKey, request.prompt);
        await this.linkTask(attempt.id, result.taskId);
        continue;
      }
      const task = await this.generation.get(userId, attempt.generationTaskId);
      if (task.status === "queued" || task.status === "running") continue;
      const tool = graph.nodes.find((node) => node.id === attempt.toolNodeId);
      if (!tool) continue;
      const operations: Operation[] = [];
      if (task.status === "succeeded") {
        const images = object(task.output).images;
        if (Array.isArray(images)) for (const [index, value] of images.entries()) {
          const image = object(value);
          const assetId = text(image.assetId);
          if (!assetId) continue;
          const matchingNodes = graph.nodes.filter((node) => node.kind === "asset" && node.type === "candidate" && object(node.payload).assetId === assetId);
          if (matchingNodes.some((node) => graph.edges.some((edge) => edge.sourceNodeId === tool.id && edge.targetNodeId === node.id))) continue;
          const independentReference = matchingNodes.find((node) => !graph.edges.some((edge) => edge.targetNodeId === node.id));
          if (independentReference) {
            operations.push({ type: "add_edge", edge: { id: randomUUID(), sourceNodeId: tool.id, targetNodeId: independentReference.id, sourcePort: "out", targetPort: "source" } });
            operations.push({ type: "update_node", nodeId: independentReference.id, status: "completed", payload: { ...object(independentReference.payload), generationTaskId: task.id, attemptId: attempt.id, executionId: attempt.executionId } });
            continue;
          }
          const outputId = stableMutationId(`workflow:output:${attempt.id}:${assetId}`);
          const existingOutputs = graph.edges.filter((edge) => edge.sourceNodeId === tool.id).length + operations.filter((operation) => operation.type === "add_node").length;
          const outputPosition = availableNodePosition(graph, operations, { kind: "asset", type: "candidate" }, tool.x + 340, tool.y + existingOutputs * 350);
          operations.push({ type: "add_node", node: { id: outputId, kind: "asset", type: "candidate", title: `候选 ${String.fromCharCode(65 + existingOutputs + index)}`, payload: { assetId, imageUrl: `/api/design-assets/${encodeURIComponent(assetId)}/content`, thumbnailUrl: `/api/design-assets/${encodeURIComponent(assetId)}/thumbnail`, generationTaskId: task.id, attemptId: attempt.id, executionId: attempt.executionId, width: image.width, height: image.height }, ...outputPosition, status: "completed" } });
          operations.push({ type: "add_edge", edge: { id: stableMutationId(`workflow:output-edge:${attempt.id}:${assetId}`), sourceNodeId: tool.id, targetNodeId: outputId, sourcePort: "out", targetPort: "source" } });
        }
      }
      const resultAssets = Array.isArray(object(task.output).images) ? (object(task.output).images as unknown[]).map((image) => text(object(image).assetId)).filter(Boolean) : [];
      const projectedNodes = [...graph.nodes, ...operations.flatMap((operation) => operation.type === "add_node" ? [operation.node] : [])];
      const projectedEdges = [...graph.edges, ...operations.flatMap((operation) => operation.type === "add_edge" ? [operation.edge] : [])];
      const outputPresent = resultAssets.length > 0 && resultAssets.every((assetId) => projectedNodes.some((output) => output.type === "candidate" && object(output.payload).assetId === assetId && projectedEdges.some((edge) => edge.sourceNodeId === tool.id && edge.targetNodeId === output.id)));
      const model = persistedGenerationModel(task);
      graph = await this.persistAttemptResult(graph, attempt.id, {
        status: task.status === "succeeded" && outputPresent ? "completed" : task.status === "canceled" ? "canceled" : task.status === "moderation_failed" ? "moderation_failed" : "failed",
        error: task.status === "succeeded" && !outputPresent ? "生成任务已结束但缺少可追溯的输出资产" : task.error?.message ?? null,
        ...(model ? { requestSnapshot: json({ ...snapshot, model }) } : {}),
      }, operations);
    }
    await this.database.workflowProposal.updateMany({ where: { projectId, userId, status: "pending", baseRevision: { lt: graph.revision } }, data: { status: "superseded" } });
    const proposals = await this.database.workflowProposal.findMany({ where: { projectId, userId, status: { in: ["pending", "planning"] } }, orderBy: { createdAt: "desc" }, take: 10 });
    for (const node of graph.nodes.filter((item) => item.kind === "tool" && (item.status === "running" || item.status === "failed"))) {
      const active = await this.database.workflowAttempt.count({ where: { toolNodeId: node.id, status: { in: ACTIVE_ATTEMPT_STATUSES } } });
      if (active) continue;
      const hasOutput = graph.edges.some((edge) => edge.sourceNodeId === node.id);
      const status = hasOutput ? "completed" : "failed";
      if ((hasOutput || Date.now() - new Date(node.updatedAt).getTime() > 15 * 60_000) && node.status !== status)
        graph = await this.mutate(graph, [{ type: "update_node", nodeId: node.id, status }]);
    }
    await this.finalizeExecutions(projectId);
    return { ...graph, proposals: proposals.map((proposal) => this.proposalView(proposal)) };
  }

  private async linkTask(attemptId: string, taskId: string) {
    await this.database.$transaction(async (tx) => {
      await tx.workflowAttempt.updateMany({ where: { id: attemptId, status: { in: ACTIVE_ATTEMPT_STATUSES } }, data: { generationTaskId: taskId, status: "running" } });
      const task = await tx.generationTask.findUnique({ where: { id: taskId } });
      if (task && ["SUCCEEDED", "FAILED", "CANCELED", "MODERATION_FAILED"].includes(task.status))
        await appendGenerationTerminalOutbox(tx, { taskId, status: task.status as "SUCCEEDED" | "FAILED" | "CANCELED" | "MODERATION_FAILED" });
    });
  }

  /** Commit the result projection and its receipts together, before observers can read them. */
  private async persistAttemptResult(graph: Graph, attemptId: string, data: Prisma.WorkflowAttemptUpdateInput, operations: Operation[]) {
    return this.database.$transaction(async (tx) => {
      const attempt = await tx.workflowAttempt.update({ where: { id: attemptId }, data });
      const nextOperations = [...operations];
      const remaining = await tx.workflowAttempt.count({ where: { projectId: graph.projectId, toolNodeId: attempt.toolNodeId, status: { in: ACTIVE_ATTEMPT_STATUSES } } });
      if (!remaining && !nextOperations.some((operation) => operation.type === "update_node" && operation.nodeId === attempt.toolNodeId && operation.status !== undefined)) {
        const hasOutput = graph.edges.some((edge) => edge.sourceNodeId === attempt.toolNodeId)
          || nextOperations.some((operation) => operation.type === "add_edge" && operation.edge.sourceNodeId === attempt.toolNodeId);
        const status = hasOutput ? "completed" : "failed";
        if (graph.nodes.find((node) => node.id === attempt.toolNodeId)?.status !== status) nextOperations.push({ type: "update_node", nodeId: attempt.toolNodeId, status });
      }
      const result = nextOperations.length ? await this.workflows.applySystemMutation(graph.projectId, {
        mode: "semantic", mutationId: randomUUID(), baseRevision: graph.revision, operations: nextOperations,
      }, undefined, undefined, tx) : graph;
      await this.finalizeExecutions(graph.projectId, tx);
      return result;
    });
  }

  /** One durable observation for the whole explicit execution, including partial failures. */
  async finalizeExecutions(projectId: string, transaction?: Prisma.TransactionClient) {
    const finalize = async (tx: Prisma.TransactionClient) => {
      const executions = await tx.workflowExecution.findMany({ where: { projectId, status: { in: ["queued", "running"] } }, orderBy: { createdAt: "asc" } });
      for (const execution of executions) {
        const attempts = await tx.workflowAttempt.findMany({ where: { executionId: execution.id }, orderBy: { ordinal: "asc" } });
        if (attempts.length !== execution.expectedAttempts || attempts.some((attempt) => ACTIVE_ATTEMPT_STATUSES.includes(attempt.status))) continue;
        const successful = attempts.filter((attempt) => attempt.status === "completed").length;
        const status = successful === attempts.length ? "completed" : successful ? "partial_failed"
          : attempts.every((attempt) => attempt.status === "canceled") ? "canceled"
            : attempts.every((attempt) => attempt.status === "moderation_failed") ? "moderation_failed" : "failed";
        const changed = await tx.workflowExecution.updateMany({ where: { id: execution.id, status: { in: ["queued", "running"] } }, data: { status, completedAt: new Date() } });
        if (changed.count) await appendWorkflowOutbox(tx, { projectId, executionId: execution.id, eventKey: `execution:${execution.id}:terminal`, eventType: "execution.terminal",
          payload: { status, toolNodeId: execution.toolNodeId, conversationId: execution.conversationId, userId: execution.userId,
            attempts: attempts.map((attempt) => ({ id: attempt.id, status: attempt.status, generationTaskId: attempt.generationTaskId, error: attempt.error })) } });
      }
    };
    if (transaction) await finalize(transaction);
    else await this.database.$transaction(finalize);
  }

  async history(userId: string, projectId: string, nodeId: string) {
    const graph = await this.sync(userId, projectId);
    if (!graph.nodes.some((node) => node.id === nodeId)) throw new NotFoundException("节点不存在");
    const attempts = await this.database.workflowAttempt.findMany({ where: { projectId, toolNodeId: nodeId }, orderBy: { ordinal: "desc" } });
    const taskIds = attempts.flatMap((attempt) => attempt.generationTaskId ? [attempt.generationTaskId] : []);
    const tasks = taskIds.length ? await this.database.generationTask.findMany({
      where: { id: { in: taskIds }, projectId }, select: { id: true, output: true, providerJob: true },
    }) : [];
    const taskModels = new Map(tasks.map((task) => [task.id, persistedGenerationModel(task)]));
    return { items: attempts.map((attempt) => {
      const snapshot = object(attempt.requestSnapshot);
      const request = object(snapshot.request);
      return { id: attempt.id, ordinal: attempt.ordinal, status: attempt.status, generationTaskId: attempt.generationTaskId, error: attempt.error, createdAt: attempt.createdAt,
        request: { inputNodeIds: snapshot.inputNodeIds, graphRevision: snapshot.graphRevision, toolVersion: snapshot.toolVersion, model: taskModels.get(attempt.generationTaskId ?? "") ?? snapshot.model, params: snapshot.params, prompt: request.prompt, negativePrompt: request.negativePrompt,
          taskType: request.taskType, width: request.width, height: request.height, quality: request.quality, outputFormat: request.outputFormat, background: request.background,
          referenceInputs: Array.isArray(request.referenceImages) ? request.referenceImages.map((value) => { const reference = object(value); return { order: reference.order, role: reference.role, weight: reference.weight }; }) : [],
          operation: snapshot.operation, restoredFromAssetId: snapshot.restoredFromAssetId, outputAssetId: snapshot.outputAssetId } };
    }) };
  }

  async decide(userId: string, projectId: string, nodeId: string, input: WorkflowNodeDecision) {
    await this.access.require(userId, projectId, "edit");
    const graph = await this.workflows.get(userId, projectId);
    const node = graph.nodes.find((item) => item.id === nodeId && object(item.payload).assetId === input.assetId);
    if (!node) throw new BadRequestException("决策必须绑定当前候选节点");
    const decision = await this.assets.decide(userId, input.assetId, { kind: input.kind, reason: input.reason.slice(0, 1_000), clientRequestId: input.mutationId });
    await this.database.$transaction((tx) => appendWorkflowOutbox(tx, { projectId, eventKey: `asset-decision:${decision.id}`, eventType: "asset.decision",
      payload: { decisionId: decision.id, nodeId, assetId: input.assetId, kind: input.kind, reason: input.reason, userId } }));
    return this.mutate(graph, [{ type: "update_node", nodeId, payload: { ...object(node.payload), decision: { id: decision.id, kind: input.kind, reason: input.reason } } }]);
  }

  async inferRole(userId: string, projectId: string, nodeId: string, input: WorkflowRoleInferenceRequest) {
    await this.access.require(userId, projectId, "edit");
    let graph = await this.workflows.get(userId, projectId);
    const source = graph.nodes.find((node) => node.id === nodeId);
    if (!source || (source.type !== "reference_image" && source.type !== "sketch"))
      throw new BadRequestException("只有已上传的参考图或草图可以识别角色");
    const fileAssetId = text(object(source.payload).fileAssetId);
    if (!fileAssetId) throw new BadRequestException("图片节点缺少原始上传文件");
    const assertSameRequest = (proposal: { userId: string; evidence: unknown }) => {
      const evidence = object(proposal.evidence);
      if (proposal.userId !== userId || evidence.kind !== "role_inference" || evidence.nodeId !== nodeId || evidence.fileAssetId !== fileAssetId)
        throw new ConflictException("该请求编号已用于其他工作流操作");
    };
    const existingRequest = await this.database.workflowProposal.findUnique({ where: { projectId_mutationId: { projectId, mutationId: input.mutationId } } });
    if (existingRequest) assertSameRequest(existingRequest);
    if (roleResolved(source)) return graph;
    if (roleFrozen(graph, source)) throw new ConflictException("已执行路径的参考角色已冻结，请新建分支");
    const file = await requireProjectFile(this.database, this.access, userId, fileAssetId, projectId);
    if (!file?.thumbnail1024Key) throw new BadRequestException("参考图缩略图尚未就绪");

    const reservation = await this.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${projectId}), hashtext(${nodeId}))`;
      const replay = await transaction.workflowProposal.findUnique({ where: { projectId_mutationId: { projectId, mutationId: input.mutationId } } });
      if (replay) {
        assertSameRequest(replay);
        return { kind: "replay" as const };
      }
      const active = await transaction.workflowProposal.findMany({ where: { projectId, status: { in: ["classifying", "committing"] } }, select: { id: true, evidence: true, updatedAt: true } });
      const matching = active.find((item) => { const evidence = object(item.evidence); return evidence.kind === "role_inference" && evidence.nodeId === nodeId && evidence.fileAssetId === fileAssetId; });
      if (matching && Date.now() - matching.updatedAt.getTime() < ROLE_INFERENCE_LEASE_MS) return { kind: "active" as const };
      if (matching) await transaction.workflowProposal.update({ where: { id: matching.id }, data: { status: "failed" } });
      const created = await transaction.workflowProposal.create({ data: {
        projectId, userId, baseRevision: graph.revision, mutationId: input.mutationId,
        status: "classifying", diff: [], evidence: json({ kind: "role_inference", nodeId, fileAssetId, mutationId: input.mutationId }),
      } });
      return { kind: "created" as const, id: created.id };
    });
    if (reservation.kind !== "created") return this.workflows.get(userId, projectId);

    const claimResult = async () => {
      const claimed = await this.database.workflowProposal.updateMany({
        where: { id: reservation.id, status: "classifying", updatedAt: { gte: new Date(Date.now() - ROLE_INFERENCE_LEASE_MS) } },
        data: { status: "committing" },
      });
      if (claimed.count) return true;
      await this.database.workflowProposal.updateMany({ where: { id: reservation.id, status: { in: ["classifying", "failed"] } }, data: { status: "superseded" } });
      return false;
    };

    try {
      graph = await this.workflows.get(userId, projectId);
      const current = graph.nodes.find((node) => node.id === nodeId);
      if (!current || text(object(current.payload).fileAssetId) !== fileAssetId || roleResolved(current) || roleFrozen(graph, current)) {
        await this.database.workflowProposal.update({ where: { id: reservation.id }, data: { status: "superseded" } });
        return graph;
      }
      if (object(current.payload).roleInferenceState !== "pending") graph = await this.workflows.applySystemMutation(projectId, {
        mode: "semantic", mutationId: stableMutationId(`role:pending:${reservation.id}`), baseRevision: graph.revision,
        operations: [{ type: "update_node", nodeId, payload: { ...object(current.payload), roleInferenceState: "pending" } }],
      });
    } catch (error) {
      await this.database.workflowProposal.update({ where: { id: reservation.id }, data: { status: "failed" } });
      throw error;
    }

    let classification;
    try {
      const image = await this.storage.readPrefix(file.thumbnail1024Key, ROLE_INFERENCE_MAX_IMAGE_BYTES + 1);
      if (!image.length || image.length > ROLE_INFERENCE_MAX_IMAGE_BYTES)
        throw new BadRequestException("参考图缩略图为空或超过 8MB");
      classification = await new AmuxClaudeVlmClassifier(this.model).classify(Buffer.from(image), "image/webp");
    } catch (error) {
      if (!await claimResult()) return this.workflows.get(userId, projectId);
      const latest = await this.workflows.get(userId, projectId);
      const current = latest.nodes.find((node) => node.id === nodeId);
      if (current && text(object(current.payload).fileAssetId) === fileAssetId && !roleResolved(current) && !roleFrozen(latest, current)) {
        await this.workflows.applySystemMutation(projectId, {
          mode: "semantic", mutationId: stableMutationId(`role:failed:${reservation.id}`), baseRevision: latest.revision,
          operations: [{ type: "update_node", nodeId, payload: { ...object(current.payload), roleInferenceState: "failed" } }],
        }).catch(() => undefined);
      }
      await this.database.workflowProposal.update({ where: { id: reservation.id }, data: { status: "failed", evidence: json({ kind: "role_inference", nodeId, fileAssetId, error: error instanceof Error ? error.message.slice(0, 1_000) : "识别失败" }) } });
      throw error;
    }

    if (!await claimResult()) return this.workflows.get(userId, projectId);

    const role = ROLE_BY_LABEL[classification.label];
    const confidence = classification.label === "non_fashion" || !classification.isFashion
      ? Math.min(classification.confidence, 0.49) : classification.confidence;
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await this.workflows.get(userId, projectId);
      const current = latest.nodes.find((node) => node.id === nodeId);
      if (!current || text(object(current.payload).fileAssetId) !== fileAssetId || roleResolved(current) || roleFrozen(latest, current)) {
        await this.database.workflowProposal.update({ where: { id: reservation.id }, data: { status: "superseded" } });
        return latest;
      }
      try {
        const result = await this.workflows.applySystemMutation(projectId, {
          mode: "semantic", mutationId: stableMutationId(`role:result:${reservation.id}`), baseRevision: latest.revision,
          operations: [{ type: "update_node", nodeId, payload: { ...object(current.payload), role, roleSource: "inferred", roleLabel: classification.label, roleConfidence: confidence, roleInferenceState: "ready" } }],
        });
        await this.database.workflowProposal.update({ where: { id: reservation.id }, data: { status: "completed", evidence: json({ kind: "role_inference", nodeId, fileAssetId, role, roleLabel: classification.label, roleConfidence: confidence }) } });
        return result;
      } catch (error) {
        if (!(error instanceof ConflictException) || attempt === 2) {
          await this.database.workflowProposal.update({ where: { id: reservation.id }, data: { status: "failed" } });
          throw error;
        }
      }
    }
    throw new ConflictException("参考角色识别期间工作流多次变化，请重试");
  }

  async importAsset(userId: string, projectId: string, input: { sourceNodeId: string; assetId: string; operation: "restore"; mutationId: string }) {
    await this.access.require(userId, projectId, "edit");
    const graph = await this.workflows.get(userId, projectId);
    const source = graph.nodes.find((node) => node.id === input.sourceNodeId && node.type === "candidate");
    if (!source) throw new BadRequestException("版本恢复必须引用当前候选节点");
    const asset = await this.ownedAsset(userId, projectId, input.assetId);
    if (asset.operation !== "RESTORE" || asset.parentAssetId !== object(source.payload).assetId)
      throw new BadRequestException("恢复资产与当前候选来源不匹配");
    const toolId = stableMutationId(`restore:tool:${asset.id}`);
    const outputId = stableMutationId(`restore:output:${asset.id}`);
    const executionKey = `workflow:restore:${input.mutationId}`;
    const assertReplay = (attempt: { projectId: string; toolNodeId: string; requestSnapshot: Prisma.JsonValue }) => {
      const snapshot = object(attempt.requestSnapshot);
      if (attempt.projectId !== projectId || attempt.toolNodeId !== toolId || snapshot.outputAssetId !== input.assetId || JSON.stringify(snapshot.inputNodeIds) !== JSON.stringify([input.sourceNodeId]) || snapshot.operation !== input.operation)
        throw new ConflictException("该请求编号已用于另一项版本恢复");
    };
    const known = await this.database.workflowAttempt.findUnique({ where: { executionKey } });
    if (known) { assertReplay(known); return graph; }
    const restoredFrom = asset.restoredFromAssetId ? await this.ownedAsset(userId, projectId, asset.restoredFromAssetId) : null;
    if (restoredFrom && restoredFrom.rootAssetId !== asset.rootAssetId) throw new BadRequestException("恢复来源不属于同一设计资产链");
    try {
      await this.database.$transaction(async (tx) => {
        // Serialize projection, immutable bindings and the explicit restore receipt.
        const beforeVersions = await ensureWorkflowNodeVersions(tx, projectId, graph.revision);
        const replay = await tx.workflowAttempt.findUnique({ where: { executionKey } });
        if (replay) { assertReplay(replay); return; }
        const current = await tx.workflowGraph.findUniqueOrThrow({ where: { projectId } });
        if (current.revision !== graph.revision) throw new ConflictException("恢复前画布已变化，请刷新后重试");
        const existingOutput = graph.nodes.find((node) => node.id === outputId);
        if (existingOutput && (object(existingOutput.payload).assetId !== input.assetId || !graph.edges.some((edge) => edge.sourceNodeId === input.sourceNodeId && edge.targetNodeId === toolId)))
          throw new ConflictException("该恢复结果已关联另一项来源");
        const attemptId = randomUUID();
        let result = graph;
        if (!existingOutput) {
          const operations: Operation[] = [];
          const toolPosition = availableNodePosition(graph, operations, { kind: "tool", type: "restore_version" }, source.x + 340, source.y + 180);
          operations.push({ type: "add_node", node: { id: toolId, kind: "tool", type: "restore_version", title: "版本恢复", payload: { toolKey: "restore_version", toolVersion: "1", params: { restoredFromAssetId: asset.restoredFromAssetId } }, ...toolPosition, status: "completed" } });
          const outputPosition = availableNodePosition(graph, operations, { kind: "asset", type: "candidate" }, toolPosition.x + 340, toolPosition.y);
          operations.push(
            { type: "add_node", node: { id: outputId, kind: "asset", type: "candidate", title: "恢复的版本", payload: { assetId: asset.id, imageUrl: `/api/design-assets/${encodeURIComponent(asset.id)}/content`, parentAssetId: asset.parentAssetId, attemptId }, ...outputPosition, status: "completed" } },
            { type: "add_edge", edge: { id: stableMutationId(`restore:input:${asset.id}`), sourceNodeId: source.id, targetNodeId: toolId, sourcePort: "out", targetPort: "source" } },
            { type: "add_edge", edge: { id: stableMutationId(`restore:edge:${asset.id}`), sourceNodeId: toolId, targetNodeId: outputId, sourcePort: "out", targetPort: "source" } },
          );
          result = await this.workflows.applySystemMutation(projectId, { mode: "semantic", mutationId: input.mutationId, baseRevision: graph.revision, operations }, undefined, undefined, tx);
        }
        const versions = await ensureWorkflowNodeVersions(tx, projectId, result.revision);
        const toolVersion = versions.get(toolId);
        if (!toolVersion) throw new ConflictException("恢复工具的不可变版本缺失");
        const designStep = await tx.designStep.findFirst({ where: { projectId, outputAssetId: asset.id } });
        const designStepSnapshot = designStep ? object(designStep.inputSnapshot) : null;
        const recordedSources = Array.isArray(designStepSnapshot?.sources) ? designStepSnapshot.sources.map(object) : [];
        // Asset sources are real lineage records; only inputSnapshot/inputBindings
        // contain graph node IDs. A historical target need not be on the canvas.
        const assetSources = [
          { ...recordedSources.find((entry) => entry.role === "edit_source" && entry.assetId === asset.parentAssetId), elementId: asset.parentAssetId, assetId: asset.parentAssetId, role: "edit_source" },
          ...(restoredFrom ? [{ ...recordedSources.find((entry) => entry.role === "restore_source" && entry.assetId === restoredFrom.id), elementId: restoredFrom.id, assetId: restoredFrom.id, role: "restore_source" }] : []),
        ];
        const snapshot = json({ mutationId: input.mutationId, operation: input.operation, graphRevision: result.revision, baseGraphRevision: graph.revision,
          params: { restoredFromAssetId: asset.restoredFromAssetId }, toolVersion: "1", nodeVersionId: toolVersion.id, inputNodeIds: [source.id], inputBindings: toolVersion.inputBindings,
          inputSnapshot: [{ id: source.id, nodeVersionId: beforeVersions.get(source.id)?.id, type: source.type, title: source.title, payload: source.payload }],
          restoredFromAssetId: asset.restoredFromAssetId, outputAssetId: asset.id, sources: assetSources,
          designStepId: designStep?.id ?? null, designStepSnapshot,
          projectionAlreadyPresent: Boolean(existingOutput), missingRestoreSource: !restoredFrom,
        });
        const execution = await tx.workflowExecution.create({ data: { projectId, toolNodeId: toolId, nodeVersionId: toolVersion.id,
          conversationId: null, userId, executionKey: `workflow-restore:${projectId}:${input.mutationId}`, status: "running", expectedAttempts: 1, requestSnapshot: snapshot } });
        const latestAttempt = await tx.workflowAttempt.findFirst({ where: { toolNodeId: toolId }, orderBy: { ordinal: "desc" }, select: { ordinal: true } });
        await tx.workflowAttempt.create({ data: { id: attemptId, projectId, toolNodeId: toolId, executionId: execution.id, nodeVersionId: toolVersion.id,
          ordinal: (latestAttempt?.ordinal ?? 0) + 1, executionKey, status: "completed", requestSnapshot: snapshot } });
        await this.finalizeExecutions(projectId, tx);
      });
    } catch (error) {
      // Retrying a committed request must not create another execution, even if
      // the transaction acknowledgement was lost or a duplicate caller raced it.
      const replay = await this.database.workflowAttempt.findUnique({ where: { executionKey } });
      if (!replay) throw error;
      assertReplay(replay);
    }
    return this.workflows.get(userId, projectId);
  }

  private async generationRequest(userId: string, projectId: string, node: Node, sources: Node[], graph: Graph): Promise<GenerationCreateRequest> {
    const params = object(object(node.payload).params);
    const referenceSettings = Array.isArray(params.referenceInputs) ? params.referenceInputs.map(object) : [];
    const referenceIds = new Set(graph.edges.filter((edge) => edge.targetNodeId === node.id && edge.targetPort === "reference").map((edge) => edge.sourceNodeId));
    for (const setting of referenceSettings) if (!referenceIds.has(text(setting.nodeId)))
      throw new BadRequestException("参考配置只能指向明确连接到 reference 输入的素材");
    const sourceId = graph.edges.find((edge) => edge.targetNodeId === node.id && edge.targetPort === "source")?.sourceNodeId;
    const source = sources.find((item) => item.id === sourceId);
    let sourceAsset = null;
    if (source?.type === "candidate") {
      sourceAsset = await this.ownedAsset(userId, projectId, text(object(source.payload).assetId));
    } else if (source?.type === "reference_image" && node.type === "edit_design") {
      const file = await this.referenceFile(userId, source);
      if (!file || !file.mimeType.startsWith("image/")) throw new BadRequestException("原图必须引用已就绪的上传图片");
      const imported = await this.assets.importFile(userId, projectId, file.id);
      sourceAsset = await this.ownedAsset(userId, projectId, imported.id);
    }
    const references: Array<{ order: number; role: "style_ref" | "fabric_texture" | "palette_ref" | "silhouette_ref" | "detail_ref"; url: string; weight: number }> = [];
    for (const item of sources) {
      const payload = object(item.payload);
      if (item.id === source?.id) continue;
      const file = await this.referenceFile(userId, item);
      const url = payload.assetId
        ? await this.referenceUrl((await this.ownedAsset(userId, projectId, text(payload.assetId))).url)
        : file ? await this.storage.createDownloadUrl(file.objectKey, 60 * 60) : null;
      const setting = referenceSettings.find((entry) => entry.nodeId === item.id);
      const requestedRole = text(setting?.role) || text(payload.role);
      const role = setting && REFERENCE_ROLES.has(requestedRole) ? requestedRole as "style_ref" | "silhouette_ref" | "detail_ref" | "fabric_texture" | "palette_ref" : item.type === "fabric" ? "fabric_texture"
        : item.type === "swatch" ? "palette_ref"
          : (item.type === "reference_image" || item.type === "sketch") && REFERENCE_ROLES.has(requestedRole)
            ? requestedRole as "style_ref" | "silhouette_ref" | "detail_ref" | "fabric_texture" | "palette_ref"
            : item.type === "sketch" ? "silhouette_ref" : "style_ref";
      if (url) references.push({ order: references.length, role, url, weight: typeof setting?.weight === "number" ? setting.weight : 0.7 });
    }
    let prompt = [text(params.prompt), ...sources.filter((item) => ["constraint", "brief", "reference_text", "swatch", "trend", "fabric"].includes(item.type)).map(nodeText)].filter(Boolean).join("\n");
    let annotations: unknown[] | undefined;
    if (params.intent === "outpaint") {
      const frame = object(params.outpaint);
      if (!sourceAsset?.width || !sourceAsset.height || Number(frame.left) + sourceAsset.width > Number(frame.width) || Number(frame.top) + sourceAsset.height > Number(frame.height) || (sourceAsset.width === frame.width && sourceAsset.height === frame.height)) {
        throw new BadRequestException("扩展画布必须完整包含原图并增加画面区域");
      }
    }
    if (params.intent === "feedback") {
      if (!sourceAsset) throw new BadRequestException("按意见修改需要原图");
      const saved = await this.database.imageAssetFeedback.findUnique({ where: { assetId: sourceAsset.id } });
      if (!saved || saved.revision !== params.feedbackRevision) throw new ConflictException("标注已更新，请重新保存并提交");
      const feedback = imageFeedbackSchema.parse({ ...object(saved.data), revision: saved.revision });
      const selected = feedback.comments.filter((comment) => Array.isArray(params.commentIds) && params.commentIds.includes(comment.id));
      if (!selected.length) throw new BadRequestException("请选择修改意见");
      const linked = new Set(selected.flatMap((comment) => comment.annotationIds));
      annotations = feedback.annotations.filter((annotation) => !linked.size || linked.has(annotation.id));
      prompt += "\n修改意见（位置为原图宽高的比例）：\n" + selected.map((comment) => `${comment.point ? `(${comment.point.x.toFixed(3)},${comment.point.y.toFixed(3)}) ` : ""}${comment.text}`).join("\n");
      prompt += "\n附图中的彩色标注仅用于指示修改位置，不要将标注绘制在最终图片里。";
    }
    if (prompt.length > 4_000) throw new BadRequestException("工具提示词与已连接文字超过 4000 字符，请缩短本轮描述或参考文字；系统不会静默截掉设计要求");
    if (references.length > (sourceAsset ? 15 : 16)) throw new BadRequestException("本次图片输入超过上限（含母图最多 16 张），请明确减少参考图后再执行；系统不会静默忽略参考");
    const base = { projectId, shapeIds: [], prompt, negativePrompt: text(params.negativePrompt), width: params.width, height: params.height, quality: params.quality, outputFormat: "png",
      ...(params.intent && params.intent !== "edit" ? { imageEdit: { intent: params.intent, ...(params.outpaint ? { outpaint: params.outpaint } : {}), ...(annotations ? { annotations } : {}) } } : {}),
      ...(params.intent === "remove_background" ? { background: "transparent" } : {}) };
    if (params.taskType === "inpaint") {
      if (!sourceAsset || !params.mask) throw new BadRequestException("局部重绘需要实际母图与蒙版");
      if (references.length) throw new BadRequestException("当前局部重绘只接受母图、蒙版和可选调色板，请移除图片参考连接");
      const mask = object(params.mask);
      let maskUrl: string;
      if (mask.assetId) maskUrl = (await this.ownedAsset(userId, projectId, text(mask.assetId))).url;
      else {
        const file = await requireProjectFile(this.database, this.access, userId, text(mask.fileAssetId), projectId);
        if (!file || !file.mimeType.startsWith("image/")) throw new BadRequestException("蒙版图片不可用或不属于当前用户");
        maskUrl = await this.storage.createDownloadUrl(file.objectKey, 60 * 60);
      }
      return generationCreateRequestSchema.parse({ ...base, taskType: "inpaint", parentAssetId: sourceAsset.id, referenceImageUrl: sourceAsset.url, maskImageUrl: maskUrl, ...(params.palette ? { palette: params.palette } : {}) });
    }
    return generationCreateRequestSchema.parse(sourceAsset
      ? { ...base, taskType: "i2i", parentAssetId: sourceAsset.id, referenceImageUrl: sourceAsset.url, referenceImages: references }
      : { ...base, taskType: "t2i", referenceImages: references });
  }

  private async resolveLegacyMask(userId: string, projectId: string, url: string) {
    const key = storageObjectKey(url);
    if (!key) throw new BadRequestException("旧蒙版必须引用当前用户的实际存储图片，请重新选择蒙版");
    const file = await this.database.fileAsset.findFirst({ where: { objectKey: key, status: "READY" } });
    if (file) await requireProjectFile(this.database, this.access, userId, file.id, projectId);
    if (file) return { fileAssetId: file.id };
    const asset = await this.database.designAsset.findFirst({ where: { url, projectId, archivedAt: null } });
    if (asset) return { assetId: asset.id };
    throw new BadRequestException("旧蒙版不属于当前用户，请重新选择蒙版");
  }

  private evidence(nodes: Node[]): AgentDesignEvidence[] {
    return nodes.map((node) => ({ id: node.id, kind: node.type === "brief" ? "intent" : "board", label: node.title, text: nodeText(node).slice(0, 3_000), assetId: text(object(node.payload).assetId) || null }));
  }

  private async sourceImages(userId: string, projectId: string, nodes: Node[]): Promise<AmuxClaudeImageInput[]> {
    const images: AmuxClaudeImageInput[] = [];
    for (const node of nodes) {
      if (images.length >= 8) break;
      const payload = object(node.payload);
      if (payload.assetId) images.push(...await this.loadImages([await this.ownedAsset(userId, projectId, text(payload.assetId))]));
      else {
        const file = await this.referenceFile(userId, node);
        if (file) images.push(await this.imageFromKey(file.thumbnail1024Key ?? file.objectKey, file.thumbnail1024Key ? "image/webp" : file.mimeType));
      }
    }
    return images.slice(0, 8);
  }

  private async loadImages(assets: Array<{ url: string; thumbnailUrl: string | null }>): Promise<AmuxClaudeImageInput[]> {
    const images: AmuxClaudeImageInput[] = [];
    for (const asset of assets) {
      const source = asset.thumbnailUrl ?? asset.url;
      const key = storageObjectKey(source);
      if (!key) throw new BadRequestException("只能评估当前受信任存储中的设计图片");
      images.push(await this.imageFromKey(key, asset.thumbnailUrl ? "image/webp" : "image/png"));
    }
    return images;
  }

  private async imageFromKey(key: string, mimeType: string): Promise<AmuxClaudeImageInput> {
    const bytes = await this.storage.readPrefix(key, 7 * 1024 * 1024 + 1);
    if (!bytes.length || bytes.length > 7 * 1024 * 1024) throw new BadRequestException("Agent 图片为空或超过 7MB");
    return { detail: "auto", url: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}` };
  }

  private async referenceUrl(source: string): Promise<string> {
    const key = storageObjectKey(source);
    return key ? this.storage.createDownloadUrl(key, 60 * 60) : source;
  }

  private async referenceFile(userId: string, node: Node) {
    const payload = object(node.payload);
    if (payload.fabricId) {
      const fabric = await this.database.fabric.findFirst({ where: { id: text(payload.fabricId), status: "active" }, include: { mainFile: true } });
      if (fabric?.scope !== "PRESET" && fabric) await requireProjectFile(this.database, this.access, userId, fabric.mainFileId, node.projectId);
      if (!fabric || fabric.mainFile.status !== "READY") throw new BadRequestException("面料图不可用");
      return fabric.mainFile;
    }
    if (payload.trendItemId) {
      const trend = await this.database.trendItem.findFirst({ where: { id: text(payload.trendItemId), status: "published" }, include: { coverFile: true } });
      if (!trend) throw new BadRequestException("趋势素材不可用");
      return trend.coverFile?.status === "READY" ? trend.coverFile : null;
    }
    if (payload.fileAssetId) {
      const file = await requireProjectFile(this.database, this.access, userId, text(payload.fileAssetId), node.projectId);
      if (!file || file.status !== FileStatus.READY) throw new BadRequestException("参考图未就绪");
      return file;
    }
    return null;
  }

  private async ownedAsset(userId: string, projectId: string, assetId: string) {
    await this.access.require(userId, projectId, "read");
    const asset = await this.database.designAsset.findFirst({ where: { id: assetId, projectId, archivedAt: null } });
    if (!asset) throw new BadRequestException("设计资产不属于当前项目");
    return asset;
  }

  private async ownedProposal(userId: string, projectId: string, id: string) {
    const proposal = await this.database.workflowProposal.findFirst({ where: { id, projectId, userId } });
    if (!proposal) throw new NotFoundException("工作流建议不存在");
    return proposal;
  }

  private proposalView(proposal: WorkflowProposal): WorkflowProposalView {
    const evidence = object(proposal.evidence);
    return { id: proposal.id, baseRevision: proposal.baseRevision, contextRevision: proposal.contextRevision,
      schemaVersion: proposal.schemaVersion, targetNodeVersionId: proposal.targetNodeVersionId, planRevision: proposal.planRevision,
      rejectionReason: proposal.rejectionReason, status: proposal.status, operations: proposal.diff,
      rationale: evidence.rationale, toolNodeId: evidence.toolNodeId, referencedNodeIds: evidence.referencedNodeIds,
      action: evidence.action, preview: evidence.preview, preserve: evidence.preserve, createdAt: proposal.createdAt };
  }

  private mutate(graph: Graph, operations: Operation[]) {
    return this.workflows.applySystemMutation(graph.projectId, { mode: "semantic", mutationId: randomUUID(), baseRevision: graph.revision, operations });
  }
}

function stableMutationId(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function storageObjectKey(value: string): string | null {
  if (value.startsWith("s3://")) return value.slice(5) || null;
  try {
    const parsed = new URL(value);
    const cdn = process.env.ASSET_CDN_ORIGIN;
    if (cdn) {
      const base = new URL(cdn.endsWith("/") ? cdn : `${cdn}/`);
      if (parsed.origin === base.origin && parsed.pathname.startsWith(base.pathname))
        return decodeURIComponent(parsed.pathname.slice(base.pathname.length));
    }
    const endpoint = process.env.S3_ENDPOINT;
    const bucket = process.env.S3_BUCKET;
    if (endpoint && bucket && parsed.origin === new URL(endpoint).origin && parsed.pathname.startsWith(`/${bucket}/`))
      return decodeURIComponent(parsed.pathname.slice(bucket.length + 2));
  } catch { return null; }
  return null;
}
