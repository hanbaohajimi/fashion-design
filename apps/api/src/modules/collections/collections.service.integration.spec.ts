import { DesignAssetOperation, prisma } from "@fashion/db";
import { afterAll, describe, expect, it, vi } from "vitest";

import type { DnaExtractor } from "./dna-extractor";
import { CollectionsService } from "./collections.service";

describe("CollectionsService persistence integration", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("同一 Hero 只创建一个系列，锁定色板后重新读取仍保持", async () => {
    const fixture = await createFixture();
    const extractor: DnaExtractor = {
      extract: vi.fn().mockResolvedValue({
        fabrics: ["欧根纱"],
        moodWords: ["克制"],
        palette: [{ hex: "#24303A", name: "夜蓝" }],
        silhouettes: ["茧型"],
      }),
    };
    const service = new CollectionsService(prisma, extractor);

    try {
      const created = await service.createFromHero(
        fixture.userId,
        fixture.heroAssetId,
      );
      await service.updateDna(fixture.userId, created.id, {
        locks: { palette: true },
      });

      const reopened = await service.get(fixture.userId, created.id);
      const duplicate = await service.createFromHero(
        fixture.userId,
        fixture.heroAssetId,
      );

      expect(reopened.dna).toMatchObject({
        locks: { palette: true },
        palette: [{ hex: "#24303A", name: "夜蓝" }],
      });
      expect(duplicate.id).toBe(created.id);
      expect(extractor.extract).toHaveBeenCalledTimes(1);
      await expect(
        prisma.collection.count({
          where: { heroAssetId: fixture.heroAssetId },
        }),
      ).resolves.toBe(1);
    } finally {
      await prisma.user.delete({ where: { id: fixture.userId } });
    }
  });
});

async function createFixture(): Promise<{
  readonly heroAssetId: string;
  readonly userId: string;
}> {
  const user = await prisma.user.create({
    data: {
      email: `collection-${crypto.randomUUID()}@example.com`,
      ownedWorkspaces: {
        create: {
          name: "Collection workspace",
          projects: { create: { name: "Collection project" } },
        },
      },
    },
    include: {
      ownedWorkspaces: { include: { projects: true } },
    },
  });
  const projectId = user.ownedWorkspaces[0]?.projects[0]?.id;
  if (!projectId) throw new Error("测试项目创建失败");
  const heroAssetId = crypto.randomUUID();
  await prisma.designAsset.create({
    data: {
      id: heroAssetId,
      operation: DesignAssetOperation.GENERATED,
      projectId,
      rootAssetId: heroAssetId,
      url: "https://cdn.test/collection-hero.png",
    },
  });
  return { heroAssetId, userId: user.id };
}
