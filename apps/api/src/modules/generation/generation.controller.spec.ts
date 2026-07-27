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

describe("generation HTTP contract", () => {
  let app: INestApplication;
  const authService = {
    authenticate: vi.fn(),
  };
  const generationService = {
    cancel: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
  };

  beforeAll(async () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
    authService.authenticate.mockResolvedValue({
      authUserId: "auth-user-1",
      email: "designer@example.com",
      userId: "user-1",
    });
    generationService.create.mockResolvedValue({ taskId: "task-1" });
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /generations 立即返回 202 和 task_id", async () => {
    const response = await request(app.getHttpServer())
      .post("/generations")
      .set("Cookie", "fashion_access_token=valid-token")
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
    );
  });

  it("非法生成参数返回 400 且不建任务", async () => {
    const response = await request(app.getHttpServer())
      .post("/generations")
      .set("Cookie", "fashion_access_token=valid-token")
      .send({ taskType: "t2i", prompt: "" })
      .expect(400);

    expect(response.body).toMatchObject({
      code: "INVALID_REQUEST",
      message: "生成参数不合法",
    });
    expect(generationService.create).not.toHaveBeenCalled();
  });
});
