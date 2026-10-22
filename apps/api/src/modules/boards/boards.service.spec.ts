import {
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { boardPatchSchema, importTrendSchema } from "./boards.schemas";
import { BoardsService } from "./boards.service";

describe("BoardsService ownership and semantic rows", () => {
  it("validates optional finite trend import coordinates", () => {
    expect(importTrendSchema.safeParse({ trendItemId: "trend-a" }).success).toBe(true);
    expect(
      importTrendSchema.safeParse({
        position: { x: 120, y: 240 },
        trendItemId: "trend-a",
      }).success,
    ).toBe(true);
    expect(
      importTrendSchema.safeParse({
        position: { x: Number.POSITIVE_INFINITY, y: 0 },
        trendItemId: "trend-a",
      }).success,
    ).toBe(false);
  });

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
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
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

  it("allows archived projects to be read but rejects writes", async () => {
    const database = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
      project: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            archived: true,
            deletedAt: null,
            workspace: { ownerId: "user-a" },
          })
          .mockResolvedValueOnce({
            archived: true,
            deletedAt: null,
            workspace: { ownerId: "user-a" },
          }),
      },
      boardElement: { findMany: vi.fn().mockResolvedValue([]) },
      boardSnapshot: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const service = new BoardsService(database as never);

    await expect(service.get("user-a", "project-a")).resolves.toMatchObject({
      elements: [],
      revision: 0,
      snapshot: null,
    });
    await expect(
      service.patch("user-a", "project-a", {
        baseRevision: 0,
        batchId: "batch-archived",
        patches: [],
        snapshot: {},
      }),
    ).rejects.toMatchObject({ response: { code: "PROJECT_ARCHIVED" } });
  });

  it("returns row-level role data beside the snapshot", async () => {
    const updatedAt = new Date("2026-07-27T08:00:00.000Z");
    const database = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
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

  it("removes retired connector records from loaded boards", async () => {
    const updatedAt = new Date("2026-08-11T08:00:00.000Z");
    const connectorRecord = {
      id: "shape:legacy-connector",
      props: {},
      type: "fashion-connector",
      typeName: "shape",
    };
    const imageRecord = {
      id: "shape:image",
      props: {},
      type: "fashion-image",
      typeName: "shape",
    };
    const database = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
      boardElement: {
        findMany: vi.fn().mockResolvedValue([
          {
            deletedAt: null,
            record: connectorRecord,
            role: "generic",
            shapeId: connectorRecord.id,
            shapeType: connectorRecord.type,
            updatedAt,
          },
          {
            deletedAt: null,
            record: imageRecord,
            role: "style_ref",
            shapeId: imageRecord.id,
            shapeType: imageRecord.type,
            updatedAt,
          },
        ]),
      },
      boardSnapshot: {
        findUnique: vi.fn().mockResolvedValue({
          revision: 4,
          snapshot: {
            document: {
              store: {
                [connectorRecord.id]: connectorRecord,
                [imageRecord.id]: imageRecord,
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

    const result = await service.get("user-a", "project-a");

    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]?.shapeId).toBe(imageRecord.id);
    expect(result.snapshot).toEqual({
      document: { store: { [imageRecord.id]: imageRecord } },
    });
  });

  it("rejects a stale revision before mutating any board elements", async () => {
    const boardElementUpsert = vi.fn();
    const boardSnapshotFindUnique = vi
      .fn()
      .mockResolvedValueOnce({ revision: 4 })
      .mockResolvedValueOnce({ revision: 5 });
    const transaction = {
      project: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null, workspace: { ownerId: "user-a" } }) },
      boardElement: {
        upsert: boardElementUpsert,
      },
      boardSnapshot: {
        findUnique: boardSnapshotFindUnique,
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const database = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
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
      project: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null, workspace: { ownerId: "user-a" } }) },
      boardElement: {
        upsert: vi.fn(),
      },
      boardSnapshot: {
        findUnique: boardSnapshotFindUnique,
        updateMany: boardSnapshotUpdateMany,
      },
    };
    const database = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
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

  it("drops retired connector data submitted by an old client", async () => {
    const savedAt = new Date("2026-08-11T09:00:00.000Z");
    const connectorRecord = {
      id: "shape:legacy-connector",
      props: {},
      type: "fashion-connector",
      typeName: "shape",
    };
    const boardElementUpsert = vi.fn().mockResolvedValue({});
    const boardSnapshotCreate = vi.fn().mockResolvedValue({
      revision: 1,
      updatedAt: savedAt,
    });
    const transaction = {
      project: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null, workspace: { ownerId: "user-a" } }) },
      boardElement: { upsert: boardElementUpsert },
      boardSnapshot: {
        create: boardSnapshotCreate,
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const database = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
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

    await service.patch("user-a", "project-a", {
      baseRevision: 0,
      batchId: "b1dd67d8-dd76-4543-bbf9-94cf34c57d37",
      patches: [
        {
          deleted: false,
          record: connectorRecord,
          role: "generic",
          shapeId: connectorRecord.id,
          shapeType: connectorRecord.type,
        },
      ],
      snapshot: {
        document: { store: { [connectorRecord.id]: connectorRecord } },
      },
    });

    expect(boardSnapshotCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          snapshot: { document: { store: {} } },
        }),
      }),
    );
    expect(boardElementUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          deletedAt: expect.any(Date),
          shapeType: "unknown",
        }),
        update: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });

  it("creates revision one when the board has no snapshot yet", async () => {
    const savedAt = new Date("2026-07-30T09:15:00.000Z");
    const boardSnapshotCreate = vi.fn().mockResolvedValue({
      revision: 1,
      updatedAt: savedAt,
    });
    const transaction = {
      project: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null, workspace: { ownerId: "user-a" } }) },
      boardElement: {
        upsert: vi.fn(),
      },
      boardSnapshot: {
        create: boardSnapshotCreate,
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const database = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
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

  it("imports note, horizontal swatches and image with traceable metadata", async () => {
    const transaction = {
      project: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null, workspace: { ownerId: "user-a" } }) },
      boardElement: {
        createMany: vi.fn().mockResolvedValue({ count: 4 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      trendItem: {
        findUnique: vi.fn().mockResolvedValue({
          coverFileId: "cover-a",
          extracted: {
            keyColors: ["#FDB462", "#8DD3C7"],
          },
          id: "trend-a",
          sourceUrl: "https://www.vogue.com/article/a",
          status: "published",
          summary: "本周重点是轻盈半透明材质。",
          title: "Fluid layers",
        }),
      },
    };
    const database = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
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

    const result = await service.importTrendToBoard("user-a", "project-a", {
      position: { x: 100, y: 200 },
      trendItemId: "trend-a",
    });

    expect(result.success).toBe(true);
    expect(result.elements).toHaveLength(4);
    const inserted = transaction.boardElement.createMany.mock.calls[0]?.[0]
      .data as Array<{
        record: {
          meta: Record<string, unknown>;
          props: Record<string, unknown>;
          type: string;
          x: number;
          y: number;
        };
        role: string;
      }>;
    expect(inserted.map((element) => element.record.type)).toEqual([
      "fashion-note",
      "fashion-swatch",
      "fashion-swatch",
      "fashion-image",
    ]);
    expect(inserted.map((element) => element.role)).toEqual([
      "note",
      "palette",
      "palette",
      "style_ref",
    ]);
    expect(inserted[0]?.record).toMatchObject({
      meta: {
        source: "https://www.vogue.com/article/a",
        trendItemId: "trend-a",
      },
      props: { text: "本周重点是轻盈半透明材质。" },
      x: 100,
      y: 200,
    });
    expect(inserted[1]?.record).toMatchObject({
      meta: { roles: ["color_ref"], trendItemId: "trend-a" },
      props: { color: "#FDB462" },
      x: 100,
      y: 350,
    });
    expect(inserted[2]?.record.x).toBeGreaterThan(inserted[1]?.record.x ?? 0);
    expect(inserted[3]?.record).toMatchObject({
      meta: { roles: ["style_ref"], trendItemId: "trend-a" },
      props: {
        fileId: "cover-a",
        url: "/api/boards/trend-assets/trend-a",
      },
      x: 100,
      y: 450,
    });
  });

  it("moves an imported trend group away from existing board bounds", async () => {
    const transaction = {
      project: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null, workspace: { ownerId: "user-a" } }) },
      boardElement: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([
          {
            record: {
              props: { h: 700, w: 500 },
              x: 80,
              y: 80,
            },
          },
        ]),
      },
      trendItem: {
        findUnique: vi.fn().mockResolvedValue({
          coverFileId: null,
          extracted: { keyColors: [] },
          id: "trend-a",
          sourceUrl: "https://www.vogue.com/article/a",
          status: "published",
          summary: "摘要",
          title: "Title",
        }),
      },
    };
    const database = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
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

    await service.importTrendToBoard("user-a", "project-a", {
      position: { x: 100, y: 100 },
      trendItemId: "trend-a",
    });

    const note = transaction.boardElement.createMany.mock.calls[0]?.[0]
      .data[0].record as { x: number; y: number };
    expect(note).not.toMatchObject({ x: 100, y: 100 });
  });

  it("rolls back concurrent duplicate imports and returns an already-exists conflict", async () => {
    const transaction = {
      project: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null, workspace: { ownerId: "user-a" } }) },
      boardElement: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      trendItem: {
        findUnique: vi.fn().mockResolvedValue({
          coverFileId: null,
          extracted: { keyColors: [] },
          id: "trend-a",
          sourceUrl: "https://www.vogue.com/article/a",
          status: "published",
          summary: "摘要",
          title: "Title",
        }),
      },
    };
    const database = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
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

    const result = service.importTrendToBoard("user-a", "project-a", {
      trendItemId: "trend-a",
    });

    await expect(result).rejects.toBeInstanceOf(ConflictException);
    await expect(result).rejects.toMatchObject({
      response: {
        code: "TREND_ALREADY_IMPORTED",
        message: "该趋势已存在于白板",
      },
      status: 409,
    });
  });

  it("checks board ownership before reading a trend", async () => {
    const trendItemFindUnique = vi.fn();
    const database = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
      project: {
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          workspace: { ownerId: "user-b" },
        }),
      },
      trendItem: { findUnique: trendItemFindUnique },
    };
    const service = new BoardsService(database as never);

    await expect(
      service.importTrendToBoard("user-a", "project-b", {
        trendItemId: "trend-a",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(trendItemFindUnique).not.toHaveBeenCalled();
  });
});
