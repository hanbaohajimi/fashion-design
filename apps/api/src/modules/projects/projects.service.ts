import { Prisma, ensureWorkflowNodeVersions, type PrismaClient } from "@fashion/db";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";

import {
  isRetiredBoardShapeType,
  RETIRED_BOARD_SHAPE_TYPE,
  stripRetiredBoardShapes,
} from "../boards/boards.schemas";
import type {
  CreateProjectInput,
  ListProjectsInput,
  UpdateProjectInput,
} from "./projects.schemas";

import { ProjectAccessPolicy, type ProjectAction } from "../studio/project-access.policy";

export const PROJECTS_DB = Symbol("PROJECTS_DB");

type ProjectsDatabase = Pick<
  PrismaClient,
  "$transaction" | "designAsset" | "project" | "workspace" | "workspaceMember"
>;

interface ProjectRecord {
  readonly _count?: {
    readonly designAssets: number;
  };
  readonly archived: boolean;
  readonly coverAssetId: string | null;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
  readonly id: string;
  readonly name: string;
  readonly designAssets?: readonly {
    readonly id: string;
  }[];
  readonly updatedAt: Date;
}

function toProjectResponse(project: ProjectRecord) {
  const coverAssetId =
    project.coverAssetId ?? project.designAssets?.[0]?.id ?? null;
  return {
    archived: project.archived,
    assetCount: project._count?.designAssets ?? 0,
    coverAssetId,
    coverUrl: coverAssetId
      ? `/api/design-assets/${encodeURIComponent(coverAssetId)}/thumbnail`
      : null,
    createdAt: project.createdAt,
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
  };
}

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PROJECTS_DB) private readonly database: ProjectsDatabase,
    @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy = new ProjectAccessPolicy(database),
  ) {}

  async list(userId: string, input: ListProjectsInput) {
    const archived =
      input.archived === "all" ? undefined : input.archived === "archived";
    const where: Prisma.ProjectWhereInput = {
      ...this.access.readableWhere(userId),
      ...(archived === undefined ? {} : { archived }),
      ...(input.search
        ? {
            name: {
              contains: input.search,
              mode: "insensitive",
            },
          }
        : {}),
    };
    const skip = (input.page - 1) * input.limit;
    const statsProjectWhere: Prisma.ProjectWhereInput = {
      archived: false,
      ...this.access.readableWhere(userId),
    };
    const [projects, total, activeProjects, totalAssets, projectsWithAssets] =
      await Promise.all([
        this.database.project.findMany({
          include: {
            _count: { select: { designAssets: true } },
            designAssets: {
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              select: { id: true },
              take: 1,
            },
          },
          where,
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          skip,
          take: input.limit,
        }),
        this.database.project.count({ where }),
        this.database.project.count({ where: statsProjectWhere }),
        this.database.designAsset.count({
          where: { project: statsProjectWhere },
        }),
        this.database.project.count({
          where: {
            ...statsProjectWhere,
            designAssets: { some: {} },
          },
        }),
      ]);

    return {
      hasMore: skip + projects.length < total,
      items: projects.map(toProjectResponse),
      page: input.page,
      pageSize: input.limit,
      stats: {
        activeProjects,
        coverRate:
          activeProjects === 0
            ? 0
            : Math.round((projectsWithAssets / activeProjects) * 100),
        totalAssets,
      },
      total,
    };
  }

  async get(userId: string, projectId: string) {
    return toProjectResponse(await this.assertOwnership(userId, projectId, false, "read"));
  }

  async create(
    userId: string,
    input: CreateProjectInput,
    idempotencyKey: string,
  ) {
    const workspace = await this.database.workspace.findFirst({
      where: { ownerId: userId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (!workspace) {
      throw new NotFoundException({
        code: "WORKSPACE_NOT_FOUND",
        message: "未找到当前用户的工作区",
      });
    }

    const existing = await this.database.project.findFirst({
      where: {
        idempotencyKey,
        wsId: workspace.id,
      },
    });

    if (existing) {
      if (existing.deletedAt) {
        throw new ConflictException({
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "该幂等键已用于一个删除的项目，请重新创建",
        });
      }

      return toProjectResponse(existing);
    }

    try {
      const project = await this.database.project.create({
        data: {
          idempotencyKey,
          name: input.name,
          wsId: workspace.id,
        },
      });

      return toProjectResponse(project);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const duplicated = await this.database.project.findFirst({
          where: {
            idempotencyKey,
            wsId: workspace.id,
          },
        });

        if (duplicated && !duplicated.deletedAt) {
          return toProjectResponse(duplicated);
        }
      }

      throw error;
    }
  }

  async update(userId: string, projectId: string, input: UpdateProjectInput) {
    await this.assertOwnership(userId, projectId);
    const project = await this.database.project.update({
      where: { id: projectId },
      include: {
        _count: { select: { designAssets: true } },
        designAssets: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
          take: 1,
        },
      },
      data: {
        ...(input.archived === undefined ? {} : { archived: input.archived }),
        ...(input.name === undefined ? {} : { name: input.name }),
      },
    });

    return toProjectResponse(project);
  }

  async duplicate(userId: string, projectId: string, idempotencyKey: string) {
    const authorizedSource = await this.assertOwnership(userId, projectId);
    try {
      const duplicated = await this.database.$transaction(async (transaction) => {
    const source = await transaction.project.findUnique({
      where: { id: projectId },
      include: {
        boardElements: {
          where: { shapeType: { not: RETIRED_BOARD_SHAPE_TYPE } },
        },
        boardSnapshot: true,
        collections: {
          include: {
            dna: true,
            looks: true,
            similarities: true,
          },
        },
        designAssets: true,
        workflowGraph: { include: { nodes: true, edges: true } },
        designContext: true,
        workspace: { select: { ownerId: true } },
      },
    });
    if (!source || source.deletedAt) {
      throw new NotFoundException({
        code: "PROJECT_NOT_FOUND",
        message: "项目不存在",
      });
    }
    await this.access.require(userId, projectId, "edit", transaction);
    const existing = await transaction.project.findFirst({
      where: { idempotencyKey, wsId: source.wsId },
    });
    if (existing && !existing.deletedAt) {
      return existing;
    }
    if (existing) throw new ConflictException("该幂等键已用于删除的项目");
          const assetIdMap = new Map(
            source.designAssets.map((asset) => [asset.id, randomUUID()]),
          );
          const ids = new Map<string, string>(assetIdMap);
          for (const item of [...source.collections, ...source.boardElements, ...(source.workflowGraph?.nodes ?? []), ...(source.workflowGraph?.edges ?? [])]) {
            if (item.id) ids.set(item.id, randomUUID());
          }
          const remappedCoverAssetId = source.coverAssetId
            ? (assetIdMap.get(source.coverAssetId) ?? null)
            : null;
          const project = await transaction.project.create({
            data: {
              coverAssetId: remappedCoverAssetId,
              idempotencyKey,
              name: `${source.name} 副本`.slice(0, 80),
              wsId: source.wsId,
              workflowAgentVersion: source.workflowAgentVersion,
            },
          });
          ids.set(source.id, project.id);
          if (source.designAssets.length > 0) {
            await transaction.designAsset.createMany({
              data: source.designAssets.map((asset) => {
                const id = requiredMappedId(assetIdMap, asset.id);
                return {
                  archivedAt: asset.archivedAt,
                  generationTaskId: null,
                  sourceFileId: asset.sourceFileId,
                  height: asset.height,
                  id,
                  operation: asset.operation,
                  parentAssetId: asset.parentAssetId
                    ? (assetIdMap.get(asset.parentAssetId) ?? null)
                    : null,
                  projectId: project.id,
                  restoredFromAssetId: asset.restoredFromAssetId
                    ? (assetIdMap.get(asset.restoredFromAssetId) ?? null)
                    : null,
                  rootAssetId: assetIdMap.get(asset.rootAssetId) ?? id,
                  seed: asset.seed,
                  thumbnailUrl: asset.thumbnailUrl,
                  url: asset.url,
                  width: asset.width,
                };
              }),
            });
          }
          if (source.boardSnapshot) {
            await transaction.boardSnapshot.create({
              data: {
                projectId: project.id,
                revision: 0,
                snapshot:
                  source.boardSnapshot.snapshot === null
                    ? Prisma.JsonNull
                    : (remapStructuredValue(
                        stripRetiredBoardShapes(
                          source.boardSnapshot.snapshot,
                        ),
                        ids,
                      ) as Prisma.InputJsonValue),
              },
            });
          }
          const copyableBoardElements = source.boardElements.filter(
            (element) => !isRetiredBoardShapeType(element.shapeType),
          );
          if (copyableBoardElements.length > 0) {
            await transaction.boardElement.createMany({
              data: copyableBoardElements.map((element) => ({
                ...(element.id ? { id: requiredMappedId(ids, element.id) } : {}),
                deletedAt: element.deletedAt,
                fileAssetId: element.fileAssetId,
                projectId: project.id,
                record:
                  element.record === null
                    ? Prisma.JsonNull
                    : (remapStructuredValue(
                        element.record,
                        ids,
                      ) as Prisma.InputJsonValue),
                role: element.role,
                roleConfidence: element.roleConfidence,
                roleInferenceState: element.roleInferenceState,
                roleLabel: element.roleLabel,
                roleSource: element.roleSource,
                shapeId: element.shapeId,
                shapeType: element.shapeType,
              })),
            });
          }
          for (const sourceCollection of source.collections) {
            const collectionId = requiredMappedId(ids, sourceCollection.id);
            await transaction.collection.create({
              data: {
                heroAssetId: requiredMappedId(
                  assetIdMap,
                  sourceCollection.heroAssetId,
                ),
                id: collectionId,
                name: sourceCollection.name,
                projectId: project.id,
                sourceGarmentTypeCode: sourceCollection.sourceGarmentTypeCode,
                sourceGarmentTypeLabel: sourceCollection.sourceGarmentTypeLabel,
              },
            });
            if (sourceCollection.dna) {
              const dna = sourceCollection.dna;
              await transaction.collectionDna.create({
                data: {
                  collectionId,
                  extractionStatus: dna.extractionStatus,
                  fabrics: dna.fabrics,
                  fabricsLocked: dna.fabricsLocked,
                  moodWords: dna.moodWords,
                  moodWordsLocked: dna.moodWordsLocked,
                  palette: dna.palette as Prisma.InputJsonValue,
                  paletteLocked: dna.paletteLocked,
                  referenceFileIds: dna.referenceFileIds,
                  signatureDetails: dna.signatureDetails,
                  silhouettes: dna.silhouettes,
                  silhouettesLocked: dna.silhouettesLocked,
                },
              });
            }
            if (sourceCollection.looks.length > 0) {
              await transaction.collectionLook.createMany({
                data: sourceCollection.looks.map((look) => ({
                  analysisStatus: look.analysisStatus,
                  collectionId,
                  designAssetId: requiredMappedId(
                    assetIdMap,
                    look.designAssetId,
                  ),
                  isHero: look.isHero,
                  garmentTypeCode: look.garmentTypeCode,
                  garmentTypeLabel: look.garmentTypeLabel,
                  ordinal: look.ordinal,
                  similarityScore: look.similarityScore,
                  slotKey: look.slotKey,
                  variationAxis: look.variationAxis,
                  warningIgnored: look.warningIgnored,
                })),
              });
            }
            if (sourceCollection.similarities.length > 0) {
              await transaction.collectionLookSimilarity.createMany({
                data: sourceCollection.similarities.map((similarity) => ({
                  collectionId,
                  leftAssetId: requiredMappedId(
                    assetIdMap,
                    similarity.leftAssetId,
                  ),
                  rightAssetId: requiredMappedId(
                    assetIdMap,
                    similarity.rightAssetId,
                  ),
                  score: similarity.score,
                })),
              });
            }
          }
          if (source.workflowGraph) {
            const sourceGraph = source.workflowGraph;
            await transaction.workflowGraph.create({ data: { projectId: project.id } });
            const nodes = source.workflowGraph.nodes.map((node) => ({
              id: requiredMappedId(ids, node.id), projectId: project.id, kind: node.kind, type: node.type, title: node.title,
              payload: remapStructuredValue(node.payload, ids, true) as Prisma.InputJsonValue,
              status: node.status === "completed" && (node.kind === "asset" || sourceGraph.edges.some((edge) => edge.sourceNodeId === node.id && sourceGraph.nodes.some((output) => output.id === edge.targetNodeId && output.status === "completed"))) ? "completed" : "ready",
              x: node.x, y: node.y,
            }));
            const edges = source.workflowGraph.edges.map((edge) => ({ id: requiredMappedId(ids, edge.id), projectId: project.id,
              sourceNodeId: requiredMappedId(ids, edge.sourceNodeId), targetNodeId: requiredMappedId(ids, edge.targetNodeId), sourcePort: edge.sourcePort, targetPort: edge.targetPort }));
            if (nodes.length) await transaction.workflowNode.createMany({ data: nodes });
            if (edges.length) await transaction.workflowEdge.createMany({ data: edges });
            await ensureWorkflowNodeVersions(transaction, project.id, 0, nodes, edges);
            await transaction.workflowNodeVersion.updateMany({ where: { projectId: project.id, baseline: true }, data: { origin: "project_copy" } });
          }
          if (source.designContext) {
            const state = source.designContext.state as Record<string, Prisma.JsonValue>;
            await transaction.projectDesignContext.create({ data: { projectId: project.id, state: {
              version: "project-design-context/1", initialObjective: state.currentObjective ?? null, currentObjective: state.currentObjective ?? null,
              objectiveOrigin: state.currentObjective ? "explicit" : null, objectiveSourceMessageId: null, objectiveSourceNodeIds: [], objectiveSourceQuote: null, requirements: [], preferences: [],
            } } });
          }
          return transaction.project.findUniqueOrThrow({
            where: { id: project.id },
            include: {
              _count: { select: { designAssets: true } },
              designAssets: {
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                select: { id: true },
                take: 1,
              },
            },
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
      return toProjectResponse(duplicated);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const concurrent = await this.database.project.findFirst({
          where: { idempotencyKey, wsId: authorizedSource.wsId, deletedAt: null },
        });
        if (concurrent && !concurrent.deletedAt) {
          return toProjectResponse(concurrent);
        }
      }
      throw error;
    }
  }

  async remove(userId: string, projectId: string): Promise<void> {
    const project = await this.assertOwnership(userId, projectId, true, "manage");

    if (project.deletedAt) {
      return;
    }

    await this.database.project.update({
      where: { id: projectId },
      data: { deletedAt: new Date() },
    });
  }

  private async assertOwnership(
    userId: string,
    projectId: string,
    allowDeleted = false,
    action: ProjectAction = "edit",
  ) {
    const project = await this.database.project.findUnique({
      where: { id: projectId },
      include: {
        _count: { select: { designAssets: true } },
        designAssets: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
          take: 1,
        },
        workspace: {
          select: { ownerId: true },
        },
      },
    });

    if (!project) {
      throw new NotFoundException({
        code: "PROJECT_NOT_FOUND",
        message: "项目不存在",
      });
    }

    if (!(allowDeleted && project.deletedAt && project.workspace.ownerId === userId)) {
      await this.access.require(userId, projectId, action);
    }

    if (project.deletedAt && !allowDeleted) {
      throw new NotFoundException({
        code: "PROJECT_NOT_FOUND",
        message: "项目不存在",
      });
    }

    return project;
  }
}

function requiredMappedId(
  idMap: ReadonlyMap<string, string>,
  sourceId: string,
): string {
  const mapped = idMap.get(sourceId);
  if (!mapped) {
    throw new Error(`项目复制缺少资产映射: ${sourceId}`);
  }
  return mapped;
}

function remapStructuredValue(
  value: unknown,
  idMap: ReadonlyMap<string, string>,
  stripRuntime = false,
): unknown {
  if (typeof value === "string") {
    if (idMap.has(value)) return idMap.get(value);
    return value.replace(/(\/api\/(?:design-assets|projects|collections|board-elements)\/)([^/?#]+)/gu, (match, prefix: string, id: string) => {
      const mapped = idMap.get(decodeURIComponent(id));
      return mapped ? `${prefix}${encodeURIComponent(mapped)}` : match;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => remapStructuredValue(item, idMap, stripRuntime));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([key]) => !stripRuntime || !["generationTaskId", "attemptId", "executionId", "proposalId", "conversationId", "nodeVersionId", "forkedFromNodeVersionId", "error", "errorCode", "errorMessage"].includes(key)).map(([key, item]) => [
        key,
        typeof item === "string" && ["text", "prompt", "negativePrompt", "summary", "description", "sourceQuote", "rationale"].includes(key) ? item : remapStructuredValue(item, idMap, stripRuntime),
      ]),
    );
  }
  return value;
}
