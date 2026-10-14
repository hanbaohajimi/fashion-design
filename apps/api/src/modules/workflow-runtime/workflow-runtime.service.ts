import { FileStatus, Prisma, type PrismaClient } from "@fashion/db";
import { AmuxClaudeVlmClassifier, type AmuxClaudeImageInput, type AmuxClaudeJsonClient } from "@fashion/ai";
import type { AgentDesignBrief, AgentDesignEvidence, VlmRoleLabel } from "@fashion/shared";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { AMUX_CLAUDE_CLIENT } from "../ai/ai.tokens";
import { FashionAgentFramework } from "../agent-runs/fashion-agent-framework";
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
} from "./workflow-runtime.schemas";

export const WORKFLOW_RUNTIME_DB = Symbol("WORKFLOW_RUNTIME_DB");
type Graph = Awaited<ReturnType<WorkflowsService["get"]>>;
type Node = Graph["nodes"][number];
type Operation = WorkflowSemanticPatchInput["operations"][number];
const recommendationSchema = z.object({
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(3_000),
  rationale: z.string().trim().min(1).max(1_000),
});
const TOOL_TITLES: Record<string, string> = {
  analyze_brief: "需求分析",
  generate_design: "方案生成",
  evaluate_design: "服装评估",
  edit_design: "局部修改",
};
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
  return [node.title, text(payload.text), text(brief.summary), constraints, text(payload.color), text(params.prompt), text(payload.rationale)]
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

function adjacentAssets(graph: Graph, tool: Node): Node[] {
  const ids = new Set(graph.edges.flatMap((edge) => {
    if (edge.sourceNodeId === tool.id) return [edge.targetNodeId];
    if (edge.targetNodeId === tool.id) return [edge.sourceNodeId];
    return [];
  }));
  return graph.nodes.filter((node) => node.kind === "asset" && ids.has(node.id));
}

function nearestUpstreamConstraints(graph: Graph, candidate: Node): Node[] {
  const visited = new Set([candidate.id]);
  let frontier = [candidate.id];
  while (frontier.length) {
    const current = new Set(frontier);
    const upstream = graph.edges
      .filter((edge) => current.has(edge.targetNodeId) && !visited.has(edge.sourceNodeId))
      .map((edge) => edge.sourceNodeId);
    const parents = new Set(upstream);
    const constraints = graph.nodes.filter((node) => node.type === "constraint" && parents.has(node.id));
    if (constraints.length) return constraints;
    frontier = [...parents];
    for (const id of frontier) visited.add(id);
  }
  return [];
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
  ) {}

  async propose(userId: string, projectId: string, input: WorkflowProposalRequest) {
    const graph = await this.workflows.get(userId, projectId);
    const replay = await this.database.workflowProposal.findUnique({
      where: { projectId_mutationId: { projectId, mutationId: input.mutationId } },
    });
    if (replay) {
      const evidence = object(replay.evidence);
      if (replay.userId !== userId || evidence.content !== input.content ||
          JSON.stringify(evidence.referencedNodeIds) !== JSON.stringify(input.referencedNodeIds))
        throw new ConflictException("该请求编号已用于其他工作流建议");
      return this.proposalView(replay);
    }
    const references = input.referencedNodeIds.map((id) => {
      const node = graph.nodes.find((item) => item.id === id);
      if (!node) throw new BadRequestException("引用节点必须属于当前工作流");
      return node;
    });
    const directAssets = references.filter((node) => node.kind === "asset");
    const relatedIds = new Set(references.filter((node) => node.kind === "tool").flatMap((node) => adjacentAssets(graph, node).map((asset) => asset.id)));
    const relatedAssets = graph.nodes.filter((node) => node.kind === "asset" && relatedIds.has(node.id));
    const explicitCandidateIds = new Set(directAssets.filter((node) => node.type === "candidate").map((node) => node.id));
    const contextualCandidateIds = new Set(relatedAssets.filter((node) => node.type === "candidate").map((node) => node.id));
    const candidates = graph.nodes.filter((node) => (explicitCandidateIds.size ? explicitCandidateIds : contextualCandidateIds).has(node.id));
    const allCandidates = graph.nodes.filter((node) => node.type === "candidate");
    const constraints = graph.nodes.filter((node) => node.type === "constraint");
    const wantsEdit = /修改|收窄|调整|保留|重绘|换色|袖口|edit/iu.test(input.content);
    const wantsEvaluation = /评估|评价|检查|比较|evaluate/iu.test(input.content);
    const tool = wantsEdit && allCandidates.length
      ? "edit_design"
      : wantsEvaluation && allCandidates.length
        ? "evaluate_design"
        : !constraints.length
          ? "analyze_brief"
          : !allCandidates.length || /生成|新方案|generate/iu.test(input.content)
            ? "generate_design"
            : "evaluate_design";
    const candidatePool = candidates.length ? candidates : references.length ? [] : allCandidates;
    const selectedCandidates = tool === "edit_design"
      ? candidatePool
      : tool === "evaluate_design"
        ? candidatePool.slice(-4)
        : [];
    if (tool === "edit_design" && selectedCandidates.length !== 1)
      throw new BadRequestException("请 @ 引用一件要修改的候选设计");
    if (tool === "evaluate_design" && !selectedCandidates.length)
      throw new BadRequestException("请先选择要评估的候选设计");
    const explicitConstraints = directAssets.filter((node) => node.type === "constraint");
    if (explicitConstraints.length > 1)
      throw new BadRequestException("请只 @ 引用一条本次使用的设计约束");
    let selectedConstraint = explicitConstraints[0];
    if (tool !== "analyze_brief" && !selectedConstraint && selectedCandidates.length) {
      const lineages = selectedCandidates.map((candidate) => nearestUpstreamConstraints(graph, candidate));
      const uniqueLineageIds = new Set(lineages.flatMap((nodes) => nodes.map((node) => node.id)));
      if (uniqueLineageIds.size > 1 || lineages.some((nodes) => nodes.length > 1) || (uniqueLineageIds.size && lineages.some((nodes) => !nodes.length)))
        throw new BadRequestException("候选分支的设计约束不一致，请 @ 引用本次使用的约束节点");
      selectedConstraint = constraints.find((node) => uniqueLineageIds.has(node.id));
    }
    if (tool !== "analyze_brief" && !selectedConstraint) {
      const contextualConstraints = relatedAssets.filter((node) => node.type === "constraint");
      if (contextualConstraints.length > 1)
        throw new BadRequestException("引用的工具涉及多条设计约束，请 @ 引用本次使用的约束节点");
      selectedConstraint = contextualConstraints[0] ?? (selectedCandidates.length ? undefined : constraints.at(-1));
    }
    if (tool === "evaluate_design" && !selectedConstraint)
      throw new BadRequestException("候选缺少可追溯的设计约束，请 @ 引用约束节点");
    const goal = graph.nodes.find((node) => node.type === "brief");
    const operations: Operation[] = [];
    let goalId = goal?.id;
    if (!goalId) {
      goalId = randomUUID();
      const briefPosition = availableNodePosition(graph, operations, { kind: "asset", type: "brief" }, 80, 100);
      operations.push({ type: "add_node", node: {
        id: goalId, kind: "asset", type: "brief", title: "设计需求",
        payload: { text: input.content }, ...briefPosition, status: "ready",
      } });
    }
    const inputs: Array<{ id: string; port: "goal" | "reference" | "constraint" | "candidate" | "source" }> = [];
    if (tool === "analyze_brief") inputs.push({ id: goalId, port: "goal" });
    if (tool !== "analyze_brief" && selectedConstraint)
      inputs.push({ id: selectedConstraint.id, port: "constraint" });
    if (tool === "generate_design" || tool === "analyze_brief") {
      const materials = (references.length ? [...directAssets, ...relatedAssets] : graph.nodes).filter(
        (node) => node.kind === "asset" && !["brief", "constraint", "candidate", "evaluation"].includes(node.type),
      );
      for (const node of new Map(materials.map((material) => [material.id, material])).values()) {
        if (inputs.filter((input) => input.port === "reference").length >= 12) break;
        inputs.push({ id: node.id, port: "reference" });
      }
    }
    if (tool === "evaluate_design")
      for (const node of selectedCandidates)
        inputs.push({ id: node.id, port: "candidate" });
    if (tool === "edit_design") {
      const source = selectedCandidates[0];
      if (!source) throw new BadRequestException("请先引用要修改的候选设计");
      inputs.push({ id: source.id, port: "source" });
    }
    let reservation;
    try {
      reservation = await this.database.workflowProposal.create({ data: {
        projectId, userId, baseRevision: graph.revision, mutationId: input.mutationId,
        status: "planning", diff: [], evidence: json({ content: input.content, referencedNodeIds: input.referencedNodeIds }),
      } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const existing = await this.database.workflowProposal.findUniqueOrThrow({ where: { projectId_mutationId: { projectId, mutationId: input.mutationId } } });
      const existingEvidence = object(existing.evidence);
      if (existing.userId !== userId || existingEvidence.content !== input.content || JSON.stringify(existingEvidence.referencedNodeIds) !== JSON.stringify(input.referencedNodeIds))
        throw new ConflictException("该请求编号已用于其他工作流建议");
      return this.proposalView(existing);
    }
    const dialog = await this.database.workflowProposal.findMany({ where: { projectId, userId, status: { in: ["accepted", "rejected", "pending"] } }, orderBy: { createdAt: "desc" }, take: 10, select: { evidence: true, status: true } });
    const recommendation = await this.model.generateJson({
      schemaName: "fashion_workflow_next_step",
      instructions: "你是服装设计工作流规划助手。只为指定的下一步工具撰写标题、执行描述和理由；不得替用户执行、采用结果或虚构工具能力。保留明确要求，说明依据来自哪些输入。图片无法确定尺寸、真实成分或性能。执行描述必须能直接用于服装设计，并将修改范围和保留项写清楚。",
      jsonSchema: z.toJSONSchema(recommendationSchema), maxTokens: 2_000,
      prompt: JSON.stringify({ tool, request: input.content, dialog: dialog.reverse().map((item) => ({ ...object(item.evidence), status: item.status })), inputs: graph.nodes.filter((node) => inputs.some((item) => item.id === node.id)).map((node) => ({ id: node.id, type: node.type, content: nodeText(node) })), referencedNodes: references.map((node) => ({ id: node.id, kind: node.kind, type: node.type, status: node.status, content: nodeText(node) })), relatedAssets: relatedAssets.map((node) => ({ id: node.id, type: node.type, content: nodeText(node) })), trajectory: graph.nodes.filter((node) => node.kind === "tool").map((node) => ({ title: node.title, type: node.type, status: node.status })) }),
      parse: (value) => recommendationSchema.parse(value),
    }).catch(async (error: unknown) => {
      await this.database.workflowProposal.update({ where: { id: reservation.id }, data: { status: "failed", evidence: json({ content: input.content, referencedNodeIds: input.referencedNodeIds, error: error instanceof Error ? error.message.slice(0, 1_000) : "建议规划失败" }) } });
      throw error;
    });
    const nodeId = randomUUID();
    const inputNodes = graph.nodes.filter((node) => inputs.some((item) => item.id === node.id));
    const branching = tool === "evaluate_design" || tool === "edit_design";
    const preferredX = Math.max(80, ...inputNodes.map((node) => node.x)) + (branching ? -330 : 330);
    const preferredY = branching
      ? Math.max(100, ...inputNodes.map((node) => node.y)) + 400
      : inputNodes.length ? inputNodes.reduce((sum, node) => sum + node.y, 0) / inputNodes.length : 100;
    const { x, y } = availableNodePosition(graph, operations, { kind: "tool", type: tool }, preferredX, preferredY);
    operations.push({ type: "add_node", node: {
      id: nodeId, kind: "tool", type: tool, title: recommendation.title || TOOL_TITLES[tool] || "设计操作",
      payload: { toolKey: tool, toolVersion: "1", params: { prompt: recommendation.prompt, count: tool === "generate_design" ? 2 : 1 }, rationale: recommendation.rationale },
      x, y, status: "ready",
    } });
    for (const source of inputs) operations.push({ type: "add_edge", edge: {
      id: randomUUID(), sourceNodeId: source.id, targetNodeId: nodeId,
      sourcePort: "out", targetPort: source.port,
    } });
    const proposal = await this.database.workflowProposal.update({ where: { id: reservation.id }, data: {
      status: "pending",
      diff: json(operations), evidence: json({ content: input.content, referencedNodeIds: input.referencedNodeIds, rationale: recommendation.rationale, toolNodeId: nodeId }),
    } });
    return this.proposalView(proposal);
  }

  async accept(userId: string, projectId: string, proposalId: string, input: WorkflowProposalDecision) {
    const graph = await this.workflows.get(userId, projectId);
    const proposal = await this.ownedProposal(userId, projectId, proposalId);
    if (proposal.status === "accepted") return graph;
    if (proposal.status !== "pending") throw new ConflictException("建议已被拒绝或失效");
    if (input.baseRevision !== proposal.baseRevision)
      throw new ConflictException("建议引用的画布已变化，请重新请求建议");
    const result = await this.workflows.applySystemMutation(projectId, workflowSemanticPatchSchema.parse({
      mode: "semantic", baseRevision: proposal.baseRevision,
      mutationId: stableMutationId(`proposal:${proposal.id}`), operations: proposal.diff,
    }));
    await this.database.workflowProposal.update({ where: { id: proposal.id }, data: { status: "accepted" } });
    return result;
  }

  async reject(userId: string, projectId: string, proposalId: string, input: WorkflowExecuteRequest) {
    await this.workflows.get(userId, projectId);
    const proposal = await this.ownedProposal(userId, projectId, proposalId);
    if (proposal.status === "accepted") throw new ConflictException("已接受的节点请在画布中处理");
    await this.database.workflowProposal.update({ where: { id: proposal.id }, data: { status: "rejected", evidence: json({ ...object(proposal.evidence), rejectionMutationId: input.mutationId }) } });
    return this.sync(userId, projectId);
  }

  async execute(userId: string, projectId: string, nodeId: string, input: WorkflowExecuteRequest) {
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
    if (sources.some((source) => source.status === "pending" || source.status === "running" || source.status === "failed"))
      throw new BadRequestException("输入尚未就绪");
    if (node.type === "analyze_brief" && !graph.edges.some((edge) => edge.targetNodeId === node.id && edge.targetPort === "goal"))
      throw new BadRequestException("需求分析需要设计需求输入");
    if (node.type === "edit_design" && graph.edges.filter((edge) => edge.targetNodeId === node.id && edge.targetPort === "source").length !== 1)
      throw new BadRequestException("局部修改必须连接一个实际候选来源");
    const params = object(object(node.payload).params);
    const count = node.type === "generate_design" ? Math.min(3, Math.max(1, Number(params.count) || 2)) : 1;
    graph = await this.mutate(graph, [{ type: "update_node", nodeId, status: "running" }]);
    const ordinal = (attempts[0]?.ordinal ?? 0) + 1;
    try {
      if (node.type === "generate_design" || node.type === "edit_design") {
        const request = await this.generationRequest(userId, projectId, node, sources, graph);
        for (let index = 0; index < count; index++) {
          const executionKey = `workflow:${projectId}:${nodeId}:${ordinal + index}`;
          const attempt = await this.database.workflowAttempt.create({ data: {
            projectId, toolNodeId: nodeId, ordinal: ordinal + index, executionKey, status: "submitting",
            requestSnapshot: json({ mutationId: input.mutationId, request, inputNodeIds: sources.map((source) => source.id), inputSnapshot: sources.map((source) => ({ id: source.id, type: source.type, title: source.title, payload: source.payload })), graphRevision: graph.revision, toolVersion: "1" }),
          } });
          const result = await this.generation.createFromAgent(userId, request, executionKey, request.prompt);
          await this.database.workflowAttempt.update({ where: { id: attempt.id }, data: { generationTaskId: result.taskId, status: "running" } });
        }
        return this.sync(userId, projectId);
      }
      const attempt = await this.database.workflowAttempt.create({ data: {
        projectId, toolNodeId: nodeId, ordinal, executionKey: `workflow:${projectId}:${nodeId}:${ordinal}`, status: "running",
        requestSnapshot: json({ mutationId: input.mutationId, inputNodeIds: sources.map((source) => source.id), inputSnapshot: sources.map((source) => ({ id: source.id, type: source.type, title: source.title, payload: source.payload })), graphRevision: graph.revision, toolVersion: "1", model: process.env.AMUX_CLAUDE_MODEL, params }),
      } });
      const evidence = this.evidence(sources);
      let outputType: "constraint" | "evaluation";
      let payload: Record<string, unknown>;
      if (node.type === "analyze_brief") {
        const result = await new FashionAgentFramework(this.model).plan({
          intent: sources.map(nodeText).join("\n").slice(0, 4_000), evidence,
          images: await this.sourceImages(userId, projectId, sources),
          selectedAssetIds: sources.map((source) => text(object(source.payload).assetId)).filter(Boolean),
          conversationContext: text(params.prompt),
        });
        outputType = "constraint";
        payload = { text: result.intelligence.brief.summary, brief: result.intelligence.brief, evidence: result.intelligence.evidence, plannedSteps: result.steps };
      } else {
        const constraint = sources.find((source) => source.type === "constraint");
        if (!constraint) throw new BadRequestException("评估需要设计约束输入");
        const brief = object(constraint.payload).brief as AgentDesignBrief;
        if (!brief?.constraints) throw new BadRequestException("设计约束不完整，请先执行需求分析");
        const briefEvidence = object(constraint.payload).evidence as AgentDesignEvidence[];
        const evaluations = [];
        const candidateInputs = new Set(graph.edges.filter((edge) => edge.targetNodeId === node.id && edge.targetPort === "candidate").map((edge) => edge.sourceNodeId));
        for (const candidate of sources.filter((source) => source.type === "candidate" && candidateInputs.has(source.id)).slice(0, 4)) {
          const assetId = text(object(candidate.payload).assetId);
          const asset = await this.ownedAsset(userId, projectId, assetId);
          const parent = asset.parentAssetId ? await this.ownedAsset(userId, projectId, asset.parentAssetId) : null;
          const images = await this.loadImages([asset, ...(parent ? [parent] : [])]);
          evaluations.push(await new FashionAgentFramework(this.model).evaluate({
            brief, evidence: briefEvidence ?? evidence, stepId: node.id, attemptId: attempt.id, assetId,
            step: { key: node.id, tool: parent ? "edit_design" : "generate_design", title: node.title, instruction: node.title, prompt: text(params.prompt) || brief.summary, negativePrompt: "", sourceAssetId: parent?.id ?? null, sourceStepKey: null },
            prompt: text(params.prompt) || brief.summary, negativePrompt: "", images,
          }));
        }
        if (!evaluations.length) throw new BadRequestException("请选择至少一个候选进行评估");
        outputType = "evaluation";
        payload = { text: evaluations.map((evaluation) => evaluation.summary).join("\n"), report: { evaluations, constraintNodeId: constraint.id, inputNodeIds: sources.map((source) => source.id) } };
      }
      graph = await this.workflows.get(userId, projectId);
      const outputId = randomUUID();
      const outputPosition = availableNodePosition(graph, [], { kind: "asset", type: outputType }, node.x + 340, node.y);
      graph = await this.mutate(graph, [
        { type: "add_node", node: { id: outputId, kind: "asset", type: outputType, title: outputType === "constraint" ? "设计约束" : "评估报告", payload: { ...payload, attemptId: attempt.id }, ...outputPosition, status: "completed" } },
        { type: "add_edge", edge: { id: randomUUID(), sourceNodeId: node.id, targetNodeId: outputId, sourcePort: "out", targetPort: "source" } },
        { type: "update_node", nodeId, status: "completed" },
      ]);
      await this.database.workflowAttempt.update({ where: { id: attempt.id }, data: { status: "completed" } });
      return graph;
    } catch (error) {
      const message = error instanceof Error ? error.message : "工具执行失败";
      await this.database.workflowAttempt.updateMany({ where: { toolNodeId: nodeId, status: { in: ACTIVE_ATTEMPT_STATUSES }, generationTaskId: null }, data: { status: "failed", error: message.slice(0, 2_000) } });
      const latest = await this.workflows.get(userId, projectId);
      await this.mutate(latest, [{ type: "update_node", nodeId, status: "failed", payload: { ...object(node.payload), error: message.slice(0, 2_000) } }]);
      throw error;
    }
  }

  async sync(userId: string, projectId: string) {
    let graph = await this.workflows.get(userId, projectId);
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
      if (!attempt.generationTaskId) {
        if (!snapshot.request) {
          if (Date.now() - attempt.updatedAt.getTime() > 15 * 60_000)
            await this.database.workflowAttempt.update({ where: { id: attempt.id }, data: { status: "failed", error: "分析超过恢复时限，请重新执行；旧尝试已保留。" } });
          continue;
        }
        const request = generationCreateRequestSchema.parse(snapshot.request);
        const result = await this.generation.createFromAgent(userId, request, attempt.executionKey, request.prompt);
        await this.database.workflowAttempt.update({ where: { id: attempt.id }, data: { generationTaskId: result.taskId, status: "running" } });
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
            operations.push({ type: "update_node", nodeId: independentReference.id, status: "completed" });
            continue;
          }
          const outputId = randomUUID();
          const existingOutputs = graph.edges.filter((edge) => edge.sourceNodeId === tool.id).length + operations.filter((operation) => operation.type === "add_node").length;
          const outputPosition = availableNodePosition(graph, operations, { kind: "asset", type: "candidate" }, tool.x + 340, tool.y + existingOutputs * 350);
          operations.push({ type: "add_node", node: { id: outputId, kind: "asset", type: "candidate", title: `候选 ${String.fromCharCode(65 + existingOutputs + index)}`, payload: { assetId, imageUrl: `/api/design-assets/${encodeURIComponent(assetId)}/content`, thumbnailUrl: `/api/design-assets/${encodeURIComponent(assetId)}/thumbnail`, generationTaskId: task.id, attemptId: attempt.id, width: image.width, height: image.height }, ...outputPosition, status: "completed" } });
          operations.push({ type: "add_edge", edge: { id: randomUUID(), sourceNodeId: tool.id, targetNodeId: outputId, sourcePort: "out", targetPort: "source" } });
        }
      }
      if (operations.length) graph = await this.mutate(graph, operations);
      const model = persistedGenerationModel(task);
      await this.database.workflowAttempt.update({ where: { id: attempt.id }, data: {
        status: task.status === "succeeded" ? "completed" : "failed", error: task.error?.message ?? null,
        ...(model ? { requestSnapshot: json({ ...snapshot, model }) } : {}),
      } });
      const remaining = await this.database.workflowAttempt.count({ where: { toolNodeId: tool.id, status: { in: ACTIVE_ATTEMPT_STATUSES } } });
      if (!remaining) {
        const hasOutput = graph.edges.some((edge) => edge.sourceNodeId === tool.id);
        graph = await this.mutate(graph, [{ type: "update_node", nodeId: tool.id, status: hasOutput ? "completed" : "failed" }]);
      }
    }
    await this.database.workflowProposal.updateMany({ where: { projectId, userId, status: "pending", baseRevision: { lt: graph.revision } }, data: { status: "superseded" } });
    const proposals = await this.database.workflowProposal.findMany({ where: { projectId, userId, status: { in: ["pending", "planning"] } }, orderBy: { createdAt: "desc" }, take: 10 });
    for (const node of graph.nodes.filter((item) => item.kind === "tool" && (item.status === "running" || item.status === "failed"))) {
      const active = await this.database.workflowAttempt.count({ where: { toolNodeId: node.id, status: { in: ACTIVE_ATTEMPT_STATUSES } } });
      if (active) continue;
      const hasOutput = graph.edges.some((edge) => edge.sourceNodeId === node.id);
      if (hasOutput || Date.now() - new Date(node.updatedAt).getTime() > 15 * 60_000)
        graph = await this.mutate(graph, [{ type: "update_node", nodeId: node.id, status: hasOutput ? "completed" : "failed" }]);
    }
    return { ...graph, proposals: proposals.map((proposal) => this.proposalView(proposal)) };
  }

  async history(userId: string, projectId: string, nodeId: string) {
    const graph = await this.sync(userId, projectId);
    if (!graph.nodes.some((node) => node.id === nodeId)) throw new NotFoundException("节点不存在");
    const attempts = await this.database.workflowAttempt.findMany({ where: { projectId, toolNodeId: nodeId }, orderBy: { ordinal: "desc" } });
    const taskIds = attempts.flatMap((attempt) => attempt.generationTaskId ? [attempt.generationTaskId] : []);
    const tasks = taskIds.length ? await this.database.generationTask.findMany({
      where: { id: { in: taskIds }, projectId, userId }, select: { id: true, output: true, providerJob: true },
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
    const graph = await this.workflows.get(userId, projectId);
    const node = graph.nodes.find((item) => item.id === nodeId && object(item.payload).assetId === input.assetId);
    if (!node) throw new BadRequestException("决策必须绑定当前候选节点");
    const decision = await this.assets.decide(userId, input.assetId, { kind: input.kind, reason: input.reason.slice(0, 1_000), clientRequestId: input.mutationId });
    return this.mutate(graph, [{ type: "update_node", nodeId, payload: { ...object(node.payload), decision: { id: decision.id, kind: input.kind, reason: input.reason } } }]);
  }

  async inferRole(userId: string, projectId: string, nodeId: string, input: WorkflowRoleInferenceRequest) {
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
    const file = await this.database.fileAsset.findFirst({ where: { id: fileAssetId, ownerId: userId, status: FileStatus.READY } });
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
    const graph = await this.workflows.get(userId, projectId);
    const source = graph.nodes.find((node) => node.id === input.sourceNodeId && node.type === "candidate");
    if (!source) throw new BadRequestException("版本恢复必须引用当前候选节点");
    const asset = await this.ownedAsset(userId, projectId, input.assetId);
    if (asset.operation !== "RESTORE" || asset.parentAssetId !== object(source.payload).assetId)
      throw new BadRequestException("恢复资产与当前候选来源不匹配");
    const toolId = stableMutationId(`restore:tool:${asset.id}`);
    const outputId = stableMutationId(`restore:output:${asset.id}`);
    const existingOutput = graph.nodes.find((node) => node.id === outputId);
    const existingAttempt = await this.database.workflowAttempt.findUnique({ where: { executionKey: `workflow:restore:${input.mutationId}` } });
    if (existingOutput && (object(existingOutput.payload).assetId !== input.assetId || !graph.edges.some((edge) => edge.sourceNodeId === input.sourceNodeId && edge.targetNodeId === toolId)))
      throw new ConflictException("该请求编号已用于另一项版本恢复");
    if (existingAttempt) {
      const snapshot = object(existingAttempt.requestSnapshot);
      if (existingAttempt.projectId !== projectId || snapshot.outputAssetId !== input.assetId || JSON.stringify(snapshot.inputNodeIds) !== JSON.stringify([input.sourceNodeId]) || snapshot.operation !== input.operation)
        throw new ConflictException("该请求编号已用于另一项版本恢复");
    }
    let result = graph;
    if (!graph.nodes.some((node) => node.id === outputId)) {
      const operations: Operation[] = [];
      const toolPosition = availableNodePosition(graph, operations, { kind: "tool", type: "restore_version" }, source.x + 340, source.y + 180);
      operations.push({ type: "add_node", node: { id: toolId, kind: "tool", type: "restore_version", title: "版本恢复", payload: { toolKey: "restore_version", toolVersion: "1", params: { restoredFromAssetId: asset.restoredFromAssetId } }, ...toolPosition, status: "completed" } });
      const outputPosition = availableNodePosition(graph, operations, { kind: "asset", type: "candidate" }, toolPosition.x + 340, toolPosition.y);
      operations.push(
        { type: "add_node", node: { id: outputId, kind: "asset", type: "candidate", title: "恢复的版本", payload: { assetId: asset.id, imageUrl: `/api/design-assets/${encodeURIComponent(asset.id)}/content`, parentAssetId: asset.parentAssetId }, ...outputPosition, status: "completed" } },
        { type: "add_edge", edge: { id: stableMutationId(`restore:input:${asset.id}`), sourceNodeId: source.id, targetNodeId: toolId, sourcePort: "out", targetPort: "source" } },
        { type: "add_edge", edge: { id: stableMutationId(`restore:edge:${asset.id}`), sourceNodeId: toolId, targetNodeId: outputId, sourcePort: "out", targetPort: "source" } },
      );
      result = await this.workflows.applySystemMutation(projectId, { mode: "semantic", mutationId: input.mutationId, baseRevision: graph.revision, operations });
    }
    const latestAttempt = await this.database.workflowAttempt.findFirst({ where: { toolNodeId: toolId }, orderBy: { ordinal: "desc" }, select: { ordinal: true } });
    await this.database.workflowAttempt.upsert({ where: { executionKey: `workflow:restore:${input.mutationId}` }, update: {}, create: {
      projectId, toolNodeId: toolId, ordinal: existingAttempt?.ordinal ?? (latestAttempt?.ordinal ?? 0) + 1, executionKey: `workflow:restore:${input.mutationId}`, status: "completed",
      requestSnapshot: json({ mutationId: input.mutationId, operation: input.operation, inputNodeIds: [source.id], inputSnapshot: [{ id: source.id, payload: source.payload }], restoredFromAssetId: asset.restoredFromAssetId, outputAssetId: asset.id, toolVersion: "1" }),
    } });
    return result;
  }

  private async generationRequest(userId: string, projectId: string, node: Node, sources: Node[], graph: Graph): Promise<GenerationCreateRequest> {
    const params = object(object(node.payload).params);
    const sourceId = graph.edges.find((edge) => edge.targetNodeId === node.id && edge.targetPort === "source")?.sourceNodeId;
    const source = sources.find((item) => item.id === sourceId && item.type === "candidate");
    const sourceAsset = source ? await this.ownedAsset(userId, projectId, text(object(source.payload).assetId)) : null;
    const references: Array<{ order: number; role: "style_ref" | "fabric_texture" | "palette_ref" | "silhouette_ref" | "detail_ref"; url: string; weight: number }> = [];
    for (const item of sources) {
      const payload = object(item.payload);
      if (item.id === source?.id) continue;
      const file = await this.referenceFile(userId, item);
      const url = payload.assetId
        ? await this.referenceUrl((await this.ownedAsset(userId, projectId, text(payload.assetId))).url)
        : file ? await this.storage.createDownloadUrl(file.objectKey, 60 * 60) : null;
      const requestedRole = text(payload.role);
      const role = item.type === "fabric" ? "fabric_texture"
        : item.type === "swatch" ? "palette_ref"
          : (item.type === "reference_image" || item.type === "sketch") && REFERENCE_ROLES.has(requestedRole)
            ? requestedRole as "style_ref" | "silhouette_ref" | "detail_ref" | "fabric_texture" | "palette_ref"
            : item.type === "sketch" ? "silhouette_ref" : "style_ref";
      if (url) references.push({ order: references.length, role, url, weight: 0.7 });
    }
    const prompt = [text(params.prompt), ...sources.filter((item) => ["constraint", "brief", "reference_text", "swatch", "trend", "fabric"].includes(item.type)).map(nodeText)].filter(Boolean).join("\n").slice(0, 4_000);
    const base = { projectId, shapeIds: [], prompt, negativePrompt: text(params.negativePrompt), width: typeof params.width === "number" ? params.width : 768, height: typeof params.height === "number" ? params.height : 1024, quality: params.quality === "low" || params.quality === "medium" ? params.quality : "high", outputFormat: "png" };
    if (params.taskType === "inpaint") {
      if (!sourceAsset || !text(params.maskImageUrl)) throw new BadRequestException("局部重绘需要实际母图与蒙版");
      return generationCreateRequestSchema.parse({ ...base, taskType: "inpaint", parentAssetId: sourceAsset.id, referenceImageUrl: sourceAsset.url, maskImageUrl: params.maskImageUrl, ...(params.palette ? { palette: params.palette } : {}) });
    }
    return generationCreateRequestSchema.parse(sourceAsset
      ? { ...base, taskType: "i2i", parentAssetId: sourceAsset.id, referenceImageUrl: sourceAsset.url, referenceImages: references.slice(0, 15) }
      : { ...base, taskType: "t2i", referenceImages: references.slice(0, 16) });
  }

  private evidence(nodes: Node[]): AgentDesignEvidence[] {
    return nodes.map((node) => ({ id: node.id, kind: node.type === "brief" ? "intent" : "board", label: node.title, text: nodeText(node).slice(0, 3_000), assetId: text(object(node.payload).assetId) || null }));
  }

  private async sourceImages(userId: string, projectId: string, nodes: Node[]): Promise<AmuxClaudeImageInput[]> {
    const images: AmuxClaudeImageInput[] = [];
    for (const node of nodes.slice(0, 8)) {
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
      const fabric = await this.database.fabric.findFirst({ where: { id: text(payload.fabricId), status: "active", OR: [{ scope: "PRESET" }, { ownerId: userId }] }, include: { mainFile: true } });
      if (!fabric || fabric.mainFile.status !== "READY") throw new BadRequestException("面料图不可用");
      return fabric.mainFile;
    }
    if (payload.trendItemId) {
      const trend = await this.database.trendItem.findFirst({ where: { id: text(payload.trendItemId), status: "published" }, include: { coverFile: true } });
      if (!trend) throw new BadRequestException("趋势素材不可用");
      return trend.coverFile?.status === "READY" ? trend.coverFile : null;
    }
    if (payload.fileAssetId) {
      const file = await this.database.fileAsset.findFirst({ where: { id: text(payload.fileAssetId), ownerId: userId, status: "READY" } });
      if (!file) throw new BadRequestException("参考图未就绪");
      return file;
    }
    return null;
  }

  private async ownedAsset(userId: string, projectId: string, assetId: string) {
    const asset = await this.database.designAsset.findFirst({ where: { id: assetId, projectId, archivedAt: null, project: { deletedAt: null, workspace: { ownerId: userId } } } });
    if (!asset) throw new BadRequestException("设计资产不属于当前项目");
    return asset;
  }

  private async ownedProposal(userId: string, projectId: string, id: string) {
    const proposal = await this.database.workflowProposal.findFirst({ where: { id, projectId, userId } });
    if (!proposal) throw new NotFoundException("工作流建议不存在");
    return proposal;
  }

  private proposalView(proposal: { id: string; baseRevision: number; status: string; diff: unknown; evidence: unknown; createdAt: Date }) {
    return { id: proposal.id, baseRevision: proposal.baseRevision, status: proposal.status, operations: proposal.diff, ...object(proposal.evidence), createdAt: proposal.createdAt };
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
