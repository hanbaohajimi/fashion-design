import { prisma } from "@fashion/db";
import { describe, expect, it } from "vitest";

import { BoardsService } from "./boards.service";

const boardsService = new BoardsService(prisma);

describe("BoardsService persistence integration", () => {
  it("persists a shape and keeps row role semantics across reloads", async () => {
    const suffix = crypto.randomUUID();
    const user = await prisma.user.create({
      data: {
        email: `board-${suffix}@example.com`,
        ownedWorkspaces: {
          create: {
            name: "Board workspace",
            projects: {
              create: {
                name: "Board project",
              },
            },
          },
        },
      },
      include: {
        ownedWorkspaces: {
          include: { projects: true },
        },
      },
    });
    const project = user.ownedWorkspaces[0]?.projects[0];

    try {
      expect(project).toBeDefined();
      if (!project) {
        return;
      }

      const record = {
        id: "shape:integration-note",
        index: "a1",
        isLocked: false,
        meta: {},
        opacity: 1,
        parentId: "page:page",
        props: {
          h: 210,
          role: "note",
          text: "Integration note",
          tone: "#f2d978",
          w: 260,
        },
        rotation: 0,
        type: "fashion-note",
        typeName: "shape",
        x: 100,
        y: 120,
      };

      await boardsService.patch(user.id, project.id, {
        baseRevision: 0,
        batchId: crypto.randomUUID(),
        patches: [
          {
            deleted: false,
            record,
            role: "note",
            shapeId: record.id,
            shapeType: record.type,
          },
        ],
        snapshot: {
          document: {
            store: {
              [record.id]: record,
            },
          },
        },
      });

      await boardsService.patch(user.id, project.id, {
        baseRevision: 1,
        batchId: crypto.randomUUID(),
        patches: [
          {
            deleted: false,
            record: {
              ...record,
              props: {
                ...record.props,
                role: "avoid",
              },
            },
            role: "avoid",
            roleInferenceState: "ready",
            roleSource: "manual",
            shapeId: record.id,
            shapeType: record.type,
          },
        ],
        snapshot: {
          document: {
            store: {
              [record.id]: {
                ...record,
                props: {
                  ...record.props,
                  role: "avoid",
                },
              },
            },
          },
        },
      });

      await expect(
        boardsService.patch(user.id, project.id, {
          baseRevision: 1,
          batchId: crypto.randomUUID(),
          patches: [
            {
              deleted: false,
              record: {
                ...record,
                props: {
                  ...record.props,
                  role: "fabric_ref",
                },
              },
              role: "fabric_ref",
              roleInferenceState: "ready",
              roleSource: "manual",
              shapeId: record.id,
              shapeType: record.type,
            },
          ],
          snapshot: {
            document: {
              store: {
                [record.id]: {
                  ...record,
                  props: {
                    ...record.props,
                    role: "fabric_ref",
                  },
                },
              },
            },
          },
        }),
      ).rejects.toMatchObject({
        response: {
          code: "BOARD_REVISION_CONFLICT",
          currentRevision: 2,
        },
        status: 409,
      });

      await expect(
        boardsService.get(user.id, project.id),
      ).resolves.toMatchObject({
        elements: [
          {
            deleted: false,
            role: "avoid",
            shapeId: record.id,
          },
        ],
        revision: 2,
      });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("atomically imports a trend once and persists traceable elements", async () => {
    const suffix = crypto.randomUUID();
    const user = await prisma.user.create({
      data: {
        email: `trend-board-${suffix}@example.com`,
        ownedWorkspaces: {
          create: {
            name: "Trend board workspace",
            projects: { create: { name: "Trend board project" } },
          },
        },
      },
      include: {
        ownedWorkspaces: { include: { projects: true } },
      },
    });
    const project = user.ownedWorkspaces[0]?.projects[0];
    const trend = await prisma.trendItem.create({
      data: {
        category: "women",
        extracted: { keyColors: ["#FDB462", "#38BDF8"] },
        platform: "vogue",
        publishedAt: new Date("2026-07-28T00:00:00.000Z"),
        sourceUrl: `https://example.com/trends/${suffix}`,
        summary: "轻盈垂坠与低饱和色彩成为本周重点。",
        tags: ["fluid"],
        title: "Fluid tailoring",
      },
    });

    try {
      expect(project).toBeDefined();
      if (!project) {
        return;
      }

      const imported = await boardsService.importTrendToBoard(
        user.id,
        project.id,
        { position: { x: 80, y: 120 }, trendItemId: trend.id },
      );

      expect(imported.success).toBe(true);
      expect(imported.elements).toHaveLength(3);
      expect(imported.elements[0]).toMatchObject({
        record: {
          meta: {
            source: trend.sourceUrl,
            trendItemId: trend.id,
          },
          x: 80,
          y: 120,
        },
        role: "note",
        shapeType: "fashion-note",
      });
      expect(imported.elements[1]).toMatchObject({
        record: {
          meta: { roles: ["color_ref"], trendItemId: trend.id },
          x: 80,
          y: 270,
        },
        role: "palette",
        shapeType: "fashion-swatch",
      });

      await expect(
        boardsService.importTrendToBoard(user.id, project.id, {
          trendItemId: trend.id,
        }),
      ).rejects.toMatchObject({
        response: {
          code: "TREND_ALREADY_IMPORTED",
          message: "该趋势已存在于白板",
        },
        status: 409,
      });

      const reloaded = await boardsService.get(user.id, project.id);
      expect(reloaded.elements).toHaveLength(3);
      expect(reloaded.elements.every((element) => !element.deleted)).toBe(true);
    } finally {
      await prisma.trendItem.delete({ where: { id: trend.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
