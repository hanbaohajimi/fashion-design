import { RoleInferenceState, RoleSource } from "@fashion/db";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { BoardElementsService } from "./board-elements.service";
import { BullVlmInferenceJobs } from "./vlm-inference-queue.service";

function element(overrides: Record<string, unknown> = {}) {
  return {
    deletedAt: null,
    fileAssetId: "file-1",
    id: "element-1",
    projectId: "project-a",
    record: null,
    role: "style_ref",
    roleConfidence: null,
    roleInferenceState: RoleInferenceState.PENDING,
    roleLabel: null,
    roleSource: RoleSource.DEFAULT,
    shapeId: "shape:one",
    shapeType: "fashion-image",
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("BoardElementsService", () => {
  it("returns 403 when user A accesses user B's project", async () => {
    const database = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          workspace: { ownerId: "user-b" },
        }),
      },
    };
    const service = new BoardElementsService(database as never, {
      enqueue: vi.fn(),
    });

    await expect(
      service.setRoles("user-a", "project-b", {
        role: "avoid",
        shapeIds: ["shape:one"],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("keeps upload non-blocking and falls back when queue enqueue fails", async () => {
    const fallback = element({
      roleInferenceState: RoleInferenceState.FAILED,
    });
    const database = {
      boardElement: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(element())
          .mockResolvedValueOnce(fallback),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        upsert: vi.fn().mockResolvedValue(element()),
      },
      fileAsset: {
        findUnique: vi.fn().mockResolvedValue({ ownerId: "user-a" }),
      },
      project: {
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          workspace: { ownerId: "user-a" },
        }),
      },
    };
    const service = new BoardElementsService(database as never, {
      enqueue: vi.fn().mockRejectedValue(new Error("redis unavailable")),
    });

    await expect(
      service.registerInference("user-a", "project-a", "shape:one", "file-1"),
    ).resolves.toMatchObject({
      role: "style_ref",
      source: "default",
      state: "failed",
    });
  });

  it("batch-upserts every selected role as a manual override", async () => {
    const upsert = vi.fn().mockImplementation(({ where }) =>
      Promise.resolve(
        element({
          role: "fabric_ref",
          roleInferenceState: RoleInferenceState.READY,
          roleSource: RoleSource.MANUAL,
          shapeId: where.projectId_shapeId.shapeId,
        }),
      ),
    );
    const database = {
      boardElement: { upsert },
      project: {
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          workspace: { ownerId: "user-a" },
        }),
      },
    };
    const service = new BoardElementsService(database as never, {
      enqueue: vi.fn(),
    });

    await expect(
      service.setRoles("user-a", "project-a", {
        role: "fabric_ref",
        shapeIds: ["shape:one", "shape:two", "shape:two"],
      }),
    ).resolves.toMatchObject({
      count: 2,
      elements: [
        { role: "fabric_ref", source: "manual" },
        { role: "fabric_ref", source: "manual" },
      ],
    });
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("binds a rendered sketch as one finalized silhouette image", async () => {
    const record = {
      id: "shape:sketch",
      meta: {
        fashionSketch: true,
        fashionSketchImage: true,
        sketchDirty: false,
        sketchFingerprint: "a".repeat(64),
        sketchStatus: "ready",
      },
      parentId: "page:page",
      props: {
        fileId: "file-sketch",
        h: 860,
        role: "silhouette_ref",
        roleInferenceState: "ready",
        roleLabel: "fashion_sketch",
        roleSource: "manual",
        title: "廓形草图 01",
        uploadStatus: "ready",
        url: "https://files.example/sketch.png",
        w: 640,
      },
      type: "fashion-image",
      typeName: "shape",
      x: 0,
      y: 0,
    };
    const bound = element({
      fileAssetId: "file-sketch",
      role: "silhouette_ref",
      roleInferenceState: RoleInferenceState.READY,
      roleSource: RoleSource.MANUAL,
      shapeId: "shape:sketch",
      shapeType: "fashion-image",
    });
    const upsert = vi.fn().mockResolvedValue(bound);
    const database = {
      boardElement: { upsert },
      fileAsset: {
        findUnique: vi.fn().mockResolvedValue({ ownerId: "user-a" }),
      },
      project: {
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          workspace: { ownerId: "user-a" },
        }),
      },
    };
    const enqueue = vi.fn();
    const service = new BoardElementsService(database as never, { enqueue });

    await expect(
      service.bindSketchReference(
        "user-a",
        "project-a",
        "shape:sketch",
        {
          fileId: "file-sketch",
          fingerprint: "a".repeat(64),
          record,
        },
      ),
    ).resolves.toMatchObject({
      role: "silhouette_ref",
      shapeId: "shape:sketch",
      source: "manual",
      state: "ready",
    });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        projectId_shapeId: {
          projectId: "project-a",
          shapeId: "shape:sketch",
        },
      },
      create: expect.objectContaining({
        fileAssetId: "file-sketch",
        record,
        role: "silhouette_ref",
        roleSource: RoleSource.MANUAL,
        shapeType: "fashion-image",
      }),
      update: expect.objectContaining({
        fileAssetId: "file-sketch",
        record,
        role: "silhouette_ref",
        roleSource: RoleSource.MANUAL,
        shapeType: "fashion-image",
      }),
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rejects a sketch record that does not match the route shape", async () => {
    const database = {
      boardElement: { upsert: vi.fn() },
      fileAsset: {
        findUnique: vi.fn().mockResolvedValue({ ownerId: "user-a" }),
      },
      project: {
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          workspace: { ownerId: "user-a" },
        }),
      },
    };
    const service = new BoardElementsService(database as never, {
      enqueue: vi.fn(),
    });

    await expect(
      service.bindSketchReference("user-a", "project-a", "shape:sketch", {
        fileId: "file-sketch",
        fingerprint: "a".repeat(64),
        record: {
          id: "shape:other",
          meta: {
            fashionSketch: true,
            sketchDirty: false,
            sketchFingerprint: "a".repeat(64),
            sketchStatus: "ready",
          },
          type: "frame",
          typeName: "shape",
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(database.boardElement.upsert).not.toHaveBeenCalled();
  });

  it("does not enqueue inference after a manual override", async () => {
    const enqueue = vi.fn();
    const manual = element({
      role: "avoid",
      roleInferenceState: RoleInferenceState.READY,
      roleSource: RoleSource.MANUAL,
    });
    const database = {
      boardElement: { findUnique: vi.fn().mockResolvedValue(manual) },
      fileAsset: {
        findUnique: vi.fn().mockResolvedValue({ ownerId: "user-a" }),
      },
      project: {
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          workspace: { ownerId: "user-a" },
        }),
      },
    };
    const service = new BoardElementsService(database as never, { enqueue });

    await expect(
      service.registerInference("user-a", "project-a", "shape:one", "file-1"),
    ).resolves.toMatchObject({ role: "avoid", source: "manual" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("does not reset or enqueue an already inferred role for the same file", async () => {
    const enqueue = vi.fn();
    const inferred = element({
      role: "fabric_ref",
      roleConfidence: 0.91,
      roleInferenceState: RoleInferenceState.READY,
      roleLabel: "fabric_texture",
      roleSource: RoleSource.INFERRED,
    });
    const updateMany = vi.fn();
    const upsert = vi.fn();
    const database = {
      boardElement: {
        findUnique: vi.fn().mockResolvedValue(inferred),
        updateMany,
        upsert,
      },
      fileAsset: {
        findUnique: vi.fn().mockResolvedValue({ ownerId: "user-a" }),
      },
      project: {
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          workspace: { ownerId: "user-a" },
        }),
      },
    };
    const service = new BoardElementsService(database as never, { enqueue });

    await expect(
      service.registerInference("user-a", "project-a", "shape:one", "file-1"),
    ).resolves.toMatchObject({
      role: "fabric_ref",
      source: "inferred",
      state: "ready",
    });
    expect(upsert).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("does not overwrite a manual role won during inference registration", async () => {
    const enqueue = vi.fn();
    const defaultRole = element();
    const manual = element({
      role: "avoid",
      roleInferenceState: RoleInferenceState.READY,
      roleSource: RoleSource.MANUAL,
    });
    const database = {
      boardElement: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(defaultRole)
          .mockResolvedValueOnce(manual),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn().mockResolvedValue(defaultRole),
      },
      fileAsset: {
        findUnique: vi.fn().mockResolvedValue({ ownerId: "user-a" }),
      },
      project: {
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          workspace: { ownerId: "user-a" },
        }),
      },
    };
    const service = new BoardElementsService(database as never, { enqueue });

    await expect(
      service.registerInference("user-a", "project-a", "shape:one", "file-1"),
    ).resolves.toMatchObject({ role: "avoid", source: "manual" });
    expect(enqueue).not.toHaveBeenCalled();
    expect(database.boardElement.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          fileAssetId: "file-1",
          roleInferenceState: RoleInferenceState.PENDING,
          roleSource: { not: RoleSource.MANUAL },
        }),
      }),
    );
  });
});

describe("BullVlmInferenceJobs", () => {
  it("uses one stable BullMQ jobId for duplicate file inference events", async () => {
    const queue = {
      add: vi.fn().mockResolvedValue({ id: "job-1" }),
    };
    const jobs = new BullVlmInferenceJobs();
    Object.assign(jobs, { queue });
    const data = {
      fileId: "file-1",
      projectId: "project-a",
      shapeId: "shape:one",
    };

    await jobs.enqueue(data);
    await jobs.enqueue(data);

    const firstJobId = queue.add.mock.calls[0]?.[2]?.jobId;
    const secondJobId = queue.add.mock.calls[1]?.[2]?.jobId;
    expect(firstJobId).toMatch(/^vlm-[a-f0-9]{64}$/);
    expect(secondJobId).toBe(firstJobId);
    expect(firstJobId).not.toContain(":");
  });

  it("uses a different jobId when the file generation changes", async () => {
    const queue = {
      add: vi.fn().mockResolvedValue({ id: "job-1" }),
    };
    const jobs = new BullVlmInferenceJobs();
    Object.assign(jobs, { queue });

    await jobs.enqueue({
      fileId: "file-1",
      projectId: "project-a",
      shapeId: "shape:one",
    });
    await jobs.enqueue({
      fileId: "file-2",
      projectId: "project-a",
      shapeId: "shape:one",
    });

    expect(queue.add.mock.calls[0]?.[2]?.jobId).not.toBe(
      queue.add.mock.calls[1]?.[2]?.jobId,
    );
  });
});
