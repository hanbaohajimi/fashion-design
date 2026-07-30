import {
  Prisma,
  RoleInferenceState,
  RoleSource,
  type PrismaClient,
} from "@fashion/db";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import type { BoardPatchInput } from "./boards.schemas";

export const BOARDS_DB = Symbol("BOARDS_DB");

type BoardsDatabase = Pick<
  PrismaClient,
  "$transaction" | "boardElement" | "boardSnapshot" | "project"
>;

export interface BoardLoadResult {
  readonly elements: readonly {
    readonly deleted: boolean;
    readonly record: unknown;
    readonly role: string;
    readonly roleConfidence: number | null;
    readonly roleInferenceState: string;
    readonly roleLabel: string | null;
    readonly roleSource: string;
    readonly shapeId: string;
    readonly shapeType: string;
    readonly updatedAt: Date;
  }[];
  readonly revision: number;
  readonly snapshot: unknown;
}

export interface BoardPatchResult {
  readonly batchId: string;
  readonly revision: number;
  readonly savedAt: Date;
}

@Injectable()
export class BoardsService {
  constructor(@Inject(BOARDS_DB) private readonly database: BoardsDatabase) {}

  async get(userId: string, projectId: string): Promise<BoardLoadResult> {
    await this.assertOwnership(userId, projectId);
    const [snapshot, elements] = await Promise.all([
      this.database.boardSnapshot.findUnique({
        where: { projectId },
      }),
      this.database.boardElement.findMany({
        where: { projectId },
        orderBy: { updatedAt: "asc" },
      }),
    ]);

    return {
      elements: elements.map((element) => ({
        deleted: Boolean(element.deletedAt),
        record: element.record,
        role: element.role,
        roleConfidence: element.roleConfidence ?? null,
        roleInferenceState: element.roleInferenceState?.toLowerCase() ?? "none",
        roleLabel: element.roleLabel ?? null,
        roleSource: element.roleSource?.toLowerCase() ?? "default",
        shapeId: element.shapeId,
        shapeType: element.shapeType,
        updatedAt: element.updatedAt,
      })),
      revision: snapshot?.revision ?? 0,
      snapshot: snapshot?.snapshot ?? null,
    };
  }

  async patch(
    userId: string,
    projectId: string,
    input: BoardPatchInput,
  ): Promise<BoardPatchResult> {
    await this.assertOwnership(userId, projectId);

    const result = await this.database.$transaction(async (transaction) => {
      const currentSnapshot = await transaction.boardSnapshot.findUnique({
        where: { projectId },
        select: { revision: true },
      });
      let snapshot: { readonly revision: number; readonly updatedAt: Date };

      if (!currentSnapshot) {
        if (input.baseRevision !== 0) {
          throw revisionConflict(input.baseRevision, 0);
        }

        try {
          snapshot = await transaction.boardSnapshot.create({
            data: {
              projectId,
              revision: 1,
              snapshot: input.snapshot as Prisma.InputJsonValue,
            },
            select: {
              revision: true,
              updatedAt: true,
            },
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          ) {
            throw revisionConflict(input.baseRevision);
          }
          throw error;
        }
      } else {
        if (currentSnapshot.revision !== input.baseRevision) {
          throw revisionConflict(input.baseRevision, currentSnapshot.revision);
        }

        const updated = await transaction.boardSnapshot.updateMany({
          where: {
            projectId,
            revision: input.baseRevision,
          },
          data: {
            revision: { increment: 1 },
            snapshot: input.snapshot as Prisma.InputJsonValue,
          },
        });

        if (updated.count !== 1) {
          const latestSnapshot = await transaction.boardSnapshot.findUnique({
            where: { projectId },
            select: { revision: true },
          });
          throw revisionConflict(
            input.baseRevision,
            latestSnapshot?.revision ?? 0,
          );
        }

        const savedSnapshot = await transaction.boardSnapshot.findUnique({
          where: { projectId },
          select: {
            revision: true,
            updatedAt: true,
          },
        });
        if (!savedSnapshot) {
          throw revisionConflict(input.baseRevision, 0);
        }
        snapshot = savedSnapshot;
      }

      for (const patch of input.patches) {
        if (patch.deleted) {
          await transaction.boardElement.upsert({
            where: {
              projectId_shapeId: {
                projectId,
                shapeId: patch.shapeId,
              },
            },
            create: {
              deletedAt: new Date(),
              projectId,
              record: Prisma.JsonNull,
              role: "generic",
              shapeId: patch.shapeId,
              shapeType: "unknown",
            },
            update: {
              deletedAt: new Date(),
            },
          });
          continue;
        }

        await transaction.boardElement.upsert({
          where: {
            projectId_shapeId: {
              projectId,
              shapeId: patch.shapeId,
            },
          },
          create: {
            projectId,
            record: patch.record as Prisma.InputJsonValue,
            role: patch.role,
            roleInferenceState: toInferenceState(patch.roleInferenceState),
            roleSource: toRoleSource(patch.roleSource),
            shapeId: patch.shapeId,
            shapeType: patch.shapeType,
            ...(patch.roleConfidence !== undefined
              ? { roleConfidence: patch.roleConfidence }
              : {}),
            ...(patch.roleLabel !== undefined
              ? { roleLabel: patch.roleLabel }
              : {}),
          },
          update: {
            deletedAt: null,
            record: patch.record as Prisma.InputJsonValue,
            shapeType: patch.shapeType,
            ...(patch.roleSource === "manual"
              ? {
                  role: patch.role,
                  roleConfidence: null,
                  roleInferenceState: RoleInferenceState.READY,
                  roleLabel: null,
                  roleSource: RoleSource.MANUAL,
                }
              : {}),
          },
        });
      }

      return snapshot;
    });

    return {
      batchId: input.batchId,
      revision: result.revision,
      savedAt: result.updatedAt,
    };
  }

  private async assertOwnership(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const project = await this.database.project.findUnique({
      where: { id: projectId },
      select: {
        deletedAt: true,
        workspace: {
          select: { ownerId: true },
        },
      },
    });

    if (!project || project.deletedAt) {
      throw new NotFoundException({
        code: "PROJECT_NOT_FOUND",
        message: "项目不存在",
      });
    }

    if (project.workspace.ownerId !== userId) {
      throw new ForbiddenException({
        code: "PROJECT_FORBIDDEN",
        message: "无权访问该项目画布",
      });
    }
  }
}

function revisionConflict(
  baseRevision: number,
  currentRevision?: number,
): ConflictException {
  return new ConflictException({
    code: "BOARD_REVISION_CONFLICT",
    message: "画布已在其他窗口更新，本地修改未覆盖远端版本",
    expectedRevision: baseRevision,
    ...(currentRevision === undefined ? {} : { currentRevision }),
  });
}

function toRoleSource(value: string | undefined): RoleSource {
  if (value === "manual") {
    return RoleSource.MANUAL;
  }
  if (value === "inferred") {
    return RoleSource.INFERRED;
  }
  return RoleSource.DEFAULT;
}

function toInferenceState(value: string | undefined): RoleInferenceState {
  if (value === "pending") {
    return RoleInferenceState.PENDING;
  }
  if (value === "failed") {
    return RoleInferenceState.FAILED;
  }
  if (value === "ready") {
    return RoleInferenceState.READY;
  }
  return RoleInferenceState.NONE;
}
