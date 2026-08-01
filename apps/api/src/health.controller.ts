import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@fashion/db";
import type { HealthResponse } from "@fashion/shared";
import {
  Controller,
  Get,
  Inject,
  Injectable,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import Redis from "ioredis";

import { Public } from "./modules/auth/public.decorator";

const HEALTH_CHECK_TIMEOUT_MS = 2_000;
const HEALTH_CHECK_CACHE_MS = 1_000;

export const HEALTH_DEPENDENCY_CHECKER = Symbol("HEALTH_DEPENDENCY_CHECKER");

export interface ReadinessChecks {
  readonly database: "up" | "down";
  readonly redis: "up" | "down";
  readonly objectStorage: "up" | "down";
}

export interface HealthDependencyChecker {
  check(): Promise<ReadinessChecks>;
}

interface ReadinessResponse {
  readonly ok: boolean;
  readonly ts: string;
  readonly checks: ReadinessChecks;
}

interface ActiveProbe {
  readonly controller: AbortController;
  readonly promise: Promise<void>;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少健康检查配置 ${name}`);
  }
  return value;
}

async function runAbortableProbe(
  operation: (signal: AbortSignal) => Promise<void>,
  controller: AbortController,
): Promise<void> {
  const { signal } = controller;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("健康检查已中止"),
      );
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const timeout = setTimeout(() => {
    controller.abort(new Error("健康检查超时"));
  }, HEALTH_CHECK_TIMEOUT_MS);
  try {
    await Promise.race([
      Promise.resolve().then(() => operation(signal)),
      aborted,
    ]);
  } finally {
    clearTimeout(timeout);
    if (onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

@Injectable()
export class InfrastructureHealthChecker
  implements HealthDependencyChecker, OnModuleDestroy
{
  private readonly redis = new Redis(
    process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    {
      enableOfflineQueue: false,
      lazyConnect: true,
      commandTimeout: HEALTH_CHECK_TIMEOUT_MS,
      connectTimeout: HEALTH_CHECK_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
    },
  );
  private readonly activeProbes = new Map<string, ActiveProbe>();
  private cached:
    | {
        readonly checks: ReadinessChecks;
        readonly expiresAt: number;
      }
    | undefined;
  private inFlight: Promise<ReadinessChecks> | undefined;
  private s3: S3Client | undefined;
  private destroyed = false;

  constructor() {
    this.redis.on("error", () => undefined);
  }

  async check(): Promise<ReadinessChecks> {
    if (this.destroyed) {
      return { database: "down", redis: "down", objectStorage: "down" };
    }
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.checks;
    }
    if (this.inFlight) {
      return this.inFlight;
    }

    const inFlight = this.runChecks()
      .then((checks) => {
        if (!this.destroyed) {
          this.cached = {
            checks,
            expiresAt: Date.now() + HEALTH_CHECK_CACHE_MS,
          };
        }
        return checks;
      })
      .finally(() => {
        if (this.inFlight === inFlight) {
          this.inFlight = undefined;
        }
      });
    this.inFlight = inFlight;
    return inFlight;
  }

  private async runChecks(): Promise<ReadinessChecks> {
    const [database, redis, objectStorage] = await Promise.all([
      this.probe("database", async (signal) => {
        signal.throwIfAborted();
        await prisma.$transaction(
          async (transaction) => {
            signal.throwIfAborted();
            await transaction.$queryRaw`SELECT 1`;
            signal.throwIfAborted();
          },
          {
            maxWait: HEALTH_CHECK_TIMEOUT_MS,
            timeout: HEALTH_CHECK_TIMEOUT_MS,
          },
        );
      }),
      this.probe("redis", async (signal) => {
        const disconnectOnAbort = () => {
          this.redis.disconnect();
        };
        signal.addEventListener("abort", disconnectOnAbort, { once: true });
        try {
          signal.throwIfAborted();
          if (this.redis.status === "wait" || this.redis.status === "end") {
            await this.redis.connect();
          }
          await this.redis.ping();
          signal.throwIfAborted();
        } finally {
          signal.removeEventListener("abort", disconnectOnAbort);
        }
      }),
      this.probe("object-storage", async (signal) => {
        await this.getS3().send(
          new HeadObjectCommand({
            Bucket: requiredEnvironment("S3_BUCKET"),
            Key: requiredEnvironment("S3_HEALTHCHECK_OBJECT_KEY"),
          }),
          { abortSignal: signal },
        );
      }),
    ]);

    return { database, redis, objectStorage };
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    const active = [...this.activeProbes.values()];
    for (const probe of active) {
      probe.controller.abort(new Error("健康检查服务正在停止"));
    }
    await Promise.allSettled(active.map((probe) => probe.promise));
    if (this.redis.status !== "end") {
      this.redis.disconnect();
    }
    this.s3?.destroy();
  }

  private async probe(
    name: string,
    operation: (signal: AbortSignal) => Promise<void>,
  ): Promise<"up" | "down"> {
    let activeProbe = this.activeProbes.get(name);
    if (!activeProbe) {
      const controller = new AbortController();
      const promise = runAbortableProbe(operation, controller).finally(() => {
        if (this.activeProbes.get(name)?.promise === promise) {
          this.activeProbes.delete(name);
        }
      });
      activeProbe = { controller, promise };
      this.activeProbes.set(name, activeProbe);
    }

    try {
      await activeProbe.promise;
      return "up";
    } catch {
      return "down";
    }
  }

  private getS3(): S3Client {
    if (!this.s3) {
      const endpoint = process.env.S3_ENDPOINT?.trim();
      this.s3 = new S3Client({
        credentials: {
          accessKeyId: requiredEnvironment("S3_ACCESS_KEY_ID"),
          secretAccessKey: requiredEnvironment("S3_SECRET_ACCESS_KEY"),
        },
        ...(endpoint ? { endpoint } : {}),
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
        region: process.env.S3_REGION?.trim() || "auto",
      });
    }
    return this.s3;
  }
}

@Controller("health")
export class HealthController {
  constructor(
    @Inject(HEALTH_DEPENDENCY_CHECKER)
    private readonly dependencyChecker: HealthDependencyChecker,
  ) {}

  @Public()
  @Get()
  getHealth(): HealthResponse {
    return this.getLiveness();
  }

  @Public()
  @Get("live")
  getLiveness(): HealthResponse {
    return {
      ok: true,
      ts: new Date().toISOString(),
    };
  }

  @Public()
  @Get("ready")
  async getReadiness(): Promise<ReadinessResponse> {
    const checks = await this.dependencyChecker.check();
    const response: ReadinessResponse = {
      ok: Object.values(checks).every((status) => status === "up"),
      ts: new Date().toISOString(),
      checks,
    };
    if (!response.ok) {
      throw new ServiceUnavailableException(response);
    }
    return response;
  }
}
