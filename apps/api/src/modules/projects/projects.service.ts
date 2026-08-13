import { Prisma, type PrismaClient } from "@fashion/db";
import {
  ConflictException,
  ForbiddenException,
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

export const PROJECTS_DB = Symbol("PROJECTS_DB");

type ProjectsDatabase = Pick<
  PrismaClient,
  "$transaction" | "designAsset" | "project" | "workspace"
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
  ) {}

  async list(userId: string, input: ListProjectsInput) {
    const archived =
      input.archived === "all" ? undefined : input.archived === "archived";
    const where: Prisma.ProjectWhereInput = {
      deletedAt: null,
      workspace: {
        ownerId: userId,
      },
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
      deletedAt: null,
      workspace: { ownerId: userId },
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
    return toProjectResponse(await this.assertOwnership(userId, projectId));
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
    await this.assertOwnership(userId, projectId);
    const source = await this.database.project.findUnique({
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
        workspace: { select: { ownerId: true } },
      },
    });
    if (!source) {
      throw new NotFoundException({
        code: "PROJECT_NOT_FOUND",
        message: "项目不存在",
      });
    }
    const existing = await this.database.project.findFirst({
      where: { idempotencyKey, wsId: source.wsId },
    });
    if (existing && !existing.deletedAt) {
      return toProjectResponse(existing);
    }

    try {
      const duplicated = await this.database.$transaction(
        async (transaction) => {
          const assetIdMap = new Map(
            source.designAssets.map((asset) => [asset.id, randomUUID()]),
          );
          const remappedCoverAssetId = source.coverAssetId
            ? (assetIdMap.get(source.coverAssetId) ?? null)
            : null;
          const project = await transaction.project.create({
            data: {
              coverAssetId: remappedCoverAssetId,
              idempotencyKey,
              name: `${source.name} 副本`.slice(0, 80),
              wsId: source.wsId,
            },
          });
          if (source.designAssets.length > 0) {
            await transaction.designAsset.createMany({
              data: source.designAssets.map((asset) => {
                const id = requiredMappedId(assetIdMap, asset.id);
                return {
                  archivedAt: asset.archivedAt,
                  generationTaskId: null,
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
                        assetIdMap,
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
                deletedAt: element.deletedAt,
                fileAssetId: element.fileAssetId,
                projectId: project.id,
                record:
                  element.record === null
                    ? Prisma.JsonNull
                    : (remapStructuredValue(
                        element.record,
                        assetIdMap,
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
            const collectionId = randomUUID();
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
        },
      );
      return toProjectResponse(duplicated);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const concurrent = await this.database.project.findFirst({
          where: { idempotencyKey, wsId: source.wsId },
        });
        if (concurrent && !concurrent.deletedAt) {
          return toProjectResponse(concurrent);
        }
      }
      throw error;
    }
  }

  async remove(userId: string, projectId: string): Promise<void> {
    const project = await this.assertOwnership(userId, projectId, true);

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

    if (project.workspace.ownerId !== userId) {
      throw new ForbiddenException({
        code: "PROJECT_FORBIDDEN",
        message: "无权访问该项目",
      });
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
): unknown {
  if (typeof value === "string") return idMap.get(value) ?? value;
  if (Array.isArray(value)) {
    return value.map((item) => remapStructuredValue(item, idMap));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        remapStructuredValue(item, idMap),
      ]),
    );
  }
  return value;
}
