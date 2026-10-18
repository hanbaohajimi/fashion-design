import { HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import {
  RateLimitGuard,
  type RateLimitPolicy,
  type RateLimitStore,
} from "./rate-limit.guard";

describe("RateLimitGuard", () => {
  it("校验动作后选桶，额外 email 不能改变 refresh 限流身份", async () => {
    const consume = vi.fn().mockResolvedValue({ count: 1, retryAfterSeconds: 60 });
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue({ keyBy: "login", name: "login", limit: 5, windowSeconds: 60 }) };
    const request = { body: { action: "refresh", email: "bypass@example.com" }, cookies: { fashion_refresh_token: "secret-a" }, socket: { remoteAddress: "127.0.0.1" } };
    const context = { getClass: () => class {}, getHandler: () => function login() {}, switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ setHeader: vi.fn() }) }) } as unknown as ExecutionContext;
    const guard = new RateLimitGuard(reflector as unknown as Reflector, { consume });
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 400 });
    expect(consume).not.toHaveBeenCalled();
  });

  it("同代理下不同刷新凭证使用不同摘要桶，不存储原始凭证", async () => {
    const consume = vi.fn().mockResolvedValue({ count: 1, retryAfterSeconds: 60 });
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue({ keyBy: "login", name: "login", limit: 5, windowSeconds: 60 }) };
    const request = { body: { action: "refresh" }, cookies: { fashion_refresh_token: "secret-a" }, socket: { remoteAddress: "127.0.0.1" } };
    const context = { getClass: () => class {}, getHandler: () => function login() {}, switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ setHeader: vi.fn() }) }) } as unknown as ExecutionContext;
    const guard = new RateLimitGuard(reflector as unknown as Reflector, { consume });
    await guard.canActivate(context);
    request.cookies.fashion_refresh_token = "secret-b";
    await guard.canActivate(context);
    expect(consume.mock.calls[0]?.[0]).not.toBe(consume.mock.calls[1]?.[0]);
    expect(JSON.stringify(consume.mock.calls)).not.toContain("secret-");
  });
  it("生成接口第 21 次返回 429、Retry-After 且不暴露 Redis key", async () => {
    let count = 0;
    const store: RateLimitStore = {
      consume: vi.fn(async () => ({
        count: ++count,
        retryAfterSeconds: 3550,
      })),
    };
    const policy: RateLimitPolicy = {
      keyBy: "user",
      limit: 20,
      name: "generation-create",
      windowSeconds: 3600,
    };
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(policy),
    };
    const response = { setHeader: vi.fn() };
    const context = {
      getClass: () => class GenerationController {},
      getHandler: () => function create() {},
      switchToHttp: () => ({
        getRequest: () => ({
          auth: { userId: "user-a" },
          body: {},
          socket: { remoteAddress: "127.0.0.1" },
        }),
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    const guard = new RateLimitGuard(reflector as unknown as Reflector, store);

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }
    const failure = await guard.canActivate(context).catch((error) => error);

    expect(failure).toBeInstanceOf(HttpException);
    expect((failure as HttpException).getStatus()).toBe(429);
    expect((failure as HttpException).getResponse()).toEqual({
      code: "RATE_LIMITED",
      message: "请求过于频繁，请稍后重试",
    });
    expect(JSON.stringify((failure as HttpException).getResponse())).not.toContain(
      "rate-limit:",
    );
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "3550");
  });

  it("登录策略第 6 次拒绝", async () => {
    const counts = new Map<string, number>();
    const store: RateLimitStore = {
      consume: vi.fn(async (bucket) => {
        const count = (counts.get(bucket) ?? 0) + 1;
        counts.set(bucket, count);
        return { count, retryAfterSeconds: 42 };
      }),
    };
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue({
        keyBy: "login",
        limit: 5,
        name: "auth-login",
        windowSeconds: 60,
      } satisfies RateLimitPolicy),
    };
    const context = {
      getClass: () => class AuthController {},
      getHandler: () => function login() {},
      switchToHttp: () => ({
        getRequest: () => ({
          body: { action: "send", email: "designer@example.com" },
          socket: { remoteAddress: "127.0.0.1" },
        }),
        getResponse: () => ({ setHeader: vi.fn() }),
      }),
    } as unknown as ExecutionContext;
    const guard = new RateLimitGuard(
      reflector as unknown as Reflector,
      store,
    );

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 429,
    });
  });
});
