import { afterAll, describe, expect, it } from "vitest";

import {
  AgentMessageRole,
  AgentMessageStatus,
  Prisma,
  prisma,
} from "./client.js";

describe("User → Workspace → Project database relations", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("preserves image feedback and shares when an asset id changes and deletes them with the asset", async () => {
    const user = await prisma.user.create({
      data: {
        email: `image-relations-${crypto.randomUUID()}@example.com`,
        ownedWorkspaces: {
          create: {
            name: "Image relations workspace",
            projects: { create: { name: "Image relations project" } },
          },
        },
      },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });

    try {
      const project = user.ownedWorkspaces[0]?.projects[0];
      if (!project) throw new Error("Expected the image relations project");
      const assetId = crypto.randomUUID();
      const share = {
        tokenHash: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      };
      const asset = await prisma.designAsset.create({
        data: {
          id: assetId,
          rootAssetId: assetId,
          projectId: project.id,
          operation: "IMPORTED",
          url: "https://example.com/image-relations.png",
          feedback: { create: { data: { note: "保留袖口" } } },
          shares: { create: share },
        },
        include: { shares: true },
      });
      const newAssetId = crypto.randomUUID();
      await prisma.designAsset.update({
        where: { id: assetId },
        data: { id: newAssetId, rootAssetId: newAssetId },
      });

      await expect(
        prisma.imageAssetFeedback.findUnique({
          where: { assetId: newAssetId },
        }),
      ).resolves.toMatchObject({
        assetId: newAssetId,
        data: { note: "保留袖口" },
        revision: 0,
      });
      await expect(
        prisma.imageAssetShare.findUnique({
          where: { tokenHash: share.tokenHash },
        }),
      ).resolves.toMatchObject({
        id: asset.shares[0]?.id,
        assetId: newAssetId,
        tokenHash: share.tokenHash,
      });

      await prisma.designAsset.delete({ where: { id: newAssetId } });
      await expect(
        prisma.imageAssetFeedback.findUnique({
          where: { assetId: newAssetId },
        }),
      ).resolves.toBeNull();
      await expect(
        prisma.imageAssetShare.findUnique({
          where: { tokenHash: share.tokenHash },
        }),
      ).resolves.toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
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

  it("persists agent turns, links a generation task, and cascades with the project", async () => {
    const user = await prisma.user.create({
      data: {
        email: `agent-${crypto.randomUUID()}@example.com`,
        ownedWorkspaces: {
          create: {
            name: "Agent workspace",
            projects: { create: { name: "Agent project" } },
          },
        },
      },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });
    const project = user.ownedWorkspaces[0]?.projects[0];
    expect(project).toBeDefined();
    if (!project) return;

    try {
      const conversation = await prisma.agentConversation.create({
        data: {
          createdById: user.id,
          projectId: project.id,
          title: "风衣方向",
        },
      });
      const userMessage = await prisma.agentMessage.create({
        data: {
          clientRequestId: "request-agent-001",
          content: "生成一件轻量风衣",
          context: { fileAssetIds: [], shapeIds: [] },
          conversationId: conversation.id,
          role: AgentMessageRole.USER,
        },
      });
      const task = await prisma.generationTask.create({
        data: {
          input: { prompt: "lightweight trench" },
          projectId: project.id,
          taskType: "t2i",
          userId: user.id,
        },
      });
      await prisma.agentMessage.create({
        data: {
          content: "已创建风衣生成任务。",
          conversationId: conversation.id,
          generationTaskId: task.id,
          replyToId: userMessage.id,
          role: AgentMessageRole.ASSISTANT,
          status: AgentMessageStatus.COMPLETED,
        },
      });

      await expect(
        prisma.agentMessage.create({
          data: {
            clientRequestId: "request-agent-001",
            content: "重复请求",
            conversationId: conversation.id,
            role: AgentMessageRole.USER,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });

      await prisma.project.delete({ where: { id: project.id } });
      await expect(
        prisma.agentConversation.count({ where: { id: conversation.id } }),
      ).resolves.toBe(0);
      await expect(
        prisma.agentMessage.count({
          where: { conversationId: conversation.id },
        }),
      ).resolves.toBe(0);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
