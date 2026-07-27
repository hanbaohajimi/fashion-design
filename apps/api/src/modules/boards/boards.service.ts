import { Prisma, type PrismaClient } from "@fashion/db";
import {
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
      const snapshot = await transaction.boardSnapshot.upsert({
        where: { projectId },
        create: {
          projectId,
          revision: 1,
          snapshot: input.snapshot as Prisma.InputJsonValue,
        },
        update: {
          revision: { increment: 1 },
          snapshot: input.snapshot as Prisma.InputJsonValue,
        },
      });

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
            shapeId: patch.shapeId,
            shapeType: patch.shapeType,
          },
          update: {
            deletedAt: null,
            record: patch.record as Prisma.InputJsonValue,
            role: patch.role,
            shapeType: patch.shapeType,
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
