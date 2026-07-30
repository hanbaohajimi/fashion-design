import { prisma, type User } from "@fashion/db";
import { Inject, Injectable } from "@nestjs/common";
import type { User as SupabaseUser } from "@supabase/supabase-js";

import {
  DEFAULT_PROJECT_NAME,
  DEFAULT_WORKSPACE_NAME,
} from "./auth.constants";
import { AuthFlowError } from "./auth.errors";
import type {
  AuthSession,
  AuthenticatedUser,
  VerifiedIdentity,
} from "./auth.types";
import { SupabaseAuthGateway } from "./supabase-auth.gateway";
import { resolveDefaultGenerationLimit } from "../billing/billing.config";

@Injectable()
export class AuthService {
  constructor(
    @Inject(SupabaseAuthGateway)
    private readonly supabase: SupabaseAuthGateway,
  ) {}

  async sendMagicLink(email: string): Promise<void> {
    await this.supabase.sendMagicLink(email, this.getConfirmUrl());
  }

  async verifyMagicLink(tokenHash: string): Promise<AuthSession> {
    const session = await this.supabase.verifyMagicLink(tokenHash);
    const user = await this.syncLocalUser(this.toIdentity(session.user));

    return {
      ...session,
      user,
    };
  }

  async refreshSession(refreshToken: string): Promise<AuthSession> {
    const session = await this.supabase.refreshSession(refreshToken);
    const user = await this.syncLocalUser(this.toIdentity(session.user));

    return {
      ...session,
      user,
    };
  }

  async authenticate(accessToken: string): Promise<AuthenticatedUser> {
    const identity = this.toIdentity(
      await this.supabase.verifyAccessToken(accessToken),
    );
    const user = await this.syncLocalUser(identity);

    return {
      authUserId: identity.authUserId,
      email: user.email,
      userId: user.id,
    };
  }

  async getUser(userId: string): Promise<User> {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user || user.deletedAt) {
      throw new AuthFlowError(
        "ACCOUNT_DELETED",
        "该账户已被删除，无法继续访问。",
      );
    }

    return user;
  }

  async getInitialProjectId(userId: string): Promise<string | undefined> {
    const project = await prisma.project.findFirst({
      where: {
        deletedAt: null,
        workspace: { ownerId: userId },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    return project?.id;
  }

  assertAllowedOrigin(origin: string | undefined): void {
    const allowedOrigin = this.getAppOrigin();

    if (!origin || origin !== allowedOrigin) {
      throw new AuthFlowError(
        "INVALID_ORIGIN",
        "请求来源无效，请刷新页面后重试。",
      );
    }
  }

  async syncLocalUser(identity: VerifiedIdentity): Promise<User> {
    const existingByAuthId = await prisma.user.findUnique({
      where: { authId: identity.authUserId },
    });

    if (existingByAuthId?.deletedAt) {
      throw new AuthFlowError(
        "ACCOUNT_DELETED",
        "该账户已被删除，无法继续登录。",
      );
    }

    if (existingByAuthId) {
      return prisma.user.update({
        where: { id: existingByAuthId.id },
        data: {
          email: identity.email,
          ...(identity.avatar ? { avatar: identity.avatar } : {}),
          ...(identity.name ? { name: identity.name } : {}),
        },
      });
    }

    const existingByEmail = await prisma.user.findUnique({
      where: { email: identity.email },
    });

    if (existingByEmail?.deletedAt) {
      throw new AuthFlowError(
        "ACCOUNT_DELETED",
        "该账户已被删除，无法继续登录。",
      );
    }

    if (existingByEmail) {
      const user = await prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          authId: identity.authUserId,
          ...(identity.avatar ? { avatar: identity.avatar } : {}),
          ...(identity.name ? { name: identity.name } : {}),
        },
      });
      const workspaceCount = await prisma.workspace.count({
        where: { ownerId: user.id },
      });

      if (workspaceCount === 0) {
        await prisma.workspace.create({
          data: {
            name: DEFAULT_WORKSPACE_NAME,
            ownerId: user.id,
            projects: {
              create: { name: DEFAULT_PROJECT_NAME },
            },
          },
        });
      }

      return user;
    }

    return prisma.user.create({
      data: {
        authId: identity.authUserId,
        email: identity.email,
        generationLimit: resolveDefaultGenerationLimit(),
        ...(identity.avatar ? { avatar: identity.avatar } : {}),
        ...(identity.name ? { name: identity.name } : {}),
        ownedWorkspaces: {
          create: {
            name: DEFAULT_WORKSPACE_NAME,
            projects: {
              create: { name: DEFAULT_PROJECT_NAME },
            },
          },
        },
      },
    });
  }

  private getAppOrigin(): string {
    const appOrigin = process.env.APP_ORIGIN;

    if (!appOrigin) {
      throw new AuthFlowError(
        "AUTH_CONFIGURATION_ERROR",
        "APP_ORIGIN 未配置，认证回调无法安全运行。",
      );
    }

    return appOrigin.replace(/\/$/u, "");
  }

  private getConfirmUrl(): string {
    return `${this.getAppOrigin()}/auth/confirm`;
  }

  private toIdentity(user: SupabaseUser): VerifiedIdentity {
    if (!user.email) {
      throw new AuthFlowError(
        "INVALID_TOKEN",
        "登录凭证缺少邮箱信息，请重新登录。",
      );
    }

    const name = this.readMetadataString(user.user_metadata, [
      "name",
      "full_name",
    ]);
    const avatar = this.readMetadataString(user.user_metadata, [
      "avatar_url",
      "picture",
    ]);

    return {
      authUserId: user.id,
      email: user.email.toLowerCase(),
      ...(name ? { name } : {}),
      ...(avatar ? { avatar } : {}),
    };
  }

  private readMetadataString(
    metadata: Record<string, unknown>,
    keys: readonly string[],
  ): string | undefined {
    for (const key of keys) {
      const value = metadata[key];

      if (typeof value === "string" && value.trim()) {
        return value.trim().slice(0, 500);
      }
    }

    return undefined;
  }
}
