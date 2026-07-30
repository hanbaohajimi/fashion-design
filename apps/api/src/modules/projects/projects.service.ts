import { Prisma, type PrismaClient } from "@fashion/db";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import type {
  CreateProjectInput,
  ListProjectsInput,
  UpdateProjectInput,
} from "./projects.schemas";

export const PROJECTS_DB = Symbol("PROJECTS_DB");

type ProjectsDatabase = Pick<
  PrismaClient,
  "$transaction" | "project" | "workspace"
>;

interface ProjectRecord {
  readonly archived: boolean;
  readonly coverAssetId: string | null;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
  readonly id: string;
  readonly name: string;
  readonly updatedAt: Date;
}

function toProjectResponse(project: ProjectRecord) {
  return {
    archived: project.archived,
    assetCount: project.coverAssetId ? 1 : 0,
    coverAssetId: project.coverAssetId,
    coverUrl: project.coverAssetId
      ? `/api/assets/${encodeURIComponent(project.coverAssetId)}/thumbnail`
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
    const [projects, total] = await Promise.all([
      this.database.project.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip,
        take: input.limit,
      }),
      this.database.project.count({ where }),
    ]);

    return {
      hasMore: skip + projects.length < total,
      items: projects.map(toProjectResponse),
      page: input.page,
      pageSize: input.limit,
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
      data: {
        ...(input.archived === undefined
          ? {}
          : { archived: input.archived }),
        ...(input.name === undefined ? {} : { name: input.name }),
      },
    });

    return toProjectResponse(project);
  }

  async duplicate(
    userId: string,
    projectId: string,
    idempotencyKey: string,
  ) {
    await this.assertOwnership(userId, projectId);
    const source = await this.database.project.findUnique({
      where: { id: projectId },
      include: {
        boardElements: true,
        boardSnapshot: true,
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
          const project = await transaction.project.create({
            data: {
              idempotencyKey,
              name: `${source.name} 副本`.slice(0, 80),
              wsId: source.wsId,
            },
          });
          if (source.boardSnapshot) {
            await transaction.boardSnapshot.create({
              data: {
                projectId: project.id,
                revision: 0,
                snapshot:
                  source.boardSnapshot.snapshot === null
                    ? Prisma.JsonNull
                    : (source.boardSnapshot
                        .snapshot as Prisma.InputJsonValue),
              },
            });
          }
          if (source.boardElements.length > 0) {
            await transaction.boardElement.createMany({
              data: source.boardElements.map((element) => ({
                deletedAt: element.deletedAt,
                fileAssetId: element.fileAssetId,
                projectId: project.id,
                record:
                  element.record === null
                    ? Prisma.JsonNull
                    : (element.record as Prisma.InputJsonValue),
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
          return project;
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
