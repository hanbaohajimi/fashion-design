import { ConflictException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { boardPatchSchema } from "./boards.schemas";
import { BoardsService } from "./boards.service";

describe("BoardsService ownership and semantic rows", () => {
  it("requires a non-negative base revision for every patch", () => {
    const patch = {
      batchId: crypto.randomUUID(),
      patches: [],
      snapshot: {},
    };

    expect(boardPatchSchema.safeParse(patch).success).toBe(false);
    expect(
      boardPatchSchema.safeParse({ ...patch, baseRevision: -1 }).success,
    ).toBe(false);
    expect(
      boardPatchSchema.safeParse({ ...patch, baseRevision: 0 }).success,
    ).toBe(true);
  });

  it("returns 403 when user A tries to load user B's board", async () => {
    const database = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          workspace: { ownerId: "user-b" },
        }),
      },
    };
    const service = new BoardsService(database as never);

    await expect(service.get("user-a", "project-b")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("returns row-level role data beside the snapshot", async () => {
    const updatedAt = new Date("2026-07-27T08:00:00.000Z");
    const database = {
      boardElement: {
        findMany: vi.fn().mockResolvedValue([
          {
            deletedAt: null,
            record: {
              id: "shape:one",
              props: { role: "style_ref" },
              type: "fashion-image",
              typeName: "shape",
            },
            role: "avoid",
            shapeId: "shape:one",
            shapeType: "fashion-image",
            updatedAt,
          },
        ]),
      },
      boardSnapshot: {
        findUnique: vi.fn().mockResolvedValue({
          revision: 3,
          snapshot: {
            document: {
              store: {
                "shape:one": {
                  id: "shape:one",
                  props: { role: "style_ref" },
                },
              },
            },
          },
        }),
      },
      project: {
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          workspace: { ownerId: "user-a" },
        }),
      },
    };
    const service = new BoardsService(database as never);

    await expect(service.get("user-a", "project-a")).resolves.toMatchObject({
      elements: [
        {
          deleted: false,
          role: "avoid",
          shapeId: "shape:one",
        },
      ],
      revision: 3,
    });
  });

  it("rejects a stale revision before mutating any board elements", async () => {
    const boardElementUpsert = vi.fn();
    const boardSnapshotFindUnique = vi
      .fn()
      .mockResolvedValueOnce({ revision: 4 })
      .mockResolvedValueOnce({ revision: 5 });
    const transaction = {
      boardElement: {
        upsert: boardElementUpsert,
      },
      boardSnapshot: {
        findUnique: boardSnapshotFindUnique,
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const database = {
      $transaction: vi.fn(
        async (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
      project: {
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          workspace: { ownerId: "user-a" },
        }),
      },
    };
    const service = new BoardsService(database as never);

    const result = service.patch("user-a", "project-a", {
      baseRevision: 4,
      batchId: crypto.randomUUID(),
      patches: [],
      snapshot: {},
    });

    await expect(result).rejects.toMatchObject({
      response: {
        code: "BOARD_REVISION_CONFLICT",
        currentRevision: 5,
      },
      status: 409,
    });
    await expect(result).rejects.toBeInstanceOf(ConflictException);
    expect(boardElementUpsert).not.toHaveBeenCalled();
  });

  it("advances the matching revision with a conditional update", async () => {
    const savedAt = new Date("2026-07-30T09:00:00.000Z");
    const boardSnapshotFindUnique = vi
      .fn()
      .mockResolvedValueOnce({ revision: 7 })
      .mockResolvedValueOnce({ revision: 8, updatedAt: savedAt });
    const boardSnapshotUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      boardElement: {
        upsert: vi.fn(),
      },
      boardSnapshot: {
        findUnique: boardSnapshotFindUnique,
        updateMany: boardSnapshotUpdateMany,
      },
    };
    const database = {
      $transaction: vi.fn(
        async (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
      project: {
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          workspace: { ownerId: "user-a" },
        }),
      },
    };
    const service = new BoardsService(database as never);

    await expect(
      service.patch("user-a", "project-a", {
        baseRevision: 7,
        batchId: "a59553de-cd78-4682-a90f-282334289d24",
        patches: [],
        snapshot: { document: { store: {} } },
      }),
    ).resolves.toEqual({
      batchId: "a59553de-cd78-4682-a90f-282334289d24",
      revision: 8,
      savedAt,
    });
    expect(boardSnapshotUpdateMany).toHaveBeenCalledWith({
      where: {
        projectId: "project-a",
        revision: 7,
      },
      data: {
        revision: { increment: 1 },
        snapshot: { document: { store: {} } },
      },
    });
  });

  it("creates revision one when the board has no snapshot yet", async () => {
    const savedAt = new Date("2026-07-30T09:15:00.000Z");
    const boardSnapshotCreate = vi.fn().mockResolvedValue({
      revision: 1,
      updatedAt: savedAt,
    });
    const transaction = {
      boardElement: {
        upsert: vi.fn(),
      },
      boardSnapshot: {
        create: boardSnapshotCreate,
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const database = {
      $transaction: vi.fn(
        async (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
      project: {
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          workspace: { ownerId: "user-a" },
        }),
      },
    };
    const service = new BoardsService(database as never);

    await expect(
      service.patch("user-a", "project-a", {
        baseRevision: 0,
        batchId: "ab86e216-5fbb-41a0-b08a-b60e4eb592cd",
        patches: [],
        snapshot: {},
      }),
    ).resolves.toEqual({
      batchId: "ab86e216-5fbb-41a0-b08a-b60e4eb592cd",
      revision: 1,
      savedAt,
    });
    expect(boardSnapshotCreate).toHaveBeenCalledWith({
      data: {
        projectId: "project-a",
        revision: 1,
        snapshot: {},
      },
      select: {
        revision: true,
        updatedAt: true,
      },
    });
  });
});
