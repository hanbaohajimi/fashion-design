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

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少健康检查配置 ${name}`);
  }
  return value;
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
  private readonly activeProbes = new Map<string, Promise<void>>();
  private cached:
    | {
        readonly checks: ReadinessChecks;
        readonly expiresAt: number;
      }
    | undefined;
  private inFlight: Promise<ReadinessChecks> | undefined;
  private s3: S3Client | undefined;

  constructor() {
    this.redis.on("error", () => undefined);
  }

  async check(): Promise<ReadinessChecks> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.checks;
    }
    if (this.inFlight) {
      return this.inFlight;
    }

    const inFlight = this.runChecks()
      .then((checks) => {
        this.cached = {
          checks,
          expiresAt: Date.now() + HEALTH_CHECK_CACHE_MS,
        };
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
      this.probe("database", async () => {
        await prisma.$queryRaw`SELECT 1`;
      }),
      this.probe("redis", async () => {
        if (this.redis.status === "wait") {
          await this.redis.connect();
        }
        await this.redis.ping();
      }),
      this.probe("object-storage", async () => {
        await this.getS3().send(
          new HeadObjectCommand({
            Bucket: requiredEnvironment("S3_BUCKET"),
            Key: requiredEnvironment("S3_HEALTHCHECK_OBJECT_KEY"),
          }),
          { abortSignal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS) },
        );
      }),
    ]);

    return { database, redis, objectStorage };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status !== "end") {
      this.redis.disconnect();
    }
    this.s3?.destroy();
  }

  private async probe(
    name: string,
    operation: () => Promise<void>,
  ): Promise<"up" | "down"> {
    let active = this.activeProbes.get(name);
    if (!active) {
      const pending = operation();
      active = pending.finally(() => {
        if (this.activeProbes.get(name) === active) {
          this.activeProbes.delete(name);
        }
      });
      this.activeProbes.set(name, active);
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        active,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("健康检查超时")),
            HEALTH_CHECK_TIMEOUT_MS,
          );
        }),
      ]);
      return "up";
    } catch {
      return "down";
    } finally {
      if (timeout) clearTimeout(timeout);
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
