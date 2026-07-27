import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { BoardsService } from "./boards.service";

describe("BoardsService ownership and semantic rows", () => {
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
              props: { role: "reference" },
              type: "fashion-image",
              typeName: "shape",
            },
            role: "output",
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
                  props: { role: "reference" },
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
          role: "output",
          shapeId: "shape:one",
        },
      ],
      revision: 3,
    });
  });
});
