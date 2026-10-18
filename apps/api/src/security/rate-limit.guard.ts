import {
  type CanActivate,
  BadRequestException,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  SetMetadata,
  type OnModuleDestroy,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Response } from "express";
import Redis from "ioredis";
import { createHash } from "node:crypto";

import type { AuthenticatedRequest } from "../modules/auth/auth.types";
import { loginRequestSchema } from "../modules/auth/auth-request.schema";
import { REFRESH_TOKEN_COOKIE } from "../modules/auth/auth.constants";

const RATE_LIMIT_METADATA = "fashion:rate-limit";
const RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("TTL", KEYS[1])
return { current, ttl }
`;

export const RATE_LIMIT_STORE = Symbol("RATE_LIMIT_STORE");

export interface RateLimitPolicy {
  readonly name: string;
  readonly limit: number;
  readonly windowSeconds: number;
  readonly keyBy: "login" | "user";
  readonly limitEnv?: string;
}

export interface RateLimitResult {
  readonly count: number;
  readonly retryAfterSeconds: number;
}

export interface RateLimitStore {
  consume(
    bucket: string,
    windowSeconds: number,
  ): Promise<RateLimitResult>;
}

export const RateLimit = (policy: RateLimitPolicy) =>
  SetMetadata(RATE_LIMIT_METADATA, policy);

@Injectable()
export class RedisRateLimitStore
  implements RateLimitStore, OnModuleDestroy
{
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis(
      process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
      {
        enableOfflineQueue: false,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      },
    );
    this.redis.on("error", () => undefined);
  }

  async consume(
    bucket: string,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    if (this.redis.status === "wait") {
      await this.redis.connect();
    }
    const response = await this.redis.eval(
      RATE_LIMIT_SCRIPT,
      1,
      bucket,
      windowSeconds,
    );
    if (
      !Array.isArray(response) ||
      typeof response[0] !== "number" ||
      typeof response[1] !== "number"
    ) {
      throw new Error("Redis 限流响应无效");
    }
    return {
      count: response[0],
      retryAfterSeconds: Math.max(response[1], 1),
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status !== "end") {
      this.redis.disconnect();
    }
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<RateLimitPolicy>(
      RATE_LIMIT_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!policy) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    const rules = policy.keyBy === "login" ? this.loginRules(request) : [{
      name: policy.name, identity: this.resolveIdentity(policy, request),
      limit: this.configuredLimit(policy), windowSeconds: policy.windowSeconds,
    }];
    for (const rule of rules) {
      let result: RateLimitResult;
      try { result = await this.store.consume(this.bucket(rule.name, rule.identity), rule.windowSeconds); }
      catch (error) {
        throw new ServiceUnavailableException({ code: "RATE_LIMIT_UNAVAILABLE", message: "请求保护服务暂时不可用，请稍后重试" }, { cause: error });
      }
    if (result.count > rule.limit) {
      response.setHeader(
        "Retry-After",
        String(Math.max(result.retryAfterSeconds, 1)),
      );
      throw new HttpException(
        {
          code: "RATE_LIMITED",
          message: "请求过于频繁，请稍后重试",
        },
        429,
      );
    }
    }
    return true;
  }

  private configuredLimit(policy: RateLimitPolicy): number {
    const value = policy.limitEnv ? process.env[policy.limitEnv] : undefined;
    if (value === undefined || value.trim() === "") return policy.limit;
    const limit = Number(value);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new ServiceUnavailableException({ code: "RATE_LIMIT_CONFIGURATION_ERROR", message: "请求保护配置无效" });
    return limit;
  }

  private loginRules(request: AuthenticatedRequest) {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestException({ code: "INVALID_REQUEST", message: "登录请求格式不正确。" });
    const ip = request.ip ?? request.socket.remoteAddress ?? "unknown";
    const input = parsed.data;
    if (input.action === "send") return [
      { name: "auth-send-email", identity: input.email, limit: 5, windowSeconds: 60 },
      { name: "auth-send-ip", identity: ip, limit: 20, windowSeconds: 60 },
    ];
    if (input.action === "verify") return [
      { name: "auth-verify-ip", identity: ip, limit: 20, windowSeconds: 60 },
      { name: "auth-verify-token", identity: input.tokenHash, limit: 5, windowSeconds: 60 },
    ];
    const token = request.cookies?.[REFRESH_TOKEN_COOKIE] as unknown;
    // The bucket helper hashes this value; neither the cookie nor the raw identity is stored or logged.
    return [{ name: "auth-refresh", identity: typeof token === "string" && token ? token : `missing:${ip}`, limit: 30, windowSeconds: 60 }];
  }

  private resolveIdentity(
    policy: RateLimitPolicy,
    request: AuthenticatedRequest,
  ): string {
    if (policy.keyBy === "user") {
      if (!request.auth?.userId) {
        throw new ServiceUnavailableException({
          code: "RATE_LIMIT_IDENTITY_UNAVAILABLE",
          message: "无法确认请求身份，请重新登录",
        });
      }
      return request.auth.userId;
    }

    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
    if (typeof body.email === "string") {
      return `email:${body.email.trim().toLowerCase()}`;
    }
    if (typeof body.tokenHash === "string") {
      return `token:${body.tokenHash}`;
    }
    return `ip:${request.socket.remoteAddress ?? "unknown"}`;
  }

  private bucket(policyName: string, identity: string): string {
    const digest = createHash("sha256")
      .update(`${policyName}\0${identity}`)
      .digest("hex");
    return `rate-limit:${policyName}:${digest}`;
  }
}
