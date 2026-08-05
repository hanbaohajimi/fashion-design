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
    $transaction: vi.fn(),
    collection: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn().mockResolvedValue(collectionRecord()),
      upsert: vi.fn().mockResolvedValue({ id: "collection-1" }),
    },
    collectionDna: {
      update: vi.fn(),
      upsert: vi.fn(),
    },
    collectionLook: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    collectionLookSimilarity: {
      findMany: vi.fn(),
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
  database.$transaction.mockImplementation(
    async (
      callback: (transaction: typeof database) => Promise<unknown>,
    ): Promise<unknown> => callback(database),
  );
  const extractor: DnaExtractor = {
    extract: vi.fn().mockResolvedValue(extractedDna),
  };
  const generation = {
    createForCollection: vi.fn(),
  };
  const storage = {
    createDownloadUrl: vi.fn(),
    head: vi.fn(),
    readPrefix: vi.fn(),
  };
  return {
    database,
    extractor,
    generation,
    service: new CollectionsService(
      database as never,
      extractor,
      generation as never,
      storage as never,
    ),
    storage,
  };
}

describe("CollectionsService", () => {
  it("从 Hero 提取 DNA，并以一对一结构创建系列", async () => {
    const { database, extractor, service } = setup();
    database.collection.findUnique.mockResolvedValue(null);

    const created = await service.createFromHero("user-1", "hero-1");

    expect(extractor.extract).toHaveBeenCalledWith(
      "https://cdn.test/hero-thumb.png",
    );
    expect(database.collection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          heroAssetId: "hero-1",
          projectId: "project-1",
        }),
        where: { heroAssetId: "hero-1" },
      }),
    );
    expect(database.collectionDna.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          extractionStatus: DnaExtractionStatus.READY,
          palette: [...extractedDna.palette],
        }),
        where: { collectionId: "collection-1" },
      }),
    );
    expect(database.collectionLook.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          collectionId: "collection-1",
          designAssetId: "hero-1",
          isHero: true,
          ordinal: 1,
        }),
        where: { designAssetId: "hero-1" },
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
    database.collection.findUniqueOrThrow.mockResolvedValue(
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

    expect(database.collectionDna.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          extractionStatus: DnaExtractionStatus.FAILED,
          fabrics: [],
          moodWords: [],
          palette: [],
          silhouettes: [],
        }),
      }),
    );
    expect(created.dna.extractionStatus).toBe("failed");
  });

  it("提取器返回全空结果时标记失败，不把空 DNA 宣称为已提取", async () => {
    const { database, extractor, service } = setup();
    database.collection.findUnique.mockResolvedValue(null);
    vi.mocked(extractor.extract).mockResolvedValue({
      fabrics: [],
      moodWords: [],
      palette: [],
      silhouettes: [],
    });
    database.collection.findUniqueOrThrow.mockResolvedValue(
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

    await service.createFromHero("user-1", "hero-1");

    expect(database.collectionDna.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          extractionStatus: DnaExtractionStatus.FAILED,
        }),
      }),
    );
  });

  it("私有 Hero 使用缩略图字节调用 VLM，避免外部模型访问本机签名 URL", async () => {
    const { database, extractor, service, storage } = setup();
    database.collection.findUnique.mockResolvedValue(null);
    database.designAsset.findUnique.mockResolvedValue({
      id: "hero-1",
      project: { workspace: { ownerId: "user-1" } },
      projectId: "project-1",
      thumbnailUrl: "s3://generated/hero/thumbnail.webp",
      url: "s3://generated/hero/source.png",
    });
    storage.head.mockResolvedValue({
      checksumSha256: undefined,
      contentLength: 3,
      contentType: "image/webp",
    });
    storage.readPrefix.mockResolvedValue(Uint8Array.from([1, 2, 3]));

    await service.createFromHero("user-1", "hero-1");

    expect(extractor.extract).toHaveBeenCalledWith(
      "data:image/webp;base64,AQID",
    );
  });

  it("扩展 Look 时把锁定 DNA 与变化轴注入生成提示", async () => {
    const { database, generation, service } = setup();
    database.collection.findUnique.mockResolvedValue(
      collectionRecord({
        dna: {
          ...collectionRecord().dna,
          paletteLocked: true,
        },
      }),
    );
    generation.createForCollection.mockResolvedValue({ taskId: "task-1" });

    const created = await service.createLook(
      "user-1",
      "collection-1",
      {
        prompt: "增加不对称门襟",
        variationAxis: "detail",
      },
      "collection-look-1",
    );

    expect(created).toEqual({ taskId: "task-1" });
    expect(generation.createForCollection).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        parentAssetId: "hero-1",
        projectId: "project-1",
        referenceImageUrl: "https://cdn.test/hero.png",
        strength: 0.2,
        taskType: "i2i",
        prompt: expect.stringMatching(
          /必须保持的锁定 DNA：色板=.*深石墨 #1D232A/,
        ),
      }),
      {
        collectionId: "collection-1",
        variationAxis: "DETAIL",
      },
      "collection-look-1",
    );
  });

  it("拒绝沿已锁定的 DNA 维度生成", async () => {
    const { database, generation, service } = setup();
    database.collection.findUnique.mockResolvedValue(
      collectionRecord({
        dna: {
          ...collectionRecord().dna,
          silhouettesLocked: true,
        },
      }),
    );

    await expect(
      service.createLook(
        "user-1",
        "collection-1",
        {
          variationAxis: "silhouette",
        },
        "collection-look-2",
      ),
    ).rejects.toMatchObject({
      response: { code: "VARIATION_AXIS_LOCKED" },
    });
    expect(generation.createForCollection).not.toHaveBeenCalled();
  });

  it("同一个 Hero 再次建系列时直接返回原系列，不重复提取", async () => {
    const { database, extractor, service } = setup();
    database.collection.findUnique.mockResolvedValue(collectionRecord());

    const existing = await service.createFromHero("user-1", "hero-1");

    expect(existing.id).toBe("collection-1");
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(database.collection.upsert).not.toHaveBeenCalled();
  });

  it("已有系列的 DNA 提取失败时允许再次从 Hero 恢复", async () => {
    const { database, extractor, service } = setup();
    database.collection.findUnique.mockResolvedValue(
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
    database.collectionDna.update.mockResolvedValue(collectionRecord().dna);

    const recovered = await service.createFromHero("user-1", "hero-1");

    expect(extractor.extract).toHaveBeenCalledOnce();
    expect(database.collectionDna.update).toHaveBeenCalledWith({
      where: { collectionId: "collection-1" },
      data: expect.objectContaining({
        extractionStatus: DnaExtractionStatus.READY,
        palette: [...extractedDna.palette],
      }),
    });
    expect(recovered.dna.extractionStatus).toBe("ready");
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

  it("拒绝锁定尚未定义的 DNA 维度", async () => {
    const { database, service } = setup();
    database.collection.findUnique.mockResolvedValue(
      collectionRecord({
        dna: {
          ...collectionRecord().dna,
          silhouettes: [],
        },
      }),
    );

    await expect(
      service.updateDna("user-1", "collection-1", {
        locks: { silhouettes: true },
      }),
    ).rejects.toMatchObject({
      response: { code: "DNA_DIMENSION_EMPTY" },
    });
  });
});
