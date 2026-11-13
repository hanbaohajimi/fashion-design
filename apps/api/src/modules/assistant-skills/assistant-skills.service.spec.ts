import { describe, expect, it, vi } from "vitest";

import { AssistantSkillsService } from "./assistant-skills.service";

const record = (overrides: Record<string, unknown> = {}) => ({
  id: "skill-1",
  ownerId: "user-1",
  workspaceId: null,
  scope: "PERSONAL" as const,
  requestKey: "request-1",
  fingerprint: "fingerprint",
  name: "审阅当前方案",
  description: "检查当前设计",
  prompt: "请审阅当前方案",
  createdAt: new Date("2026-11-11T00:00:00.000Z"),
  updatedAt: new Date("2026-11-11T00:00:00.000Z"),
  ...overrides,
});

function harness() {
  const database = {
    assistantSkill: {
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  } as never;
  const access = { require: vi.fn() } as never;
  const service = new AssistantSkillsService(database, access);
  return { access, database, service } as unknown as {
    access: { require: ReturnType<typeof vi.fn> };
    database: {
      assistantSkill: {
        count: ReturnType<typeof vi.fn>;
        create: ReturnType<typeof vi.fn>;
        delete: ReturnType<typeof vi.fn>;
        findMany: ReturnType<typeof vi.fn>;
        findUnique: ReturnType<typeof vi.fn>;
      };
    };
    service: AssistantSkillsService;
  };
}

describe("assistant skills service", () => {
  it("lists personal skills and skills shared by the current workspace", async () => {
    const { access, database, service } = harness();
    access.require.mockResolvedValue({ workspaceId: "workspace-1" });
    database.assistantSkill.findMany.mockResolvedValue([
      record(),
      record({ id: "skill-2", scope: "WORKSPACE", workspaceId: "workspace-1" }),
    ]);

    const result = await service.list("user-1", "project-1");

    expect(database.assistantSkill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { ownerId: "user-1", scope: "PERSONAL" },
            { scope: "WORKSPACE", workspaceId: "workspace-1" },
          ],
        },
      }),
    );
    expect(result.map((item) => item.id)).toEqual(["skill-1", "skill-2"]);
  });

  it("creates a workspace skill only with edit access and preserves idempotency", async () => {
    const { access, database, service } = harness();
    access.require.mockResolvedValue({ workspaceId: "workspace-1" });
    database.assistantSkill.findUnique.mockResolvedValue(null);
    database.assistantSkill.count.mockResolvedValue(0);
    database.assistantSkill.create.mockResolvedValue(
      record({ scope: "WORKSPACE", workspaceId: "workspace-1" }),
    );

    const result = await service.create(
      "user-1",
      "project-1",
      {
        name: "团队审阅",
        description: "共享的审阅步骤",
        prompt: "请逐项审阅当前方案",
        scope: "WORKSPACE",
      },
      "request-123",
    );

    expect(access.require).toHaveBeenCalledWith("user-1", "project-1", "edit");
    expect(database.assistantSkill.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: "user-1",
          workspaceId: "workspace-1",
          scope: "WORKSPACE",
          requestKey: "request-123",
        }),
      }),
    );
    expect(result.scope).toBe("WORKSPACE");
  });
});

