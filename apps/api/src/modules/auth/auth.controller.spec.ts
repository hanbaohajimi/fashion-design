import { AccountPlan, type User } from "@fashion/db";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { AppModule } from "../../app.module";
import { BillingService } from "../billing/billing.service";
import { AuthService } from "./auth.service";
import { AUDIT_DB } from "../../security/audit.interceptor";
import { RATE_LIMIT_STORE } from "../../security/rate-limit.guard";

const user: User = {
  id: "cm1234567890123456789012",
  authId: "supabase-user-id",
  avatar: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  deletedAt: null,
  email: "designer@example.com",
  generationCount: 12,
  generationLimit: 100,
  name: "Designer",
  plan: AccountPlan.FREE,
};

describe("authentication HTTP contract", () => {
  let app: INestApplication;
  const authService = {
    assertAllowedOrigin: vi.fn(),
    authenticate: vi.fn(),
    getUser: vi.fn(),
    getInitialProjectId: vi.fn(),
    refreshSession: vi.fn(),
    sendMagicLink: vi.fn(),
    verifyMagicLink: vi.fn(),
  };
  const billingService = {
    canGenerate: vi.fn(),
  };

  beforeAll(async () => {
    process.env.APP_ORIGIN = "http://localhost:3000";
    process.env.SESSION_COOKIE_SECURE = "false";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthService)
      .useValue(authService)
      .overrideProvider(BillingService)
      .useValue(billingService)
      .overrideProvider(RATE_LIMIT_STORE)
      .useValue({
        consume: vi.fn().mockResolvedValue({
          count: 1,
          retryAfterSeconds: 60,
        }),
      })
      .overrideProvider(AUDIT_DB)
      .useValue({
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authService.assertAllowedOrigin.mockImplementation(() => undefined);
    billingService.canGenerate.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 88,
      used: 12,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 401 for GET /me without a session", async () => {
    const response = await request(app.getHttpServer()).get("/me").expect(401);

    expect(response.body).toMatchObject({
      code: "INVALID_TOKEN",
    });
  });

  it("returns the local user and credits after authentication", async () => {
    authService.authenticate.mockResolvedValue({
      authUserId: "supabase-user-id",
      email: user.email,
      userId: user.id,
    });
    authService.getUser.mockResolvedValue(user);

    const response = await request(app.getHttpServer())
      .get("/me")
      .set("Cookie", "fashion_access_token=valid-token")
      .expect(200);

    expect(response.body).toMatchObject({
      credits: {
        limit: 100,
        remaining: 88,
        used: 12,
      },
      user: {
        email: user.email,
        id: user.id,
      },
    });
  });

  it("verifies a magic link and writes both tokens as HttpOnly cookies", async () => {
    authService.verifyMagicLink.mockResolvedValue({
      accessToken: "access-token-value",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      refreshToken: "refresh-token-value",
      user,
    });
    authService.getInitialProjectId.mockResolvedValue("project-first");

    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .set("Origin", "http://localhost:3000")
      .send({
        action: "verify",
        tokenHash: "a".repeat(64),
      })
      .expect(200);

    const cookies = response.headers["set-cookie"] as unknown as string[];
    expect(cookies).toHaveLength(2);
    expect(cookies.join("\n")).toContain("fashion_access_token=");
    expect(cookies.join("\n")).toContain("fashion_refresh_token=");
    expect(cookies.every((cookie) => cookie.includes("HttpOnly"))).toBe(true);
    expect(cookies.every((cookie) => cookie.includes("SameSite=Lax"))).toBe(
      true,
    );
    expect(response.body).not.toHaveProperty("accessToken");
    expect(response.body).not.toHaveProperty("refreshToken");
    expect(response.body.projectId).toBe("project-first");
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });

  it("clears both session cookies when logging out", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/logout")
      .set("Origin", "http://localhost:3000")
      .set(
        "Cookie",
        "fashion_access_token=access-token; fashion_refresh_token=refresh-token",
      )
      .expect(204);

    const cookies = response.headers["set-cookie"] as unknown as string[];
    expect(cookies).toHaveLength(2);
    const accessCookie = cookies.find((cookie) =>
      cookie.startsWith("fashion_access_token="),
    );
    const refreshCookie = cookies.find((cookie) =>
      cookie.startsWith("fashion_refresh_token="),
    );
    expect(accessCookie).toContain("fashion_access_token=;");
    expect(refreshCookie).toContain("fashion_refresh_token=;");
    expect(accessCookie).toContain("Max-Age=0");
    expect(refreshCookie).toContain("Max-Age=0");
    expect(accessCookie).toContain("Path=/");
    expect(refreshCookie).toContain("Path=/");
    expect(accessCookie).toContain("HttpOnly");
    expect(refreshCookie).toContain("HttpOnly");
    expect(cookies.every((cookie) => cookie.includes("SameSite=Lax"))).toBe(
      true,
    );
    expect(authService.assertAllowedOrigin).toHaveBeenCalledWith(
      "http://localhost:3000",
    );
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });
});
