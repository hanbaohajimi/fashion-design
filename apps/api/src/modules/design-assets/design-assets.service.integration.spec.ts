import { DesignAssetOperation, prisma } from "@fashion/db";
import { HttpStatus } from "@nestjs/common";
import { afterAll, describe, expect, it } from "vitest";

import { DesignAssetsService } from "./design-assets.service";

const service = new DesignAssetsService(prisma, {
  createDownloadUrl: async (objectKey: string) => `https://signed.test/${objectKey}`,
} as never);

describe("DesignAssetsService lineage integration", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("分页显示完整血缘，恢复会创建新版本且可再次反向恢复", async () => {
    const fixture = await createFixture();
    try {
      const firstPage = await service.versions(
        fixture.userId,
        fixture.currentId,
        undefined,
        2,
      );
      expect(firstPage.items.map((item) => item.id)).toEqual([
        fixture.currentId,
        fixture.middleId,
      ]);
      expect(firstPage.nextCursor).toBe(fixture.middleId);

      const secondPage = await service.versions(
        fixture.userId,
        fixture.currentId,
        firstPage.nextCursor ?? undefined,
        2,
      );
      expect(secondPage.items.map((item) => item.id)).toEqual([
        fixture.rootId,
      ]);
      expect(secondPage.nextCursor).toBeNull();

      const restoredRoot = await service.restore(
        fixture.userId,
        fixture.rootId,
        fixture.currentId,
      );
      expect(restoredRoot).toMatchObject({
        operation: "restore",
        parentAssetId: fixture.currentId,
        restoredFromAssetId: fixture.rootId,
        url: "https://cdn.test/root.png",
      });

      const restoredCurrent = await service.restore(
        fixture.userId,
        fixture.currentId,
        restoredRoot.id,
      );
      expect(restoredCurrent).toMatchObject({
        operation: "restore",
        parentAssetId: restoredRoot.id,
        restoredFromAssetId: fixture.currentId,
        url: "https://cdn.test/current.png",
      });
      await expect(
        prisma.designAsset.findUniqueOrThrow({
          where: { id: restoredRoot.id },
        }),
      ).resolves.toMatchObject({ archivedAt: null });
    } finally {
      await prisma.user.delete({ where: { id: fixture.userId } });
    }
  });

  it("用户不能读取其他用户的资产时间线", async () => {
    const fixture = await createFixture();
    const outsider = await prisma.user.create({
      data: { email: `lineage-outsider-${crypto.randomUUID()}@example.com` },
    });
    try {
      await expect(
        service.versions(outsider.id, fixture.currentId, undefined, 10),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    } finally {
      await prisma.user.delete({ where: { id: outsider.id } });
      await prisma.user.delete({ where: { id: fixture.userId } });
    }
  });
});

async function createFixture(): Promise<{
  readonly currentId: string;
  readonly middleId: string;
  readonly rootId: string;
  readonly userId: string;
}> {
  const user = await prisma.user.create({
    data: {
      email: `lineage-${crypto.randomUUID()}@example.com`,
      ownedWorkspaces: {
        create: {
          name: "Lineage workspace",
          projects: { create: { name: "Lineage project" } },
        },
      },
    },
    include: {
      ownedWorkspaces: { include: { projects: true } },
    },
  });
  const projectId = user.ownedWorkspaces[0]?.projects[0]?.id;
  if (!projectId) throw new Error("测试项目创建失败");
  const rootId = crypto.randomUUID();
  const middleId = crypto.randomUUID();
  const currentId = crypto.randomUUID();
  await prisma.designAsset.createMany({
    data: [
      {
        createdAt: new Date("2026-07-27T01:00:00.000Z"),
        id: rootId,
        operation: DesignAssetOperation.GENERATED,
        projectId,
        rootAssetId: rootId,
        url: "https://cdn.test/root.png",
      },
      {
        createdAt: new Date("2026-07-27T02:00:00.000Z"),
        id: middleId,
        operation: DesignAssetOperation.VARIATION,
        parentAssetId: rootId,
        projectId,
        rootAssetId: rootId,
        url: "https://cdn.test/middle.png",
      },
      {
        createdAt: new Date("2026-07-27T03:00:00.000Z"),
        id: currentId,
        operation: DesignAssetOperation.INPAINT,
        parentAssetId: middleId,
        projectId,
        rootAssetId: rootId,
        url: "https://cdn.test/current.png",
      },
    ],
  });
  return { currentId, middleId, rootId, userId: user.id };
}
