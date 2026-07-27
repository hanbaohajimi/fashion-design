import { type ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";

import { AuthFlowError } from "./auth.errors";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";

function createContext(cookies: Record<string, string>): ExecutionContext {
  return {
    getClass: vi.fn(),
    getHandler: vi.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ cookies }),
    }),
  } as unknown as ExecutionContext;
}

function createGuard(authenticate: ReturnType<typeof vi.fn>): AuthGuard {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(false),
  } as unknown as Reflector;
  const authService = {
    authenticate,
  } as unknown as AuthService;

  return new AuthGuard(reflector, authService);
}

describe("AuthGuard", () => {
  it("rejects a request without an access token", async () => {
    const guard = createGuard(vi.fn());

    await expect(guard.canActivate(createContext({}))).rejects.toMatchObject({
      response: {
        code: "INVALID_TOKEN",
      },
      status: 401,
    });
  });

  it("maps an expired token to a readable 401 response", async () => {
    const guard = createGuard(
      vi
        .fn()
        .mockRejectedValue(
          new AuthFlowError("TOKEN_EXPIRED", "登录已过期，请重新登录。"),
        ),
    );

    await expect(
      guard.canActivate(
        createContext({ fashion_access_token: "expired-token" }),
      ),
    ).rejects.toMatchObject({
      response: {
        code: "TOKEN_EXPIRED",
      },
      status: 401,
    });
  });

  it("maps an invalid token to a readable 401 response", async () => {
    const guard = createGuard(
      vi
        .fn()
        .mockRejectedValue(
          new AuthFlowError("INVALID_TOKEN", "登录凭证无效，请重新登录。"),
        ),
    );

    await expect(
      guard.canActivate(
        createContext({ fashion_access_token: "invalid-token" }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("injects the authenticated local user into the request", async () => {
    const identity = {
      authUserId: "supabase-user",
      email: "designer@example.com",
      userId: "local-user",
    };
    const request = {
      cookies: { fashion_access_token: "valid-token" },
    };
    const context = {
      getClass: vi.fn(),
      getHandler: vi.fn(),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
    const guard = createGuard(vi.fn().mockResolvedValue(identity));

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request).toMatchObject({ auth: identity });
  });
});
