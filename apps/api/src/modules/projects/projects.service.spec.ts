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
  it("returns 403 when user A tries to update user B's project", async () => {
    const database = {
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
});
