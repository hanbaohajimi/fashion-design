import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { DesignAssetsService } from "../design-assets/design-assets.service";
import { ProjectsService } from "../projects/projects.service";

const project = {
  id: "project-a",
  wsId: "ws-a",
  name: "团队系列",
  archived: false,
  deletedAt: null,
  coverAssetId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  workspace: { ownerId: "owner-a" },
};
function policy() {
  return {
    require: vi
      .fn()
      .mockImplementation((_user: string, _project: string, action: string) =>
        action === "read"
          ? Promise.resolve({ role: "VIEWER" })
          : Promise.reject(new ForbiddenException("只读")),
      ),
  };
}
describe("legacy project and asset entry points use workspace policy", () => {
  it("includes workspace memberships when listing projects and statistics", async () => {
    const database = {
      project: {
        findMany: vi.fn().mockResolvedValue([project]),
        count: vi.fn().mockResolvedValue(1),
      },
      designAsset: { count: vi.fn().mockResolvedValue(1) },
    };
    await new ProjectsService(database as never).list("viewer-a", {
      archived: "active",
      limit: 50,
      page: 1,
      search: "",
    });
    expect(database.project.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        workspace: {
          OR: [
            { ownerId: "viewer-a" },
            { members: { some: { userId: "viewer-a" } } },
          ],
        },
      },
    });
    expect(database.project.count.mock.calls[0]?.[0]).toMatchObject({
      where: {
        workspace: {
          OR: [
            { ownerId: "viewer-a" },
            { members: { some: { userId: "viewer-a" } } },
          ],
        },
      },
    });
  });
  it("allows a viewer to read project details and refuses modifying them", async () => {
    const database = {
      project: {
        findUnique: vi.fn().mockResolvedValue(project),
        update: vi.fn(),
      },
    };
    const access = policy();
    const service = new ProjectsService(database as never, access as never);
    await expect(service.get("viewer-a", "project-a")).resolves.toMatchObject({
      id: "project-a",
    });
    await expect(
      service.update("viewer-a", "project-a", { name: "非法更改" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.project.update).not.toHaveBeenCalled();
    expect(access.require).toHaveBeenCalledWith(
      "viewer-a",
      "project-a",
      "edit",
    );
  });
  it("requires owner management permission for project deletion", async () => {
    const database = {
      project: {
        findUnique: vi.fn().mockResolvedValue(project),
        update: vi.fn(),
      },
    };
    const access = policy();
    await expect(
      new ProjectsService(database as never, access as never).remove(
        "editor-a",
        "project-a",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(access.require).toHaveBeenCalledWith(
      "editor-a",
      "project-a",
      "manage",
    );
  });
  it("allows member image downloads but refuses read-only restores and selections", async () => {
    const asset = {
      id: "asset-a",
      projectId: "project-a",
      rootAssetId: "asset-a",
      parentAssetId: null,
      url: "s3://private/a.png",
      thumbnailUrl: "s3://private/a.webp",
      project: { deletedAt: null, workspace: { ownerId: "owner-a" } },
    };
    const database = {
      designAsset: {
        findUnique: vi.fn().mockResolvedValue(asset),
        create: vi.fn(),
      },
      designAssetDecision: { upsert: vi.fn() },
    };
    const storage = {
      createDownloadUrl: vi
        .fn()
        .mockResolvedValue("https://private.example/signed"),
    };
    const access = policy();
    const service = new DesignAssetsService(
      database as never,
      storage as never,
      access as never,
    );
    await expect(
      service.downloadUrl("viewer-a", "asset-a", "content"),
    ).resolves.toBe("https://private.example/signed");
    await expect(
      service.downloadUrl("viewer-a", "asset-a", "thumbnail"),
    ).resolves.toBe("https://private.example/signed");
    await expect(
      service.restore("viewer-a", "asset-a", "asset-a"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.decide("viewer-a", "asset-a", {
        clientRequestId: "request-1",
        kind: "selected",
        reason: "选择",
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.designAsset.create).not.toHaveBeenCalled();
    expect(database.designAssetDecision.upsert).not.toHaveBeenCalled();
  });
  it("checks fresh membership before each signed download", async () => {
    const database = {
      designAsset: {
        findUnique: vi.fn().mockResolvedValue({
          id: "asset-a",
          projectId: "project-a",
          url: "s3://private/a.png",
          project: { deletedAt: null, workspace: { ownerId: "owner-a" } },
        }),
      },
    };
    const storage = { createDownloadUrl: vi.fn() };
    const access = {
      require: vi.fn().mockRejectedValue(new ForbiddenException("成员已移除")),
    };
    await expect(
      new DesignAssetsService(
        database as never,
        storage as never,
        access as never,
      ).downloadUrl("removed-a", "asset-a", "content"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.createDownloadUrl).not.toHaveBeenCalled();
  });
});
