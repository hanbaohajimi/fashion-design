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
});
