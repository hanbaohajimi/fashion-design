import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { ProjectsService } from "./projects.service";

const now = new Date("2026-07-27T08:00:00.000Z");

function projectFixture(overrides: Record<string, unknown> = {}) {
  return {
    archived: false,
    coverAssetId: null,
    createdAt: now,
    deletedAt: null,
    id: "project-a",
    idempotencyKey: "idempotency-a",
    name: "春季系列",
    updatedAt: now,
    wsId: "workspace-a",
    ...overrides,
  };
}

describe("ProjectsService ownership and soft deletion", () => {
  it("returns the real design asset count and falls back to the latest asset as cover", async () => {
    const database = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
      designAsset: { count: vi.fn().mockResolvedValue(3) },
      project: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            ...projectFixture(),
            _count: { designAssets: 3 },
            designAssets: [{ id: "asset-latest" }],
          },
        ]),
      },
      workspace: {},
    };
    const service = new ProjectsService(database as never);

    await expect(
      service.list("user-a", {
        archived: "active",
        limit: 50,
        page: 1,
        search: "",
      }),
    ).resolves.toMatchObject({
      items: [
        {
          assetCount: 3,
          coverAssetId: "asset-latest",
          coverUrl: "/api/design-assets/asset-latest/thumbnail",
        },
      ],
    });
    expect(database.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          _count: { select: { designAssets: true } },
          designAssets: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { id: true },
            take: 1,
          },
        },
      }),
    );
  });

  it("returns an owned project detail for the board header", async () => {
    const database = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
      designAsset: { count: vi.fn().mockResolvedValue(0) },
      project: {
        findUnique: vi.fn().mockResolvedValue({
          ...projectFixture(),
          workspace: { ownerId: "user-a" },
        }),
      },
      workspace: {},
    };
    const service = new ProjectsService(database as never);

    await expect(service.get("user-a", "project-a")).resolves.toMatchObject({
      id: "project-a",
      name: "春季系列",
    });
  });

  it("returns 403 when user A tries to update user B's project", async () => {
    const database = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
      project: {
        findUnique: vi.fn().mockResolvedValue({
          ...projectFixture({ id: "project-b", wsId: "workspace-b" }),
          workspace: { ownerId: "user-b" },
        }),
        update: vi.fn(),
      },
      workspace: {},
    };
    const service = new ProjectsService(database as never);

    const result = service.update("user-a", "project-b", {
      name: "越权重命名",
    });

    await expect(result).rejects.toBeInstanceOf(ForbiddenException);
    await expect(result).rejects.toMatchObject({
      response: {
        code: "PROJECT_FORBIDDEN",
      },
      status: 403,
    });
    expect(database.project.update).not.toHaveBeenCalled();
  });

  it("soft-deletes a project and excludes it from later lists", async () => {
    const storedProject = projectFixture();
    let deletedAt: Date | null = null;
    const database = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
      designAsset: { count: vi.fn().mockResolvedValue(0) },
      project: {
        count: vi.fn().mockImplementation(() =>
          Promise.resolve(deletedAt ? 0 : 1),
        ),
        findMany: vi.fn().mockImplementation(() =>
          Promise.resolve(deletedAt ? [] : [{ ...storedProject, deletedAt }]),
        ),
        findUnique: vi.fn().mockImplementation(() =>
          Promise.resolve({
            ...storedProject,
            deletedAt,
            workspace: { ownerId: "user-a" },
          }),
        ),
        update: vi.fn().mockImplementation(
          ({ data }: { data: { deletedAt?: Date } }) => {
            if (data.deletedAt) {
              deletedAt = data.deletedAt;
            }

            return Promise.resolve({ ...storedProject, deletedAt });
          },
        ),
      },
      workspace: {},
    };
    const service = new ProjectsService(database as never);
    const query = {
      archived: "active" as const,
      limit: 50,
      page: 1,
      search: "",
    };

    await expect(service.list("user-a", query)).resolves.toMatchObject({
      items: [{ id: "project-a" }],
      total: 1,
    });

    await service.remove("user-a", "project-a");

    expect(deletedAt).toBeInstanceOf(Date);
    await expect(service.list("user-a", query)).resolves.toMatchObject({
      items: [],
      total: 0,
    });
  });

  it("does not allow a soft-deleted project to be updated", async () => {
    const database = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
      project: {
        findUnique: vi.fn().mockResolvedValue({
          ...projectFixture({ deletedAt: now }),
          workspace: { ownerId: "user-a" },
        }),
        update: vi.fn(),
      },
      workspace: {},
    };
    const service = new ProjectsService(database as never);

    await expect(
      service.update("user-a", "project-a", { name: "删除后的项目" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(database.project.update).not.toHaveBeenCalled();
  });

  it("returns the existing project when an idempotency key is retried", async () => {
    const existing = projectFixture();
    const database = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
      project: {
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(existing),
      },
      workspace: {
        findFirst: vi.fn().mockResolvedValue({ id: "workspace-a" }),
      },
    };
    const service = new ProjectsService(database as never);

    const result = await service.create(
      "user-a",
      { name: "春季系列" },
      "idempotency-a",
    );

    expect(result.id).toBe("project-a");
    expect(database.project.create).not.toHaveBeenCalled();
  });

  it("duplicates design assets and remaps asset references in board records", async () => {
    const source = {
      ...projectFixture(),
      boardElements: [
        {
          deletedAt: null,
          fileAssetId: "file-a",
          record: {
            id: "shape:image",
            props: { assetId: "asset-source", role: "style_ref" },
          },
          role: "style_ref",
          roleConfidence: 1,
          roleInferenceState: "READY",
          roleLabel: "风格参考",
          roleSource: "MANUAL",
          shapeId: "shape:image",
          shapeType: "fashion-image",
        },
        {
          deletedAt: null,
          fileAssetId: null,
          record: {
            id: "shape:legacy-connector",
            props: {},
            type: "fashion-connector",
            typeName: "shape",
          },
          role: "generic",
          roleConfidence: null,
          roleInferenceState: "READY",
          roleLabel: null,
          roleSource: "DEFAULT",
          shapeId: "shape:legacy-connector",
          shapeType: "fashion-connector",
        },
      ],
      boardSnapshot: {
        snapshot: {
          document: {
            store: {
              "shape:image": {
                id: "shape:image",
                props: { assetId: "asset-source" },
                type: "fashion-image",
                typeName: "shape",
              },
              "shape:legacy-connector": {
                id: "shape:legacy-connector",
                props: {},
                type: "fashion-connector",
                typeName: "shape",
              },
            },
          },
          selectedAssetId: "asset-source",
        },
      },
      collections: [],
      workflowGraph: { nodes: [
        { id: "tool-source", kind: "tool", type: "generate_design", title: "设计", payload: { toolKey: "generate_design", toolVersion: "1", params: { referenceInputs: [{ nodeId: "ref-source" }] } }, status: "completed", x: 1, y: 2 },
        { id: "ref-source", kind: "asset", type: "candidate", title: "结果", payload: { assetId: "asset-source", generationTaskId: "old-task", attemptId: "old-attempt", imageUrl: "/api/design-assets/asset-source/content" }, status: "completed", x: 4, y: 5 },
        { id: "running-source", kind: "tool", type: "generate_design", title: "处理中", payload: {}, status: "running", x: 7, y: 8 },
      ], edges: [{ id: "edge-source", sourceNodeId: "tool-source", targetNodeId: "ref-source", sourcePort: "out", targetPort: "source" }] },
      designContext: { state: { currentObjective: "春季通勤", preferences: [] } },
      designAssets: [
        {
          archivedAt: null,
          height: 1024,
          id: "asset-source",
          operation: "GENERATED",
          parentAssetId: null,
          restoredFromAssetId: null,
          rootAssetId: "asset-source",
          seed: 7n,
          thumbnailUrl: "https://cdn.example.com/thumb.png",
          url: "https://cdn.example.com/design.png",
          width: 768,
        },
      ],
      workspace: { ownerId: "user-a" },
    };
    const designAssetCreateMany = vi.fn().mockResolvedValue({ count: 1 });
    const boardElementCreateMany = vi.fn().mockResolvedValue({ count: 1 });
    const boardSnapshotCreate = vi.fn().mockResolvedValue({});
    const transaction = {
      boardElement: { createMany: boardElementCreateMany },
      boardSnapshot: { create: boardSnapshotCreate },
      collection: { create: vi.fn() },
      collectionDna: { create: vi.fn() },
      collectionLook: { createMany: vi.fn() },
      collectionLookSimilarity: { createMany: vi.fn() },
      designAsset: { createMany: designAssetCreateMany },
      $queryRaw: vi.fn().mockResolvedValue([]),
      workflowGraph: { create: vi.fn() },
      workflowNode: { createMany: vi.fn() },
      workflowEdge: { createMany: vi.fn() },
      workflowNodeVersion: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(async ({ data }) => ({ ...data, id: crypto.randomUUID() })), updateMany: vi.fn() },
      projectDesignContext: { create: vi.fn() },
      project: {
        findUnique: vi.fn().mockResolvedValue(source),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(
          projectFixture({ id: "project-copy", name: "春季系列 副本" }),
        ),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ...projectFixture({ id: "project-copy", name: "春季系列 副本" }),
          _count: { designAssets: 1 },
          designAssets: [{ id: "asset-copy" }],
        }),
      },
    };
    const database = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(
        async (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
      project: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            ...projectFixture(),
            workspace: { ownerId: "user-a" },
          })
          .mockResolvedValueOnce(source),
      },
      workspace: {},
    };
    const service = new ProjectsService(database as never);

    await expect(
      service.duplicate("user-a", "project-a", "copy-key"),
    ).resolves.toMatchObject({ assetCount: 1, id: "project-copy" });

    const duplicatedAsset = designAssetCreateMany.mock.calls[0]?.[0].data[0];
    expect(duplicatedAsset.id).not.toBe("asset-source");
    expect(duplicatedAsset.projectId).toBe("project-copy");
    expect(duplicatedAsset.rootAssetId).toBe(duplicatedAsset.id);
    const nodes = transaction.workflowNode.createMany.mock.calls[0]?.[0].data;
    expect(nodes).toHaveLength(3);
    const copiedResult = nodes.find((node: { type: string }) => node.type === "candidate");
    expect(copiedResult.payload).toMatchObject({ assetId: duplicatedAsset.id, imageUrl: `/api/design-assets/${duplicatedAsset.id}/content` });
    expect(copiedResult.payload).not.toHaveProperty("generationTaskId");
    expect(copiedResult.payload).not.toHaveProperty("attemptId");
    expect(nodes.find((node: { title: string }) => node.title === "处理中").status).toBe("ready");
    expect(transaction.workflowNodeVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { origin: "project_copy" } }));
    expect(boardElementCreateMany.mock.calls[0]?.[0].data[0].record).toMatchObject({
      props: { assetId: duplicatedAsset.id },
    });
    expect(boardElementCreateMany.mock.calls[0]?.[0].data).toHaveLength(1);
    expect(boardSnapshotCreate.mock.calls[0]?.[0].data.snapshot).toEqual({
      document: {
        store: {
          "shape:image": {
            id: "shape:image",
            props: { assetId: duplicatedAsset.id },
            type: "fashion-image",
            typeName: "shape",
          },
        },
      },
      selectedAssetId: duplicatedAsset.id,
    });
  });
});
