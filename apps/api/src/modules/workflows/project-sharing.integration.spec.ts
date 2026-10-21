import { FileStatus, prisma } from "@fashion/db";
import { ForbiddenException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AgentConversationsService } from "../agent-conversations/agent-conversations.service";
import { FilesService } from "../files/files.service";
import { ProjectsService } from "../projects/projects.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { WorkflowsService } from "./workflows.service";

describe("shared project authorization persistence", () => {
  it("applies current roles and revocation across workflow, personal conversations, lists and referenced private files", async () => {
    const owner = await prisma.user.create({
      data: {
        email: `sharing-owner-${randomUUID()}@example.com`,
        ownedWorkspaces: {
          create: {
            name: "Sharing test",
            projects: { create: { name: "Shared design" } },
          },
        },
      },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });
    const workspace = owner.ownedWorkspaces[0];
    const project = workspace?.projects[0];
    if (!workspace || !project) throw new Error("Missing project fixture");
    const member = await prisma.user.create({
      data: { email: `sharing-member-${randomUUID()}@example.com` },
    });
    const access = new ProjectAccessPolicy(prisma);
    const workflows = new WorkflowsService(prisma, access);
    const projects = new ProjectsService(prisma, access);
    const storage = {
      createDownloadUrl: vi
        .fn()
        .mockResolvedValue("https://private.test/signed"),
      readPrefix: vi.fn(),
    };
    const files = new FilesService(
      prisma,
      storage as never,
      { enqueue: vi.fn() },
      access,
    );
    const conversations = new AgentConversationsService(
      prisma,
      {} as never,
      {} as never,
      storage as never,
      undefined,
      undefined,
      access,
    );
    const sharedNodeId = randomUUID();
    try {
      const membership = await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: member.id, role: "EDITOR" },
      });
      const makeFile = async () =>
        prisma.fileAsset.create({
          data: {
            ownerId: owner.id,
            originalName: "布样.png",
            mimeType: "image/png",
            sizeBytes: 100,
            sha256: randomUUID().replaceAll("-", "").padEnd(64, "0"),
            objectKey: `tests/sharing/${randomUUID()}`,
            status: FileStatus.READY,
            thumbnail1024Key: `tests/sharing/${randomUUID()}.webp`,
          },
        });
      const shared = await makeFile();
      const privateFile = await makeFile();
      const fabric = await prisma.fabric.create({
        data: {
          ownerId: owner.id,
          scope: "USER",
          mainFileId: shared.id,
          tags: ["棉"],
        },
      });
      await workflows.patch(owner.id, project.id, {
        mode: "semantic",
        mutationId: randomUUID(),
        baseRevision: 0,
        operations: [
          {
            type: "add_node",
            node: {
              id: sharedNodeId,
              kind: "asset",
              type: "fabric",
              title: "共享布样",
              payload: { fabricId: fabric.id },
              x: 0,
              y: 0,
            },
          },
        ],
      });
      // A shared fabric may be retained when a different editor saves the graph.
      await workflows.patch(member.id, project.id, {
        mode: "semantic",
        mutationId: randomUUID(),
        baseRevision: 1,
        operations: [
          { type: "update_node", nodeId: sharedNodeId, title: "已复核布样" },
        ],
      });
      expect(
        (
          await projects.list(member.id, {
            page: 1,
            limit: 20,
            archived: "active",
            search: "",
          })
        ).items.map((item) => item.id),
      ).toContain(project.id);
      const conversation = await conversations.create(member.id, project.id, {
        title: "个人对话",
      });
      await expect(
        conversations.messages(owner.id, conversation.id, { limit: 20 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      for (const role of ["REVIEWER", "VIEWER"] as const) {
        await prisma.workspaceMember.update({
          where: { id: membership.id },
          data: { role },
        });
        expect(
          (await workflows.get(member.id, project.id)).nodes[0]?.canDelete,
        ).toBe(false);
        await expect(
          workflows.patch(member.id, project.id, {
            mode: "semantic",
            mutationId: randomUUID(),
            baseRevision: 2,
            operations: [
              { type: "update_node", nodeId: sharedNodeId, title: "越权" },
            ],
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          conversations.create(member.id, project.id, {}),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(await files.thumbnailUrl(member.id, shared.id, "1024")).toBe(
        "https://private.test/signed",
      );
      await expect(
        files.thumbnailUrl(member.id, privateFile.id, "1024"),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await prisma.workspaceMember.delete({ where: { id: membership.id } });
      await expect(
        files.thumbnailUrl(member.id, shared.id, "1024"),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(workflows.get(member.id, project.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        conversations.messages(member.id, conversation.id, { limit: 20 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        (
          await projects.list(member.id, {
            page: 1,
            limit: 20,
            archived: "active",
            search: "",
          })
        ).items,
      ).toEqual([]);
      expect(storage.createDownloadUrl).toHaveBeenCalledOnce();
    } finally {
      await prisma.fabric.deleteMany({ where: { ownerId: owner.id } });
      await prisma.user.delete({ where: { id: owner.id } });
      await prisma.user.delete({ where: { id: member.id } });
    }
  });
});
