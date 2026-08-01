import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppModule } from "./app.module";
import {
  HEALTH_DEPENDENCY_CHECKER,
  type HealthDependencyChecker,
  InfrastructureHealthChecker,
  type ReadinessChecks,
} from "./health.controller";

describe("health endpoints", () => {
  let app: INestApplication;
  let check: ReturnType<typeof vi.fn<HealthDependencyChecker["check"]>>;

  beforeEach(async () => {
    check = vi.fn<HealthDependencyChecker["check"]>();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(HEALTH_DEPENDENCY_CHECKER)
      .useValue({ check })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns the service health with an ISO timestamp", async () => {
    const response = await request(app.getHttpServer())
      .get("/health")
      .expect(200);

    expect(response.body).toEqual({
      ok: true,
      ts: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(response.body.ts))).toBe(false);
  });

  it("keeps a dedicated liveness endpoint independent of infrastructure", async () => {
    const response = await request(app.getHttpServer())
      .get("/health/live")
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(check).not.toHaveBeenCalled();
  });

  it("reports ready only when every dependency is available", async () => {
    const checks: ReadinessChecks = {
      database: "up",
      redis: "up",
      objectStorage: "up",
    };
    check.mockResolvedValue(checks);

    const response = await request(app.getHttpServer())
      .get("/health/ready")
      .expect(200);

    expect(response.body).toEqual({
      ok: true,
      ts: expect.any(String),
      checks,
    });
  });

  it("returns 503 and the failed dependency when the service is not ready", async () => {
    const checks: ReadinessChecks = {
      database: "up",
      redis: "down",
      objectStorage: "up",
    };
    check.mockResolvedValue(checks);

    const response = await request(app.getHttpServer())
      .get("/health/ready")
      .expect(503);

    expect(response.body).toEqual(
      expect.objectContaining({
        ok: false,
        checks,
      }),
    );
  });

  it("checks the real local database, Redis, and private S3 sentinel", async () => {
    const checker = new InfrastructureHealthChecker();
    try {
      await expect(
        Promise.all([checker.check(), checker.check()]),
      ).resolves.toEqual([
        {
          database: "up",
          redis: "up",
          objectStorage: "up",
        },
        {
          database: "up",
          redis: "up",
          objectStorage: "up",
        },
      ]);
    } finally {
      await checker.onModuleDestroy();
    }
  });

  it("模块销毁会中止仍在执行的底层 readiness 探针", async () => {
    const checker = new InfrastructureHealthChecker();
    let observedSignal: AbortSignal | undefined;
    const internal = checker as unknown as {
      probe(
        name: string,
        operation: (signal: AbortSignal) => Promise<void>,
      ): Promise<"up" | "down">;
    };
    const pending = internal.probe("cancellable-test", async (signal) => {
      observedSignal = signal;
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    });

    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    await checker.onModuleDestroy();

    await expect(pending).resolves.toBe("down");
    expect(observedSignal?.aborted).toBe(true);
  });

  it("readiness 超时会主动 abort 底层探针而不是仅停止等待", async () => {
    const checker = new InfrastructureHealthChecker();
    let observedSignal: AbortSignal | undefined;
    const internal = checker as unknown as {
      probe(
        name: string,
        operation: (signal: AbortSignal) => Promise<void>,
      ): Promise<"up" | "down">;
    };
    try {
      const result = await internal.probe("timeout-test", async (signal) => {
        observedSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      });

      expect(result).toBe("down");
      expect(observedSignal?.aborted).toBe(true);
      expect((observedSignal?.reason as Error | undefined)?.message).toBe(
        "健康检查超时",
      );
    } finally {
      await checker.onModuleDestroy();
    }
  }, 5_000);
});
