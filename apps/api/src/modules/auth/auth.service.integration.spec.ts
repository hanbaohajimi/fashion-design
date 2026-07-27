import { prisma } from "@fashion/db";
import { afterAll, describe, expect, it } from "vitest";

import { AuthFlowError } from "./auth.errors";
import { AuthService } from "./auth.service";
import { SupabaseAuthGateway } from "./supabase-auth.gateway";

const gateway = {} as SupabaseAuthGateway;
const authService = new AuthService(gateway);

describe("AuthService local user synchronization", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates one local user and one default workspace on first login", async () => {
    const suffix = crypto.randomUUID();
    const authUserId = `auth-${suffix}`;
    const email = `auth-${suffix}@example.com`;
    const previousDefaultLimit = process.env.DEFAULT_GEN_LIMIT;
    process.env.DEFAULT_GEN_LIMIT = "137";

    const user = await authService.syncLocalUser({
      authUserId,
      email,
      name: "Pattern Designer",
    });

    try {
      const stored = await prisma.user.findUnique({
        where: { authId: authUserId },
        include: { ownedWorkspaces: true },
      });

      expect(stored).toMatchObject({
        authId: authUserId,
        email,
        generationCount: 0,
        generationLimit: 137,
        name: "Pattern Designer",
      });
      expect(stored?.ownedWorkspaces).toHaveLength(1);
      expect(stored?.ownedWorkspaces[0]?.name).toBe("我的工作区");

      const secondSync = await authService.syncLocalUser({
        authUserId,
        email,
        name: "Pattern Designer",
      });
      const workspaceCount = await prisma.workspace.count({
        where: { ownerId: user.id },
      });

      expect(secondSync.id).toBe(user.id);
      expect(workspaceCount).toBe(1);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
      if (previousDefaultLimit === undefined) {
        delete process.env.DEFAULT_GEN_LIMIT;
      } else {
        process.env.DEFAULT_GEN_LIMIT = previousDefaultLimit;
      }
    }
  });

  it("rejects a valid external identity when the local user is soft-deleted", async () => {
    const suffix = crypto.randomUUID();
    const localUser = await prisma.user.create({
      data: {
        authId: `deleted-auth-${suffix}`,
        deletedAt: new Date(),
        email: `deleted-${suffix}@example.com`,
      },
    });

    try {
      await expect(
        authService.syncLocalUser({
          authUserId: localUser.authId ?? "",
          email: localUser.email,
        }),
      ).rejects.toEqual(
        new AuthFlowError("ACCOUNT_DELETED", "该账户已被删除，无法继续登录。"),
      );
    } finally {
      await prisma.user.delete({ where: { id: localUser.id } });
    }
  });
});
