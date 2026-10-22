import { ProjectAccessPolicy, type ProjectAction } from "../studio/project-access.policy";
import { requireProjectFile } from "../files/project-file-access";
import {
  FabricScope,
  Prisma,
  appendWorkflowOutbox,
  recordWorkflowSemanticChange,
  workflowVersionSnapshot,
  type PrismaClient,
  type WorkflowEdge,
  type WorkflowNode,
} from "@fashion/db";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { isWorkflowInputPort, workflowInputConnectionError } from "@fashion/shared";

import {
  workflowAssetTypes,
  workflowToolTypes,
  type WorkflowEdgeInput,
  type WorkflowLayoutPatchInput,
  type WorkflowNodeInput,
  type WorkflowPatchInput,
  type WorkflowSemanticPatchInput,
} from "./workflows.schemas";

export const WORKFLOWS_DB = Symbol("WORKFLOWS_DB");

type WorkflowDatabase = Pick<
  PrismaClient,
  | "$transaction"
  | "project"
  | "projectDesignContext"
  | "workflowGraph"
  | "workflowNode"
  | "workflowEdge"
  | "workflowMutation"
  | "workflowAttempt"
  | "boardSnapshot"
  | "boardElement"
  | "designAsset"
  | "fileAsset"
  | "trendItem"
  | "fabric"
  | "generationTask"
  | "collection"
>;

type WorkflowTransaction = Prisma.TransactionClient;
type GraphNode = Omit<WorkflowNodeInput, "status"> & { status: string };

export interface WorkflowGraphResult {
  readonly projectId: string;
  readonly revision: number;
  readonly layoutRevision: number;
  readonly nodes: readonly (WorkflowNode & { readonly canDelete?: boolean; readonly deleteDisabledReason?: string | null })[];
  readonly edges: readonly WorkflowEdge[];
  readonly legacyAvailable: boolean;
}

const NODE_LIMIT = 300;
const EDGE_LIMIT = 600;
const assetTypes = new Set<string>(workflowAssetTypes);
const toolTypes = new Set<string>(workflowToolTypes);
const toolOutputType: Record<string, string> = {
  analyze_brief: "constraint",
  generate_design: "candidate",
  evaluate_design: "evaluation",
  edit_design: "candidate",
  restore_version: "candidate",
};

@Injectable()
export class WorkflowsService {
  constructor(
    @Inject(WORKFLOWS_DB) private readonly database: WorkflowDatabase,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy = new ProjectAccessPolicy(database as unknown as ConstructorParameters<typeof ProjectAccessPolicy>[0]),
  ) {}

  async get(userId: string, projectId: string): Promise<WorkflowGraphResult> {
    const project = await this.assertProject(projectId, userId);
    const graph = await this.readGraph(projectId);
    return project.archived || !project.canEdit ? { ...graph, nodes: graph.nodes.map((node) => ({ ...node, canDelete: false, deleteDisabledReason: project.archived ? "项目已归档，请先恢复项目" : "当前角色仅可查看项目" })) } : graph;
  }

  async patch(
    userId: string,
    projectId: string,
    input: WorkflowPatchInput,
  ): Promise<WorkflowGraphResult> {
    const project = await this.assertProject(projectId, userId, undefined, "edit");
    if (project.archived) throw archivedProject();
    return this.applyPatch(projectId, userId, input, false);
  }

  /** Internal writes still use the same graph validation, CAS and mutation-id contract. */
  async applySystemMutation(
    projectId: string,
    input: WorkflowSemanticPatchInput,
    expectedContextRevision?: number,
    proposalId?: string,
    transaction?: WorkflowTransaction,
  ): Promise<WorkflowGraphResult> {
    const project = await this.assertProject(projectId, undefined, transaction);
    if (project.archived) throw archivedProject();
    return this.applyPatch(projectId, project.ownerId, input, true, expectedContextRevision, proposalId, transaction);
  }

  private async applyPatch(
    projectId: string,
    ownerId: string,
    input: WorkflowPatchInput,
    system: boolean,
    expectedContextRevision?: number,
    proposalId?: string,
    suppliedTransaction?: WorkflowTransaction,
  ): Promise<WorkflowGraphResult> {
    const requestHash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const database = suppliedTransaction ?? this.database;
    const known = await database.workflowMutation.findUnique({
      where: {
        projectId_mutationId: { projectId, mutationId: input.mutationId },
      },
    });
    if (known) {
      this.assertMatchingMutation(known.requestHash, requestHash);
      return this.readGraph(projectId, suppliedTransaction);
    }

    try {
      const commit = async (transaction: WorkflowTransaction) => {
        if (!system) await this.access.require(ownerId, projectId, "edit", transaction);
        // Match the Coordinator's lock order: conversation, context, graph.
        const acceptanceCandidate = proposalId ? await transaction.workflowProposal.findFirst({ where: { id: proposalId, projectId, status: "pending" } }) : null;
        let acceptanceIntentEpoch: number | null = null;
        if (proposalId && !acceptanceCandidate) throw new ConflictException("建议已被拒绝、接受或失效，请查看最新状态");
        if (acceptanceCandidate && acceptanceCandidate.schemaVersion >= 2) {
          if (acceptanceCandidate.conversationId) {
            const conversation = await transaction.agentConversation.updateMany({ where: { id: acceptanceCandidate.conversationId, projectId }, data: { updatedAt: new Date() } });
            if (conversation.count !== 1) throw new ConflictException("建议所属会话已不存在");
            acceptanceIntentEpoch = (await transaction.agentConversation.findUniqueOrThrow({ where: { id: acceptanceCandidate.conversationId }, select: { intentEpoch: true } })).intentEpoch;
          }
          const project = await transaction.project.updateMany({ where: { id: projectId, workflowAgentVersion: 2 }, data: { updatedAt: new Date() } });
          if (project.count !== 1) throw new ConflictException("项目已切换协作框架版本，请重新请求建议");
        }
        if (expectedContextRevision !== undefined) {
          // Lock the same row updated by context corrections until the graph commit.
          const context = await transaction.projectDesignContext.updateMany({
            where: { projectId, revision: expectedContextRevision },
            data: { updatedAt: new Date() },
          });
          if (context.count !== 1) throw new ConflictException("设计上下文已变化，请重新请求建议");
        }
        const graph = await transaction.workflowGraph.findUnique({
          where: { projectId },
        });
        const baseRevision =
          input.mode === "semantic"
            ? input.baseRevision
            : input.baseLayoutRevision;
        const currentRevision =
          input.mode === "semantic"
            ? (graph?.revision ?? 0)
            : (graph?.layoutRevision ?? 0);
        if (baseRevision !== currentRevision) {
          throw revisionConflict(input.mode, baseRevision, currentRevision);
        }
        if (!graph) {
          await transaction.workflowGraph.create({ data: { projectId } });
        }

        const versionUpdate = await transaction.workflowGraph.updateMany({
          where:
            input.mode === "semantic"
              ? { projectId, revision: input.baseRevision }
              : { projectId, layoutRevision: input.baseLayoutRevision },
          data:
            input.mode === "semantic"
              ? { revision: { increment: 1 } }
              : { layoutRevision: { increment: 1 } },
        });
        if (versionUpdate.count !== 1) {
          throw revisionConflict(input.mode, baseRevision);
        }
        if (proposalId) {
          const candidate = acceptanceCandidate;
          if (!candidate) throw new ConflictException("建议已被拒绝、接受或失效，请查看最新状态");
          if (candidate.schemaVersion >= 2) {
            const evidence = jsonObject(candidate.evidence);
            if (typeof evidence.intentEpoch === "number" && acceptanceIntentEpoch !== null && evidence.intentEpoch !== acceptanceIntentEpoch) throw new ConflictException("会话设计意图已变化，请重新请求建议");
            const action = jsonObject(evidence.action as Prisma.JsonValue);
            if (candidate.targetNodeVersionId) {
              const targetId = typeof action.targetNodeId === "string" ? action.targetNodeId : null;
              if (!targetId) throw new ConflictException("建议缺少目标节点，请重新请求建议");
              const latest = targetId ? await transaction.workflowNodeVersion.findFirst({ where: { projectId, nodeId: targetId }, orderBy: { version: "desc" } }) : null;
              if (!latest || latest.id !== candidate.targetNodeVersionId) throw new ConflictException("目标节点版本已变化，请重新请求建议");
              if (action.kind === "configure" || action.type === "configure" || action.type === "configure_tool") {
                const target = await transaction.workflowNode.findFirst({ where: { id: targetId, projectId }, select: { status: true } });
                const attempt = await transaction.workflowAttempt.findFirst({ where: { projectId, toolNodeId: targetId }, select: { id: true } });
                if (target?.status !== "ready" || attempt) throw new ConflictException("目标工具已执行，请改为创建新分支");
              }
            }
            if (candidate.conversationId && candidate.planRevision !== null) {
              const plan = await transaction.agentPlanRevision.findFirst({ where: { projectId, conversationId: candidate.conversationId }, orderBy: { revision: "desc" }, select: { revision: true, intentEpoch: true } });
              if (plan?.revision !== candidate.planRevision) throw new ConflictException("设计计划已变化，请重新请求建议");
              if (acceptanceIntentEpoch !== null && plan.intentEpoch !== acceptanceIntentEpoch) throw new ConflictException("会话设计意图已变化，请重新请求建议");
            }
          }
          const proposal = await transaction.workflowProposal.updateMany({
            where: { id: proposalId, projectId, status: "pending" }, data: { status: "accepted" },
          });
          if (proposal.count !== 1) throw new ConflictException("建议已被拒绝、接受或失效，请查看最新状态");
          await appendWorkflowOutbox(transaction, { projectId, eventKey: `proposal:${proposalId}:accepted`, eventType: "proposal.decision", payload: { proposalId, kind: "accepted", userId: ownerId, conversationId: candidate.conversationId } });
        }

        let snapshots: { before: Prisma.InputJsonObject; after: Prisma.InputJsonObject } | undefined;
        if (input.mode === "semantic") {
          snapshots = await this.applySemantic(
            transaction,
            projectId,
            ownerId,
            input,
            system,
            proposalId ? "proposal" : system ? "system" : "user",
          );
        } else {
          await this.applyLayout(transaction, projectId, input);
        }

        await transaction.workflowMutation.create({
          data: {
            projectId,
            mutationId: input.mutationId,
            mode: input.mode,
            requestHash,
            baseRevision,
            resultRevision: baseRevision + 1,
            actorId: ownerId,
            origin: proposalId ? "proposal" : system ? "system" : "user",
            ...(snapshots ? { beforeSnapshot: snapshots.before, afterSnapshot: snapshots.after } : {}),
          },
        });
      };
      if (suppliedTransaction) await commit(suppliedTransaction);
      else await this.database.$transaction(commit);
    } catch (error) {
      // The owner of a supplied transaction controls its rollback and retry.
      if (suppliedTransaction) throw error;
      // A retry can race the original transaction. The unique mutation row is the
      // authority for whether it was already committed.
      const replay = await this.database.workflowMutation.findUnique({
        where: {
          projectId_mutationId: { projectId, mutationId: input.mutationId },
        },
      });
      if (replay) {
        this.assertMatchingMutation(replay.requestHash, requestHash);
        return this.readGraph(projectId);
      }
      if (isUniqueConflict(error))
        throw revisionConflict(
          input.mode,
          input.mode === "semantic"
            ? input.baseRevision
            : input.baseLayoutRevision,
        );
      throw error;
    }

    return this.readGraph(projectId, suppliedTransaction);
  }

  private async applySemantic(
    transaction: WorkflowTransaction,
    projectId: string,
    ownerId: string,
    input: WorkflowSemanticPatchInput,
    system: boolean,
    origin: string,
  ): Promise<{ before: Prisma.InputJsonObject; after: Prisma.InputJsonObject }> {
    const [storedNodes, storedEdges] = await Promise.all([
      transaction.workflowNode.findMany({ where: { projectId } }),
      transaction.workflowEdge.findMany({ where: { projectId } }),
    ]);
    const nodes = new Map<string, GraphNode>(
      storedNodes.map((node) => [
        node.id,
        {
          id: node.id,
          kind: node.kind as "asset" | "tool",
          type: node.type as GraphNode["type"],
          title: node.title,
          payload: jsonObject(node.payload),
          status: node.status,
          x: node.x,
          y: node.y,
        } as GraphNode,
      ]),
    );
    const edges = new Map<string, WorkflowEdgeInput>(
      storedEdges.map((edge) => [
        edge.id,
        {
          id: edge.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          sourcePort: "out",
          targetPort: edge.targetPort as WorkflowEdgeInput["targetPort"],
        },
      ]),
    );
    const removedNodeIds = new Set<string>();
    const executedToolIds = new Set(
      storedNodes
        .filter((node) => node.kind === "tool" && node.status !== "ready")
        .map((node) => node.id),
    );
    const frozenAssetIds = new Set(
      storedEdges
        .filter((edge) => executedToolIds.has(edge.targetNodeId))
        .map((edge) => edge.sourceNodeId),
    );

    for (const operation of input.operations) {
      switch (operation.type) {
        case "add_node": {
          if (
            nodes.has(operation.node.id) ||
            removedNodeIds.has(operation.node.id)
          )
            throw invalidGraph("节点 ID 已存在或已在本次变更中删除");
          if (
            !system &&
            operation.node.status &&
            operation.node.status !== "ready"
          ) {
            throw invalidGraph("用户不能直接设置节点执行状态");
          }
          nodes.set(operation.node.id, {
            ...operation.node,
            status: operation.node.status ?? "ready",
          } as GraphNode);
          break;
        }
        case "update_node": {
          const current = nodes.get(operation.nodeId);
          if (!current) throw invalidGraph("待修改的节点不存在");
          if (
            !system &&
            (operation.status !== undefined || current.status !== "ready")
          ) {
            throw invalidGraph("已执行节点或执行状态不能由画布直接修改");
          }
          if (
            !system &&
            current.kind === "asset" &&
            frozenAssetIds.has(current.id)
          ) {
            throw invalidGraph(
              "已被执行工具使用的素材不能修改，请从该素材创建新分支",
            );
          }
          nodes.set(operation.nodeId, {
            ...current,
            ...(operation.title !== undefined
              ? { title: operation.title }
              : {}),
            ...(operation.payload !== undefined
              ? { payload: operation.payload }
              : {}),
            ...(operation.status !== undefined
              ? { status: operation.status }
              : {}),
          } as GraphNode);
          break;
        }
        case "remove_node": {
          const current = nodes.get(operation.nodeId);
          if (!current) throw invalidGraph("待删除的节点不存在");
          if (!system && current.status !== "ready")
            throw invalidGraph("已执行节点不能删除");
          if (
            !system &&
            current.kind === "asset" &&
            frozenAssetIds.has(current.id)
          ) {
            throw invalidGraph(
              "已被执行工具使用的素材不能删除，请保留历史路径",
            );
          }
          nodes.delete(operation.nodeId);
          removedNodeIds.add(operation.nodeId);
          for (const [edgeId, edge] of edges) {
            if (
              edge.sourceNodeId === operation.nodeId ||
              edge.targetNodeId === operation.nodeId
            ) {
              edges.delete(edgeId);
            }
          }
          break;
        }
        case "add_edge": {
          if (edges.has(operation.edge.id))
            throw invalidGraph("连线 ID 已存在");
          edges.set(operation.edge.id, operation.edge);
          break;
        }
        case "remove_edge": {
          if (!edges.has(operation.edgeId))
            throw invalidGraph("待删除的连线不存在");
          edges.delete(operation.edgeId);
          break;
        }
        case "link_collection": {
          const current = nodes.get(operation.nodeId);
          if (
            !current ||
            current.kind !== "asset" ||
            current.type !== "candidate" ||
            typeof current.payload.assetId !== "string"
          ) {
            throw invalidGraph("系列只能关联实际候选资产");
          }
          // Series membership is a reference, not a change to the design that
          // an earlier execution consumed. The original payload stays intact.
          nodes.set(current.id, {
            ...current,
            payload: {
              ...current.payload,
              collectionId: operation.collectionId,
            },
          });
          break;
        }
      }
    }

    validateGraph(nodes, edges);
    const storedNodeById = new Map(storedNodes.map((node) => [node.id, node]));
    const changedNodes = new Map<string, GraphNode>();
    for (const [id, node] of nodes) {
      const previous = storedNodeById.get(id);
      if (
        previous &&
        (previous.kind !== node.kind || previous.type !== node.type)
      ) {
        throw invalidGraph("既有节点的类型不能更改");
      }
      if (
        !previous ||
        JSON.stringify(previous.payload) !== JSON.stringify(node.payload)
      ) {
        changedNodes.set(id, node);
      }
    }
    await this.validateReferences(
      transaction,
      projectId,
      ownerId,
      changedNodes,
    );
    if (!system)
      this.validateUserEdgeMutations(input, storedNodes, storedEdges, nodes, edges);

    const storedEdgeById = new Map(storedEdges.map((edge) => [edge.id, edge]));
    for (const edge of storedEdges) {
      if (!edges.has(edge.id))
        await transaction.workflowEdge.delete({ where: { id: edge.id } });
    }
    for (const node of storedNodes) {
      if (!nodes.has(node.id))
        await transaction.workflowNode.delete({ where: { id: node.id } });
    }
    for (const [id, node] of nodes) {
      const previous = storedNodeById.get(id);
      if (!previous) {
        const historical = await transaction.workflowNodeVersion.findFirst({ where: { nodeId: id }, select: { id: true } });
        if (historical) throw invalidGraph("节点 ID 已用于历史版本，请创建新的节点 ID");
        await transaction.workflowNode.create({
          data: {
            id,
            projectId,
            kind: node.kind,
            type: node.type,
            title: node.title,
            payload: node.payload as Prisma.InputJsonObject,
            status: node.status,
            x: node.x,
            y: node.y,
          },
        });
      } else if (
        previous.title !== node.title ||
        previous.status !== node.status ||
        JSON.stringify(previous.payload) !== JSON.stringify(node.payload)
      ) {
        await transaction.workflowNode.update({
          where: { id },
          data: {
            title: node.title,
            status: node.status,
            payload: node.payload as Prisma.InputJsonObject,
          },
        });
      }
    }
    for (const [id, edge] of edges) {
      const previous = storedEdgeById.get(id);
      if (!previous) {
        await transaction.workflowEdge.create({ data: { ...edge, projectId } });
      } else if (
        previous.sourceNodeId !== edge.sourceNodeId ||
        previous.targetNodeId !== edge.targetNodeId ||
        previous.sourcePort !== edge.sourcePort ||
        previous.targetPort !== edge.targetPort
      ) {
        throw invalidGraph("既有连线 ID 不能重新指向其他节点");
      }
    }
    const afterNodes = [...nodes.values()];
    const afterEdges = [...edges.values()];
    await recordWorkflowSemanticChange(transaction, {
      projectId, mutationId: input.mutationId, baseRevision: input.baseRevision, resultRevision: input.baseRevision + 1,
      actorId: ownerId, origin, before: { nodes: storedNodes, edges: storedEdges }, after: { nodes: afterNodes, edges: afterEdges },
    });
    return { before: workflowVersionSnapshot(storedNodes, storedEdges), after: workflowVersionSnapshot(afterNodes, afterEdges) };
  }

  private async applyLayout(
    transaction: WorkflowTransaction,
    projectId: string,
    input: WorkflowLayoutPatchInput,
  ): Promise<void> {
    const ids = input.positions.map((position) => position.nodeId);
    if (new Set(ids).size !== ids.length)
      throw invalidGraph("布局变更含重复节点");
    const found = await transaction.workflowNode.findMany({
      where: { projectId, id: { in: ids } },
      select: { id: true },
    });
    if (found.length !== ids.length)
      throw invalidGraph("布局节点不存在或不属于当前项目");
    for (const position of input.positions) {
      await transaction.workflowNode.update({
        where: { id: position.nodeId },
        data: { x: position.x, y: position.y },
      });
    }
  }

  private validateUserEdgeMutations(
    input: WorkflowSemanticPatchInput,
    storedNodes: readonly WorkflowNode[],
    storedEdges: readonly WorkflowEdge[],
    nextNodes: ReadonlyMap<string, GraphNode>,
    nextEdges: ReadonlyMap<string, WorkflowEdgeInput>,
  ): void {
    const existingNodes = new Map(storedNodes.map((node) => [node.id, node]));
    const existingEdges = new Map(storedEdges.map((edge) => [edge.id, edge]));
    const assertEditableTool = (nodeId: string): void => {
      const node = existingNodes.get(nodeId);
      if (node?.kind === "tool" && node.status !== "ready") {
        throw invalidGraph("已执行工具的输入和输出不能修改，请创建新分支");
      }
    };
    for (const operation of input.operations) {
      if (operation.type === "add_edge") {
        const source = nextNodes.get(operation.edge.sourceNodeId);
        const target = nextNodes.get(operation.edge.targetNodeId);
        if (source?.kind === "tool" && (existingNodes.has(source.id) || (target && existingNodes.has(target.id))))
          throw invalidGraph("结果来源由工具执行维护，不能手动改写");
        if (source?.kind === "tool") assertEditableTool(source.id);
        if (target?.kind === "tool") assertEditableTool(target.id);
        if (source?.kind === "asset" && target?.kind === "tool") {
          const reason = workflowInputConnectionError(source.type, target.type, operation.edge, [...nextEdges.values()].filter((edge) => edge.id !== operation.edge.id));
          if (reason) throw invalidGraph(reason);
        }
      } else if (operation.type === "remove_edge") {
        const edge = existingEdges.get(operation.edgeId);
        if (edge) {
          if (existingNodes.get(edge.sourceNodeId)?.kind === "tool") throw invalidGraph("结果来源由工具执行维护，不能手动改写");
          assertEditableTool(edge.sourceNodeId);
          assertEditableTool(edge.targetNodeId);
        }
      }
    }
  }

  private async validateReferences(
    transaction: WorkflowTransaction,
    projectId: string,
    ownerId: string,
    nodes: ReadonlyMap<string, GraphNode>,
  ): Promise<void> {
    for (const node of nodes.values()) {
      if (node.kind === "tool") {
        if (
          node.payload.toolKey !== node.type ||
          typeof node.payload.toolVersion !== "string"
        ) {
          throw invalidGraph("工具节点必须声明匹配的 toolKey 和 toolVersion");
        }
      }
      const references = [
        "assetId",
        "fileAssetId",
        "trendItemId",
        "fabricId",
        "boardElementId",
        "generationTaskId",
        "collectionId",
      ] as const;
      for (const key of references) {
        const id = node.payload[key];
        if (id === undefined || id === null) continue;
        if (typeof id !== "string" || !id.trim())
          throw invalidGraph(`${key} 必须是有效 ID`);
        let valid = false;
        switch (key) {
          case "assetId": {
            const asset = await transaction.designAsset.findUnique({
              where: { id },
              select: { projectId: true },
            });
            valid = asset?.projectId === projectId;
            break;
          }
          case "fileAssetId": {
            const file = await transaction.fileAsset.findUnique({
              where: { id },
              select: { ownerId: true },
            });
            valid = file?.ownerId === ownerId;
            if (file && !valid) {
              try { await requireProjectFile(transaction, this.access, ownerId, id, projectId, transaction); valid = true; } catch (error) { if (error instanceof ForbiddenException || error instanceof NotFoundException) valid = false; else throw error; }
            }
            break;
          }
          case "trendItemId": {
            const trend = await transaction.trendItem.findUnique({
              where: { id },
              select: { status: true },
            });
            valid = trend?.status === "published";
            break;
          }
          case "fabricId": {
            const fabric = await transaction.fabric.findUnique({
              where: { id },
              select: { ownerId: true, scope: true, status: true, mainFileId: true },
            });
            valid = Boolean(
              fabric &&
              fabric.status === "active" &&
              (fabric.scope === FabricScope.PRESET ||
                fabric.ownerId === ownerId),
            );
            if (fabric?.status === "active" && !valid) {
              try { await requireProjectFile(transaction, this.access, ownerId, fabric.mainFileId, projectId, transaction); valid = true; } catch (error) { if (!(error instanceof ForbiddenException || error instanceof NotFoundException)) throw error; }
            }
            break;
          }
          case "boardElementId": {
            const element = await transaction.boardElement.findUnique({
              where: { id },
              select: { projectId: true, deletedAt: true },
            });
            valid = element?.projectId === projectId && !element.deletedAt;
            break;
          }
          case "generationTaskId": {
            const task = await transaction.generationTask.findUnique({
              where: { id },
              select: { projectId: true },
            });
            valid = task?.projectId === projectId;
            break;
          }
          case "collectionId": {
            const collection = await transaction.collection.findUnique({
              where: { id },
              select: { projectId: true, heroAssetId: true },
            });
            valid =
              collection?.projectId === projectId &&
              (node.type !== "candidate" ||
                collection.heroAssetId === node.payload.assetId);
            break;
          }
        }
        if (!valid) throw invalidGraph(`${key} 不存在或无权引用`);
      }
    }
  }

  private async assertProject(
    projectId: string,
    userId?: string,
    transaction?: WorkflowTransaction,
    action: ProjectAction = "read",
  ): Promise<{ readonly archived: boolean; readonly ownerId: string; readonly canEdit: boolean }> {
    const project = await (transaction ?? this.database).project.findUnique({
      where: { id: projectId },
      select: {
        archived: true,
        deletedAt: true,
        workspace: { select: { ownerId: true } },
      },
    });
    if (!project || project.deletedAt) {
      throw new NotFoundException({
        code: "PROJECT_NOT_FOUND",
        message: "项目不存在",
      });
    }
    const permission = userId ? await this.access.require(userId, projectId, action, transaction) : null;
    return { archived: project.archived, ownerId: project.workspace.ownerId, canEdit: permission?.capabilities.edit ?? true };
  }

  private async readGraph(projectId: string, suppliedTransaction?: WorkflowTransaction): Promise<WorkflowGraphResult> {
    const read = async (transaction: WorkflowTransaction) => {
          const graph = await transaction.workflowGraph.findUnique({
            where: { projectId },
          });
          const nodes = await transaction.workflowNode.findMany({
            where: { projectId },
            orderBy: { createdAt: "asc" },
          });
          const edges = await transaction.workflowEdge.findMany({
            where: { projectId },
            orderBy: { createdAt: "asc" },
          });
          const snapshot = await transaction.boardSnapshot.findUnique({
            where: { projectId },
            select: { projectId: true },
          });
          const legacyElement = await transaction.boardElement.findFirst({
            where: { projectId, deletedAt: null },
            select: { id: true },
          });
          return [graph, nodes, edges, snapshot, legacyElement] as const;
    };
    const [graph, nodes, edges, snapshot, legacyElement] = suppliedTransaction
      ? await read(suppliedTransaction)
      : await this.database.$transaction(read, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return {
      projectId,
      revision: graph?.revision ?? 0,
      layoutRevision: graph?.layoutRevision ?? 0,
      nodes: nodes.map((node) => {
        const frozen = node.kind === "asset" && edges.some((edge) =>
          edge.sourceNodeId === node.id && nodes.some((target) => target.id === edge.targetNodeId && target.status !== "ready"));
        const deleteDisabledReason = node.status !== "ready" ? "已执行或正在处理的节点需要保留历史路径"
          : frozen ? "该素材已被执行工具引用，需要保留历史路径" : null;
        return { ...node, canDelete: deleteDisabledReason === null, deleteDisabledReason };
      }),
      edges,
      legacyAvailable: Boolean(snapshot || legacyElement),
    };
  }

  private assertMatchingMutation(
    storedHash: string,
    requestHash: string,
  ): void {
    if (storedHash !== requestHash) {
      throw new ConflictException({
        code: "WORKFLOW_MUTATION_REUSED",
        message: "同一个 mutationId 不能用于不同变更",
      });
    }
  }
}

function jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function invalidGraph(message: string): BadRequestException {
  return new BadRequestException({ code: "WORKFLOW_GRAPH_INVALID", message });
}

function archivedProject(): NotFoundException {
  return new NotFoundException({
    code: "PROJECT_ARCHIVED",
    message: "项目已归档，请先恢复项目后继续编辑",
  });
}

function revisionConflict(
  mode: "semantic" | "layout",
  expected: number,
  current?: number,
): ConflictException {
  return new ConflictException({
    code: "WORKFLOW_REVISION_CONFLICT",
    message: "工作流已由其他操作更新，请重新载入后再试",
    mode,
    expectedRevision: expected,
    ...(current !== undefined ? { currentRevision: current } : {}),
  });
}

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function validateGraph(
  nodes: ReadonlyMap<string, GraphNode>,
  edges: ReadonlyMap<string, WorkflowEdgeInput>,
): void {
  if (nodes.size > NODE_LIMIT || edges.size > EDGE_LIMIT)
    throw invalidGraph("工作流节点或连线超过上限");
  for (const node of nodes.values()) {
    if (node.kind === "asset" && !assetTypes.has(node.type))
      throw invalidGraph("素材节点类型无效");
    if (node.kind === "tool" && !toolTypes.has(node.type))
      throw invalidGraph("工具节点类型无效");
    if (node.kind !== "asset" && node.kind !== "tool")
      throw invalidGraph("节点类型无效");
  }
  const incomingProducer = new Set<string>();
  const edgeSignatures = new Set<string>();
  const adjacency = new Map<string, string[]>();
  for (const edge of edges.values()) {
    const source = nodes.get(edge.sourceNodeId);
    const target = nodes.get(edge.targetNodeId);
    if (!source || !target) throw invalidGraph("连线引用的节点不存在");
    if (source.id === target.id || source.kind === target.kind)
      throw invalidGraph("仅允许素材与工具交替连接");
    if (edge.sourcePort !== "out") throw invalidGraph("输出端口无效");
    const signature = `${edge.sourceNodeId}\0${edge.targetNodeId}\0${edge.targetPort}`;
    if (edgeSignatures.has(signature)) throw invalidGraph("重复连线无效");
    edgeSignatures.add(signature);

    if (source.kind === "asset") {
      if (
        target.kind !== "tool" ||
        !isWorkflowInputPort(source.type, target.type, edge.targetPort)
      ) {
        throw invalidGraph("素材类型与工具输入端口不匹配");
      }
    } else {
      if (
        edge.targetPort !== "source" ||
        target.type !== toolOutputType[source.type]
      ) {
        throw invalidGraph("工具输出类型与素材节点不匹配");
      }
      if (incomingProducer.has(target.id))
        throw invalidGraph("一个素材不能有多个生成工具");
      incomingProducer.add(target.id);
    }
    const next = adjacency.get(source.id) ?? [];
    next.push(target.id);
    adjacency.set(source.id, next);
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (nodeId: string): void => {
    if (active.has(nodeId)) throw invalidGraph("工作流不能包含循环");
    if (visited.has(nodeId)) return;
    active.add(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) visit(next);
    active.delete(nodeId);
    visited.add(nodeId);
  };
  for (const id of nodes.keys()) visit(id);
}
