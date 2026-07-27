import {
  RoleInferenceState,
  RoleSource,
} from "@fashion/db";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { BoardElementsService } from "./board-elements.service";

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
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue(fallback),
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
      service.registerInference(
        "user-a",
        "project-a",
        "shape:one",
        "file-1",
      ),
    ).resolves.toMatchObject({
      role: "style_ref",
      source: "default",
      state: "failed",
    });
  });

  it("batch-upserts every selected role as a manual override", async () => {
    const upsert = vi
      .fn()
      .mockImplementation(({ where }) =>
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
      service.registerInference(
        "user-a",
        "project-a",
        "shape:one",
        "file-1",
      ),
    ).resolves.toMatchObject({ role: "avoid", source: "manual" });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
