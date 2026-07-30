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
import { AuthService } from "../auth/auth.service";
import { GenerationService } from "./generation.service";
import { AUDIT_DB } from "../../security/audit.interceptor";
import { RATE_LIMIT_STORE } from "../../security/rate-limit.guard";

describe("generation HTTP contract", () => {
  let app: INestApplication;
  const authService = {
    authenticate: vi.fn(),
  };
  const generationService = {
    cancel: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthService)
      .useValue(authService)
      .overrideProvider(GenerationService)
      .useValue(generationService)
      .overrideProvider(RATE_LIMIT_STORE)
      .useValue({
        consume: vi.fn().mockResolvedValue({
          count: 1,
          retryAfterSeconds: 3600,
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
    authService.authenticate.mockResolvedValue({
      authUserId: "auth-user-1",
      email: "designer@example.com",
      userId: "user-1",
    });
    generationService.create.mockResolvedValue({ taskId: "task-1" });
    generationService.list.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /generations 立即返回 202 和 task_id", async () => {
    const response = await request(app.getHttpServer())
      .post("/generations")
      .set("Cookie", "fashion_access_token=valid-token")
      .set("Idempotency-Key", "generation-contract-1")
      .send({
        taskType: "t2i",
        prompt: "fashion editorial",
        width: 512,
        height: 512,
        steps: 20,
        cfg: 3.5,
      })
      .expect(202);

    expect(response.body).toEqual({ task_id: "task-1" });
    expect(generationService.create).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ taskType: "t2i" }),
      "generation-contract-1",
    );
  });

  it("非法生成参数返回 400 且不建任务", async () => {
    const response = await request(app.getHttpServer())
      .post("/generations")
      .set("Cookie", "fashion_access_token=valid-token")
      .set("Idempotency-Key", "generation-contract-2")
      .send({ taskType: "t2i", prompt: "" })
      .expect(400);

    expect(response.body).toMatchObject({
      code: "INVALID_REQUEST",
      message: "生成参数不合法",
    });
    expect(generationService.create).not.toHaveBeenCalled();
  });

  it("GET /generations 按项目查询可恢复任务", async () => {
    generationService.list.mockResolvedValue({
      items: [
        {
          id: "task-2",
          request: {
            cfg: 3.5,
            height: 512,
            prompt: "fashion editorial",
            projectId: "project-1",
            steps: 20,
            taskType: "t2i",
            width: 512,
          },
        },
      ],
      nextCursor: "task-2",
    });

    const response = await request(app.getHttpServer())
      .get("/generations?projectId=project-1&cursor=task-3&limit=20")
      .set("Cookie", "fashion_access_token=valid-token")
      .expect(200);

    expect(response.body).toMatchObject({
      items: [{ id: "task-2" }],
      nextCursor: "task-2",
    });
    expect(generationService.list).toHaveBeenCalledWith("user-1", {
      cursor: "task-3",
      limit: 20,
      projectId: "project-1",
    });
  });

  it("GET /generations 拒绝缺失 projectId 或非法 limit", async () => {
    await request(app.getHttpServer())
      .get("/generations?limit=0")
      .set("Cookie", "fashion_access_token=valid-token")
      .expect(400);

    expect(generationService.list).not.toHaveBeenCalled();
  });
});
