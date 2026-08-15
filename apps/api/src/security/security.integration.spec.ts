import { prisma } from "@fashion/db";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AppModule } from "../app.module";
import { AuthService } from "../modules/auth/auth.service";
import { GenerationService } from "../modules/generation/generation.service";

describe("security hardening integration", () => {
  let app: INestApplication;
  let userId: string;
  const generationService = {
    cancel: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
  };

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `security-${crypto.randomUUID()}@example.com`,
      },
    });
    userId = user.id;
    const authService = {
      authenticate: vi.fn().mockResolvedValue({
        authUserId: `auth-${user.id}`,
        email: user.email,
        userId: user.id,
      }),
    };
    generationService.create.mockImplementation(async () => ({
      taskId: crypto.randomUUID(),
    }));

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthService)
      .useValue(authService)
      .overrideProvider(GenerationService)
      .useValue(generationService)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("真实 Redis 上第 21 次生成返回 429，且成功写审计日志", async () => {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      await request(app.getHttpServer())
        .post("/generations")
        .set("Cookie", "fashion_access_token=valid-token")
        .set("Idempotency-Key", `security-generation-${attempt}`)
        .send({
          height: 512,
          prompt: `fashion editorial ${attempt}`,
          taskType: "t2i",
          width: 512,
        })
        .expect(202);
    }

    const limited = await request(app.getHttpServer())
      .post("/generations")
      .set("Cookie", "fashion_access_token=valid-token")
      .set("Idempotency-Key", "security-generation-21")
      .send({
        height: 512,
        prompt: "fashion editorial 21",
        taskType: "t2i",
        width: 512,
      })
      .expect(429);

    expect(limited.headers["retry-after"]).toMatch(/^\d+$/);
    expect(limited.body).toEqual({
      code: "RATE_LIMITED",
      message: "请求过于频繁，请稍后重试",
    });
    expect(JSON.stringify(limited.body)).not.toContain("rate-limit:");
    expect(generationService.create).toHaveBeenCalledTimes(20);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        operation: "GenerationController.create",
        userId,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toMatchObject({
      method: "POST",
      resource: "generations",
      statusCode: 202,
      success: true,
      userId,
    });
  });
});
