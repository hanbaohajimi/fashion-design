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
const REDIS_READY_TIMEOUT_MS = 1_500;
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
  readonly ipLimit?: number;
  readonly windowSeconds: number;
  readonly keyBy: "login" | "user" | "publicShare";
  readonly limitEnv?: string;
}

interface RateLimitRule {
  readonly name: string;
  readonly identity: string;
  readonly limit: number;
  readonly windowSeconds: number;
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
        connectTimeout: REDIS_READY_TIMEOUT_MS,
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
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.ensureReady();
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
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          // A first request can race Redis reconnecting. Force a fresh connection
          // once, then let the guard fail closed if the dependency remains down.
          if (this.redis.status !== "end") this.redis.disconnect();
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Redis 限流服务不可用");
  }

  private async ensureReady(): Promise<void> {
    if (this.redis.status === "wait" || this.redis.status === "end") {
      await this.redis.connect();
      return;
    }
    if (this.redis.status === "ready") return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Redis 限流服务连接超时"));
      }, REDIS_READY_TIMEOUT_MS);
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        clearTimeout(timeout);
        this.redis.off("ready", onReady);
        this.redis.off("error", onError);
      };
      this.redis.once("ready", onReady);
      this.redis.once("error", onError);
    });
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
    const rules =
      policy.keyBy === "login"
        ? this.loginRules(request)
        : policy.keyBy === "publicShare"
          ? this.publicShareRules(policy, request)
          : [{
              name: policy.name,
              identity: this.resolveIdentity(policy, request),
              limit: this.configuredLimit(policy),
              windowSeconds: policy.windowSeconds,
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

  private publicShareRules(
    policy: RateLimitPolicy,
    request: AuthenticatedRequest,
  ): RateLimitRule[] {
    const token = (request.params as Record<string, unknown> | undefined)?.token;
    if (typeof token !== "string" || !token) {
      throw new BadRequestException({
        code: "RATE_LIMIT_IDENTITY_UNAVAILABLE",
        message: "无法确认公开评审链接",
      });
    }
    const ip = request.ip ?? request.socket.remoteAddress ?? "unknown";
    const ipLimit = policy.ipLimit ?? policy.limit;
    if (!Number.isSafeInteger(ipLimit) || ipLimit < 1) {
      throw new ServiceUnavailableException({
        code: "RATE_LIMIT_CONFIGURATION_ERROR",
        message: "请求保护配置无效",
      });
    }
    return [
      {
        name: policy.name + ":share",
        identity: token,
        limit: this.configuredLimit(policy),
        windowSeconds: policy.windowSeconds,
      },
      {
        name: policy.name + ":ip",
        identity: ip,
        limit: ipLimit,
        windowSeconds: policy.windowSeconds,
      },
    ];
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
