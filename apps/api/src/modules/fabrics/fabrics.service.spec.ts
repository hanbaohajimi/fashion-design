import { FabricScope, FileStatus } from "@fashion/db";
import { ForbiddenException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FabricsService } from "./fabrics.service";
import type { FilesService } from "../files/files.service";

function fabricRecord(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: new Date("2026-08-02T08:00:00.000Z"),
    id: "fabric-1",
    mainFile: {
      id: "file-1",
      mimeType: "image/png",
      objectKey: "originals/user-1/file-1/source",
    },
    mainFileId: "file-1",
    ownerId: "user-1",
    scope: FabricScope.USER,
    status: "active",
    tags: ["轻薄", "垂坠"],
    updatedAt: new Date("2026-08-02T08:00:00.000Z"),
    ...overrides,
  };
}

function setup(files?: Pick<FilesService, "assertReadable">) {
  const database = {
    fabric: {
      count: vi.fn(),
      create: vi.fn(),
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
      files as FilesService | undefined,
    ),
    storage,
  };
}

describe("FabricsService", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("签发共享面料图片前等待授权，撤销共享后拒绝且不再签名", async () => {
    let grantAccess: () => void = () => { throw new Error("Missing authorization callback"); };
    const files = { assertReadable: vi.fn().mockReturnValue(new Promise<void>((resolve) => { grantAccess = resolve; })) };
    const h = setup(files);
    h.database.fabric.findUnique.mockResolvedValue(fabricRecord());
    h.storage.createDownloadUrl.mockResolvedValue("https://private.test/signed");
    const pending = h.service.imageUrl("member", "fabric-1");
    await vi.waitFor(() => expect(files.assertReadable).toHaveBeenCalledWith("member", "file-1"));
    expect(h.storage.createDownloadUrl).not.toHaveBeenCalled();
    grantAccess();
    await expect(pending).resolves.toBe("https://private.test/signed");
    files.assertReadable.mockRejectedValue(new ForbiddenException("成员已撤销"));
    await expect(h.service.imageUrl("member", "fabric-1")).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.storage.createDownloadUrl).toHaveBeenCalledTimes(1);
  });

  it("陌生用户不能直接通过图片入口读取私人面料", async () => {
    const h = setup();
    h.database.fabric.findUnique.mockResolvedValue(fabricRecord());
    await expect(h.service.imageUrl("outsider", "fabric-1")).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.storage.createDownloadUrl).not.toHaveBeenCalled();
  });

  it("all 列表只查询预置面料和当前用户面料", async () => {
    const { database, service } = setup();
    database.fabric.count.mockResolvedValue(0);
    database.fabric.findMany.mockResolvedValue([]);

    await service.list("user-1", {
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

  it("搜索标签和面料档案，同时保留可见性限制", async () => {
    const { database, service } = setup();
    database.fabric.count.mockResolvedValue(0);
    database.fabric.findMany.mockResolvedValue([]);

    await service.list("user-1", {
      limit: 24,
      page: 1,
      scope: "all",
      search: "轻薄",
    });

    expect(database.fabric.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [{ OR: expect.arrayContaining([{ tags: { hasSome: ["轻薄"] } }]) }],
        }),
      }),
    );
  });

  it("对外仅返回图片和标签业务信息", async () => {
    const { database, service } = setup();
    database.fabric.findUnique.mockResolvedValue(fabricRecord());

    const result = await service.findOne("user-1", "fabric-1");

    expect(result).toMatchObject({
      canManage: true,
      id: "fabric-1",
      mainImageUrl: "/api/fabrics/fabric-1/image",
      tags: ["轻薄", "垂坠"],
    });
    expect(result.details).toBeNull();
    expect(result).not.toHaveProperty("attributes");
    expect(result).not.toHaveProperty("category");
    expect(result).not.toHaveProperty("name");
  });

  it("创建时只写入图片关联、标签和必要系统字段", async () => {
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
    database.fileAsset.update.mockResolvedValue({ id: "file-1" });
    database.fabric.create.mockResolvedValue(fabricRecord());
    storage.uploadBuffer.mockResolvedValue(undefined);

    await service.create("user-1", { tags: ["轻薄", "垂坠"] }, image);

    expect(database.fabric.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: "user-1",
          scope: FabricScope.USER,
          tags: ["轻薄", "垂坠"],
        }),
      }),
    );
  });

  it("仅允许拥有者更新标签", async () => {
    const { database, service } = setup();
    database.fabric.findUnique.mockResolvedValue(fabricRecord());
    database.fabric.update.mockResolvedValue(fabricRecord({ tags: ["哑光"] }));

    await service.update("user-1", "fabric-1", { tags: ["哑光"] });
    expect(database.fabric.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { tags: ["哑光"] } }),
    );

    database.fabric.findUnique.mockResolvedValue(
      fabricRecord({ ownerId: null, scope: FabricScope.PRESET }),
    );
    await expect(
      service.update("user-1", "fabric-1", { tags: ["哑光"] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("软删除自己的面料并保留白板引用", async () => {
    const { database, service } = setup();
    database.fabric.findUnique.mockResolvedValue(fabricRecord());
    database.fabric.update.mockResolvedValue(
      fabricRecord({ status: "archived" }),
    );

    await expect(service.remove("user-1", "fabric-1")).resolves.toBeUndefined();
    expect(database.fabric.update).toHaveBeenCalledWith({
      data: { status: "archived" },
      where: { id: "fabric-1" },
    });
  });

  it("面料库管理员可以软删除系统预置面料", async () => {
    vi.stubEnv("FABRIC_LIBRARY_ADMIN_USER_IDS", "admin-1, admin-2");
    const { database, service } = setup();
    database.fabric.findUnique.mockResolvedValue(
      fabricRecord({ ownerId: null, scope: FabricScope.PRESET }),
    );
    database.fabric.update.mockResolvedValue(
      fabricRecord({
        ownerId: null,
        scope: FabricScope.PRESET,
        status: "archived",
      }),
    );

    await expect(service.remove("admin-1", "fabric-1")).resolves.toBeUndefined();
    await expect(service.findOne("admin-1", "fabric-1")).resolves.toMatchObject({
      canManage: true,
    });
  });

  it("结构化筛选与分页在数据库执行，标签不会冒充成分", async () => {
    const { database, service } = setup();
    database.fabric.count.mockResolvedValue(3);
    database.fabric.findMany.mockResolvedValue([]);
    const result = await service.list("user-1", { limit: 2, page: 2, scope: "user", search: "", fiber: "Cotton", category: "梭织", minWeightGsm: 120, maxWeightGsm: 180 });
    const where = database.fabric.findMany.mock.calls[0]?.[0].where;
    expect(where).toMatchObject({ ownerId: "user-1", scope: FabricScope.USER, status: "active", AND: [
      { details: { path: ["category"], equals: "梭织" } },
      { details: { path: ["_fiberKeys"], array_contains: ["cotton"] } },
      { details: { path: ["weightGsm"], gte: 120 } },
      { details: { path: ["weightGsm"], lte: 180 } },
    ] });
    expect(database.fabric.count).toHaveBeenCalledWith({ where });
    expect(database.fabric.findMany.mock.calls[0]?.[0]).toMatchObject({ skip: 2, take: 2 });
    expect(result).toMatchObject({ total: 3, totalPages: 2, page: 2 });
  });

  it("更新档案派生成分索引，返回来源并隐藏内部索引", async () => {
    const { database, service } = setup();
    const details = { name: "棉麻平纹", composition: [{ fiber: "Cotton", percent: 60 }, { fiber: "Linen", percent: 40 }], provenance: { composition: { source: "supplier" as const, note: "资料编号 A17" } } };
    database.fabric.findUnique.mockResolvedValue(fabricRecord());
    database.fabric.update.mockResolvedValue(fabricRecord({ details: { ...details, _fiberKeys: ["cotton", "linen"] } }));
    const result = await service.update("user-1", "fabric-1", { details });
    expect(database.fabric.update).toHaveBeenCalledWith(expect.objectContaining({ data: { details: { ...details, _fiberKeys: ["cotton", "linen"] } } }));
    expect(result.details).toEqual(details);
    expect(result.details).not.toHaveProperty("_fiberKeys");
  });

  it("仅修改标签保留档案，外部用户不可更新或读取私有规格", async () => {
    const { database, service } = setup();
    database.fabric.findUnique.mockResolvedValue(fabricRecord({ details: { name: "私有面料" } }));
    database.fabric.update.mockResolvedValue(fabricRecord());
    await service.update("user-1", "fabric-1", { tags: ["新标签"] });
    expect(database.fabric.update.mock.calls[0]?.[0].data).toEqual({ tags: ["新标签"] });
    await expect(service.update("other-user", "fabric-1", { details: null })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.findOne("other-user", "fabric-1")).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.fabric.update).toHaveBeenCalledTimes(1);
  });

});
