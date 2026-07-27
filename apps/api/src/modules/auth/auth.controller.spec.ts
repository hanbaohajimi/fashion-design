import type { User } from "@fashion/db";
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
import { AuthService } from "./auth.service";

const user: User = {
  id: "cm1234567890123456789012",
  authId: "supabase-user-id",
  avatar: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  deletedAt: null,
  email: "designer@example.com",
  name: "Designer",
};

describe("authentication HTTP contract", () => {
  let app: INestApplication;
  const authService = {
    assertAllowedOrigin: vi.fn(),
    authenticate: vi.fn(),
    getUser: vi.fn(),
    refreshSession: vi.fn(),
    sendMagicLink: vi.fn(),
    verifyMagicLink: vi.fn(),
  };

  beforeAll(async () => {
    process.env.APP_ORIGIN = "http://localhost:3000";
    process.env.SESSION_COOKIE_SECURE = "false";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthService)
      .useValue(authService)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authService.assertAllowedOrigin.mockImplementation(() => undefined);
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
        limit: 0,
        remaining: 0,
        used: 0,
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
  });
});
