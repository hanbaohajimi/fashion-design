import { DnaExtractionStatus } from "@fashion/db";
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { DnaExtractor } from "./dna-extractor";
import { CollectionsService } from "./collections.service";

const extractedDna = {
  fabrics: ["欧根纱", "哑光皮革"],
  moodWords: ["克制", "未来感"],
  palette: [
    { hex: "#1D232A", name: "深石墨" },
    { hex: "#E7DDD0", name: "暖象牙" },
  ],
  silhouettes: ["茧型", "低腰直筒"],
} as const;

function collectionRecord(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: new Date("2026-07-28T08:00:00.000Z"),
    dna: {
      collectionId: "collection-1",
      extractionStatus: DnaExtractionStatus.READY,
      fabrics: [...extractedDna.fabrics],
      fabricsLocked: false,
      moodWords: [...extractedDna.moodWords],
      moodWordsLocked: false,
      palette: [...extractedDna.palette],
      paletteLocked: false,
      referenceFileIds: [],
      silhouettes: [...extractedDna.silhouettes],
      silhouettesLocked: false,
      updatedAt: new Date("2026-07-28T08:00:00.000Z"),
    },
    heroAsset: {
      id: "hero-1",
      thumbnailUrl: "https://cdn.test/hero-thumb.png",
      url: "https://cdn.test/hero.png",
    },
    heroAssetId: "hero-1",
    id: "collection-1",
    name: "系列 · HERO-1",
    project: { workspace: { ownerId: "user-1" } },
    projectId: "project-1",
    updatedAt: new Date("2026-07-28T08:00:00.000Z"),
    ...overrides,
  };
}

function setup() {
  const database = {
    collection: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    collectionDna: {
      update: vi.fn(),
    },
    designAsset: {
      findUnique: vi.fn().mockResolvedValue({
        id: "hero-1",
        project: { workspace: { ownerId: "user-1" } },
        projectId: "project-1",
        thumbnailUrl: "https://cdn.test/hero-thumb.png",
        url: "https://cdn.test/hero.png",
      }),
    },
    fileAsset: {
      count: vi.fn(),
    },
  };
  const extractor: DnaExtractor = {
    extract: vi.fn().mockResolvedValue(extractedDna),
  };
  return {
    database,
    extractor,
    service: new CollectionsService(database as never, extractor),
  };
}

describe("CollectionsService", () => {
  it("从 Hero 提取 DNA，并以一对一结构创建系列", async () => {
    const { database, extractor, service } = setup();
    database.collection.findUnique.mockResolvedValue(null);
    database.collection.upsert.mockResolvedValue(collectionRecord());

    const created = await service.createFromHero("user-1", "hero-1");

    expect(extractor.extract).toHaveBeenCalledWith("https://cdn.test/hero.png");
    expect(database.collection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          heroAssetId: "hero-1",
          projectId: "project-1",
          dna: {
            create: expect.objectContaining({
              extractionStatus: DnaExtractionStatus.READY,
              palette: [...extractedDna.palette],
            }),
          },
        }),
        where: { heroAssetId: "hero-1" },
      }),
    );
    expect(created.dna.palette).toEqual(extractedDna.palette);
  });

  it("提取失败时仍创建带空 DNA 的系列", async () => {
    const { database, extractor, service } = setup();
    database.collection.findUnique.mockResolvedValue(null);
    vi.mocked(extractor.extract).mockRejectedValue(
      new Error("VLM unavailable"),
    );
    database.collection.upsert.mockResolvedValue(
      collectionRecord({
        dna: {
          ...collectionRecord().dna,
          extractionStatus: DnaExtractionStatus.FAILED,
          fabrics: [],
          moodWords: [],
          palette: [],
          silhouettes: [],
        },
      }),
    );

    const created = await service.createFromHero("user-1", "hero-1");

    expect(database.collection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          dna: {
            create: expect.objectContaining({
              extractionStatus: DnaExtractionStatus.FAILED,
              fabrics: [],
              moodWords: [],
              palette: [],
              silhouettes: [],
            }),
          },
        }),
      }),
    );
    expect(created.dna.extractionStatus).toBe("failed");
  });

  it("同一个 Hero 再次建系列时直接返回原系列，不重复提取", async () => {
    const { database, extractor, service } = setup();
    database.collection.findUnique.mockResolvedValue(collectionRecord());

    const existing = await service.createFromHero("user-1", "hero-1");

    expect(existing.id).toBe("collection-1");
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(database.collection.upsert).not.toHaveBeenCalled();
  });

  it("锁定色板后拒绝覆盖，解锁与编辑可在同一请求原子完成", async () => {
    const { database, service } = setup();
    database.collection.findUnique.mockResolvedValue(
      collectionRecord({
        dna: {
          ...collectionRecord().dna,
          paletteLocked: true,
        },
      }),
    );

    await expect(
      service.updateDna("user-1", "collection-1", {
        palette: [{ hex: "#000000", name: "黑" }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    database.collectionDna.update.mockResolvedValue({
      ...collectionRecord().dna,
      palette: [{ hex: "#000000", name: "黑" }],
      paletteLocked: false,
    });
    const updated = await service.updateDna("user-1", "collection-1", {
      locks: { palette: false },
      palette: [{ hex: "#000000", name: "黑" }],
    });

    expect(updated.palette).toEqual([{ hex: "#000000", name: "黑" }]);
    expect(updated.locks.palette).toBe(false);
  });

  it("色板锁定时仍允许保存其他维度携带的未变色板快照", async () => {
    const { database, service } = setup();
    database.collection.findUnique.mockResolvedValue(
      collectionRecord({
        dna: {
          ...collectionRecord().dna,
          paletteLocked: true,
        },
      }),
    );
    database.collectionDna.update.mockResolvedValue({
      ...collectionRecord().dna,
      moodWords: ["冷静", "雕塑感"],
      paletteLocked: true,
    });

    await expect(
      service.updateDna("user-1", "collection-1", {
        locks: { palette: true },
        moodWords: ["冷静", "雕塑感"],
        palette: [...extractedDna.palette],
      }),
    ).resolves.toMatchObject({
      locks: { palette: true },
      moodWords: ["冷静", "雕塑感"],
    });
  });
});
