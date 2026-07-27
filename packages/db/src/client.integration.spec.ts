import { afterAll, describe, expect, it } from "vitest";

import { Prisma, prisma } from "./client.js";

describe("User → Workspace → Project database relations", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates the relation chain and enforces the workspace foreign key", async () => {
    const email = `task02-${crypto.randomUUID()}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        name: "Task 02",
        ownedWorkspaces: {
          create: {
            name: "Default workspace",
            projects: {
              create: {
                name: "First project",
              },
            },
          },
        },
      },
      include: {
        ownedWorkspaces: {
          include: {
            projects: true,
          },
        },
      },
    });

    try {
      expect(user.id).toMatch(/^[a-z0-9]{24}$/u);
      expect(user.deletedAt).toBeNull();
      expect(user.ownedWorkspaces).toHaveLength(1);

      const workspace = user.ownedWorkspaces[0];
      expect(workspace).toBeDefined();
      expect(workspace?.ownerId).toBe(user.id);

      const project = workspace?.projects[0];
      expect(project).toBeDefined();
      expect(project?.wsId).toBe(workspace?.id);
      expect(project?.coverAssetId).toBeNull();
      expect(project?.archived).toBe(false);

      await expect(
        prisma.project.create({
          data: {
            name: "Invalid project",
            wsId: "missing-workspace",
          },
        }),
      ).rejects.toMatchObject({
        code: "P2003",
      } satisfies Partial<Prisma.PrismaClientKnownRequestError>);
    } finally {
      await prisma.user.delete({
        where: { id: user.id },
      });
    }
  });
});
