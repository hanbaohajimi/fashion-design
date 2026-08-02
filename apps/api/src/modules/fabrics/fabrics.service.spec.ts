import { FabricScope, FileStatus } from "@fashion/db";
import { ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FabricsService } from "./fabrics.service";

const attributes = {
  composition: { cotton: 100 },
  drape: "moderate" as const,
  weave: "plain" as const,
  weight: 120,
};

function fabricRecord(overrides: Record<string, unknown> = {}) {
  return {
    aiTags: null,
    attributes,
    category: "cotton",
    createdAt: new Date("2026-08-02T08:00:00.000Z"),
    id: "fabric-1",
    license: null,
    mainFile: {
      id: "file-1",
      mimeType: "image/png",
      objectKey: "originals/user-1/file-1/source",
    },
    mainFileId: "file-1",
    name: "纯棉府绸",
    ownerId: "user-1",
    scope: FabricScope.USER,
    source: "user_upload",
    status: "active",
    subCategory: "poplin",
    updatedAt: new Date("2026-08-02T08:00:00.000Z"),
    ...overrides,
  };
}

function setup() {
  const database = {
    fabric: {
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    fileAsset: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  const storage = {
    createDownloadUrl: vi.fn(),
    uploadBuffer: vi.fn(),
  };
  const thumbnailJobs = { enqueue: vi.fn().mockResolvedValue(undefined) };
  return {
    database,
    service: new FabricsService(
      database as never,
      storage as never,
      thumbnailJobs,
    ),
    storage,
  };
}

describe("FabricsService 权限边界", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("all 列表只查询预置面料和当前用户面料", async () => {
    const { database, service } = setup();
    database.fabric.count.mockResolvedValue(0);
    database.fabric.findMany.mockResolvedValue([]);

    await service.list("user-1", {
      category: undefined,
      limit: 24,
      page: 1,
      scope: "all",
      search: "",
    });

    expect(database.fabric.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { scope: FabricScope.PRESET },
            { ownerId: "user-1", scope: FabricScope.USER },
          ],
        }),
      }),
    );
  });

  it("搜索同时覆盖名称与结构化 attributes", async () => {
    const { database, service } = setup();
    database.fabric.count.mockResolvedValue(0);
    database.fabric.findMany.mockResolvedValue([]);

    await service.list("user-1", {
      category: undefined,
      limit: 24,
      page: 1,
      scope: "all",
      search: "shirt",
    });

    expect(database.fabric.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            expect.objectContaining({
              OR: expect.arrayContaining([
                {
                  attributes: {
                    array_contains: ["shirt"],
                    path: ["useCases"],
                  },
                },
              ]),
            }),
          ],
        }),
      }),
    );
  });

  it("允许任意登录用户读取预置面料", async () => {
    const { database, service } = setup();
    database.fabric.findUnique.mockResolvedValue(
      fabricRecord({ ownerId: null, scope: FabricScope.PRESET }),
    );

    await expect(service.findOne("user-2", "fabric-1")).resolves.toMatchObject({
      id: "fabric-1",
      scope: "preset",
    });
  });

  it("拒绝读取其他用户的私有面料", async () => {
    const { database, service } = setup();
    database.fabric.findUnique.mockResolvedValue(fabricRecord());

    await expect(service.findOne("user-2", "fabric-1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("创建时强制写入 user scope 和当前 ownerId", async () => {
    const { database, service, storage } = setup();
    const image = {
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      mimetype: "image/png",
      originalname: "fabric.png",
      size: 8,
    };
    database.fileAsset.findUnique.mockResolvedValue(null);
    database.fileAsset.create.mockImplementation(({ data }) =>
      Promise.resolve({
        ...data,
        completedAt: null,
        createdAt: new Date(),
        errorMessage: null,
        height: null,
        status: FileStatus.PENDING,
        thumbnail1024Key: null,
        thumbnail256Key: null,
        updatedAt: new Date(),
        width: null,
      }),
    );
    database.fileAsset.update.mockResolvedValue({
      id: "file-1",
      status: FileStatus.READY,
    });
    database.fabric.create.mockResolvedValue(fabricRecord());
    storage.uploadBuffer.mockResolvedValue(undefined);

    await service.create(
      "user-1",
      {
        attributes,
        category: "cotton",
        name: "纯棉府绸",
        subCategory: "poplin",
      },
      image,
    );

    expect(database.fabric.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: "user-1",
          scope: FabricScope.USER,
        }),
      }),
    );
  });

  it("拒绝修改预置面料或其他用户面料", async () => {
    const { database, service } = setup();
    database.fabric.findUnique
      .mockResolvedValueOnce(
        fabricRecord({ ownerId: null, scope: FabricScope.PRESET }),
      )
      .mockResolvedValueOnce(fabricRecord());

    await expect(
      service.update("user-1", "fabric-1", { name: "新名称" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.update("user-2", "fabric-1", { name: "新名称" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.fabric.update).not.toHaveBeenCalled();
  });

  it("仅删除当前用户自己的面料", async () => {
    const { database, service } = setup();
    database.fabric.findUnique
      .mockResolvedValueOnce(fabricRecord())
      .mockResolvedValueOnce(fabricRecord());
    database.fabric.delete.mockResolvedValue(fabricRecord());

    await expect(service.remove("user-2", "fabric-1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.remove("user-1", "fabric-1")).resolves.toBeUndefined();
    expect(database.fabric.delete).toHaveBeenCalledWith({
      where: { id: "fabric-1" },
    });
  });
});
