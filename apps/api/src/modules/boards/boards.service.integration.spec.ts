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

      await expect(boardsService.get(user.id, project.id)).resolves.toMatchObject(
        {
          elements: [
            {
              deleted: false,
              role: "avoid",
              shapeId: record.id,
            },
          ],
          revision: 2,
        },
      );
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
