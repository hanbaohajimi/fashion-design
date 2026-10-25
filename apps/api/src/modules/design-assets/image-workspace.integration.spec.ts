import { prisma } from "@fashion/db";
import { describe, expect, it } from "vitest";
import { ImageWorkspaceService } from "./image-workspace.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import type { S3FileStorage } from "../files/storage.service";
describe("图片反馈和分享", () => {
  it("持久化反馈、检查修订冲突和权限、使分享撤销和过期生效", async () => {
    const user = await prisma.user.create({
      data: {
        email: `image-workspace-${crypto.randomUUID()}@example.com`,
        ownedWorkspaces: {
          create: {
            name: "图片测试",
            projects: { create: { name: "图片工作区" } },
          },
        },
      },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });
    const project = user.ownedWorkspaces[0]?.projects[0];
    if (!project) throw new Error("项目不存在");
    const id = crypto.randomUUID();
    const images = new ImageWorkspaceService(
      prisma,
      new ProjectAccessPolicy(prisma),
      {} as S3FileStorage,
    );
    try {
      await prisma.designAsset.create({
        data: {
          id,
          projectId: project.id,
          rootAssetId: id,
          operation: "GENERATED",
          url: "s3://test/image.png",
        },
      });
      expect(await images.feedback(user.id, id)).toEqual({
        revision: 0,
        annotations: [],
        comments: [],
      });
      const comment = {
        id: "c",
        text: "保留面料",
        point: { x: 0.5, y: 0.5 },
        annotationIds: [],
      };
      const saved = await images.save(user.id, id, {
        revision: 0,
        annotations: [],
        comments: [comment],
      });
      expect(saved.revision).toBe(1);
      expect((await images.feedback(user.id, id)).comments).toEqual([comment]);
      await expect(
        images.save(user.id, id, {
          revision: 0,
          annotations: [],
          comments: [],
        }),
      ).rejects.toThrow("其他窗口");
      await expect(images.share("other-user", id)).rejects.toThrow();
      const share = await images.share(user.id, id);
      const token = share.path.split("/").at(-1) ?? "";
      expect((await images.shared(token)).id).toBe(id);
      expect(await images.shares(user.id, id)).toEqual([
        expect.not.objectContaining({ tokenHash: expect.anything() }),
      ]);
      await images.revoke(user.id, id, share.id);
      await expect(images.shared(token)).rejects.toThrow("失效");
      const expiring = await images.share(user.id, id);
      await prisma.imageAssetShare.update({
        where: { id: expiring.id },
        data: { expiresAt: new Date(0) },
      });
      await expect(
        images.shared(expiring.path.split("/").at(-1) ?? ""),
      ).rejects.toThrow("失效");
    } finally {
      await prisma.workspace.deleteMany({ where: { ownerId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
