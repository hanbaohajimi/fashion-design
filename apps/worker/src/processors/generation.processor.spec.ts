import {
  AiProviderError,
  type AiProviderJob,
  type AiProviderResult,
} from "@fashion/ai";
import { BillingService } from "@fashion/billing";
import {
  CollectionVariationAxis,
  DesignAssetOperation,
  GenerationTaskStatus,
  prisma,
  type GenerationTask,
} from "@fashion/db";
import type { GenerationJobData } from "@fashion/shared";
import { UnrecoverableError, type Job } from "bullmq";
import sharp from "sharp";
import { afterAll, describe, expect, it, vi } from "vitest";

import {
  createGenerationProcessor,
  generationTimeoutMsFromEnv,
} from "./generation.processor";

const request = {
  taskType: "t2i" as const,
  prompt: "fashion editorial",
  width: 512,
  height: 512,
  steps: 20,
  cfg: 3.5,
};

const providerJob: AiProviderJob = {
  provider: "mock",
  providerJobId: "remote-job-1",
  model: "mock/image-generator",
  taskType: "t2i",
  submittedAt: "2026-01-01T00:00:00.000Z",
  cost: {
    rawCost: 0.04,
    credits: 4,
    currency: "USD",
    billableMegapixels: 1,
    estimated: true,
  },
};

const providerResult: AiProviderResult = {
  job: providerJob,
  images: [{ url: "https://cdn.test/generated.png" }],
  seed: 42,
  cost: providerJob.cost,
};

function resolvePublicHostname(): Promise<string[]> {
  return Promise.resolve(["93.184.216.34"]);
}

describe("Generation processor", () => {
  it("默认给 Amux 生图和后处理预留十二分钟，并允许环境变量覆盖", () => {
    expect(generationTimeoutMsFromEnv(undefined)).toBe(720_000);
    expect(generationTimeoutMsFromEnv("900000")).toBe(900_000);
    expect(generationTimeoutMsFromEnv("invalid")).toBe(720_000);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("正常路径从 queued 流转到 succeeded 并且只计次一次", async () => {
    const fixture = await createTask();
    const ai = successfulAi();
    const job = fakeJob(fixture.task);
    const source = await sharp({
      create: {
        background: "#9c8874",
        channels: 3,
        height: 512,
        width: 512,
      },
    })
      .png()
      .toBuffer();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Uint8Array.from(source), {
        headers: {
          "Content-Length": String(source.byteLength),
          "Content-Type": "image/png",
        },
      }),
    );
    const storage = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
      resolveHostname: resolvePublicHostname,
      storage,
    });

    try {
      await process(job);
      await process(fakeJob(fixture.task));

      const [task, user, assets] = await Promise.all([
        prisma.generationTask.findUniqueOrThrow({
          where: { id: fixture.task.id },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } }),
        prisma.designAsset.findMany({
          where: { generationTaskId: fixture.task.id },
        }),
      ]);
      expect(task.status).toBe(GenerationTaskStatus.SUCCEEDED);
      expect(task.output).toMatchObject({
        images: [
          {
            assetId: expect.any(String),
            url: expect.stringMatching(/^\/api\/design-assets\/.+\/content$/),
          },
        ],
      });
      expect(assets).toHaveLength(1);
      expect(assets[0]).toMatchObject({
        operation: DesignAssetOperation.GENERATED,
        parentAssetId: null,
        rootAssetId: assets[0]?.id,
        thumbnailUrl: expect.stringMatching(/^s3:\/\/generated\//),
        url: expect.stringMatching(/^s3:\/\/generated\//),
      });
      expect(storage.put).toHaveBeenCalledTimes(2);
      expect(task.countedAt).not.toBeNull();
      expect(user.generationCount).toBe(1);
      expect(job.updateProgress.mock.calls.map(([value]) => value)).toEqual([
        expect.objectContaining({ status: "running" }),
        expect.objectContaining({ status: "succeeded" }),
      ]);
    } finally {
      fetchMock.mockRestore();
      await cleanup(fixture.userId);
    }
  });

  it("GPT Image 2 内联结果不写入 providerJob，并直接物化到对象存储", async () => {
    const fixture = await createTask();
    const source = await generatedSource();
    const inlineUrl = `data:image/png;base64,${source.toString("base64")}`;
    const inlineJob: AiProviderJob = {
      ...providerJob,
      provider: "amux",
      completedResult: { images: [{ url: inlineUrl }] },
    };
    const ai = successfulAi();
    ai.submit.mockResolvedValue(inlineJob);
    ai.getResult.mockResolvedValue({
      ...providerResult,
      job: inlineJob,
      images: [{ url: inlineUrl }],
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("内联图片不应触发网络请求"));
    const storage = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const moderator = approvedModerator();
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      moderator,
      pollIntervalMs: 1,
      resolveHostname: resolvePublicHostname,
      storage,
    });

    try {
      await expect(process(fakeJob(fixture.task))).resolves.toMatchObject({
        status: "succeeded",
      });

      const task = await prisma.generationTask.findUniqueOrThrow({
        where: { id: fixture.task.id },
      });
      expect(task.providerJob).toBeNull();
      expect(JSON.stringify(task.output)).not.toContain("data:image/");
      expect(ai.getStatus).not.toHaveBeenCalled();
      expect(moderator.moderate).toHaveBeenCalledWith([inlineUrl]);
      expect(storage.put).toHaveBeenCalledTimes(2);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      await cleanup(fixture.userId);
    }
  });

  it("无项目任务保留 Provider URL 且不执行素材持久化", async () => {
    const fixture = await createTask(GenerationTaskStatus.QUEUED, false, true);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("projectless task must not fetch"));
    const storage = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
      resolveHostname: resolvePublicHostname,
      storage,
    });

    try {
      await process(fakeJob(fixture.task));
      const [task, assets] = await Promise.all([
        prisma.generationTask.findUniqueOrThrow({
          where: { id: fixture.task.id },
        }),
        prisma.designAsset.findMany({
          where: { generationTaskId: fixture.task.id },
        }),
      ]);
      expect(task.output).toMatchObject({
        images: [{ url: "https://cdn.test/generated.png" }],
      });
      expect(assets).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(storage.put).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      await cleanup(fixture.userId);
    }
  });

  it("素材持久化拒绝非 HTTPS Provider URL", async () => {
    const fixture = await createTask();
    const ai = successfulAi();
    ai.getResult.mockResolvedValue({
      ...providerResult,
      images: [{ url: "http://cdn.test/generated.png" }],
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unsafe URL must not be fetched"));
    const storage = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
      resolveHostname: resolvePublicHostname,
      storage,
    });

    try {
      await expect(process(fakeJob(fixture.task, 1))).rejects.toThrow(
        "生成结果仅允许 HTTPS URL",
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(storage.put).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      await cleanup(fixture.userId);
    }
  });

  it("素材持久化在跟随重定向前拒绝私网 IP 主机", async () => {
    const fixture = await createTask();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        headers: { Location: "https://127.0.0.1/generated.png" },
        status: 302,
      }),
    );
    const storage = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
      resolveHostname: resolvePublicHostname,
      storage,
    });

    try {
      await expect(process(fakeJob(fixture.task, 1))).rejects.toThrow(
        "生成结果 URL 不允许指向本机或私网地址",
      );
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledWith(
        "https://cdn.test/generated.png",
        expect.objectContaining({ redirect: "manual" }),
      );
      expect(storage.put).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      await cleanup(fixture.userId);
    }
  });

  it.each([
    { addresses: ["10.0.0.8"], recordType: "A 私网" },
    { addresses: ["fd00::8"], recordType: "AAAA 私网" },
    { addresses: ["fe80::8"], recordType: "AAAA 链路本地" },
    {
      addresses: ["93.184.216.34", "fd00::8"],
      recordType: "A/AAAA 混合结果中的私网",
    },
  ])("素材持久化拒绝解析到 $recordType 地址的域名", async ({ addresses }) => {
    const fixture = await createTask();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("private address must not be fetched"));
    const resolveHostname = vi.fn().mockResolvedValue(addresses);
    const storage = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
      resolveHostname,
      storage,
    });

    try {
      await expect(process(fakeJob(fixture.task, 1))).rejects.toThrow(
        "生成结果域名解析到不允许的地址",
      );
      expect(resolveHostname).toHaveBeenCalledWith("cdn.test");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(storage.put).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      await cleanup(fixture.userId);
    }
  });

  it("素材持久化会在每次重定向前重新解析并拒绝私网地址", async () => {
    const fixture = await createTask();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        headers: { Location: "https://redirect.test/generated.png" },
        status: 302,
      }),
    );
    const resolveHostname = vi
      .fn()
      .mockImplementation((hostname: string) =>
        Promise.resolve(
          hostname === "cdn.test" ? ["93.184.216.34"] : ["127.0.0.1"],
        ),
      );
    const storage = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
      resolveHostname,
      storage,
    });

    try {
      await expect(process(fakeJob(fixture.task, 1))).rejects.toThrow(
        "生成结果域名解析到不允许的地址",
      );
      expect(resolveHostname.mock.calls.map(([hostname]) => hostname)).toEqual([
        "cdn.test",
        "redirect.test",
      ]);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(storage.put).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      await cleanup(fixture.userId);
    }
  });

  it("素材持久化在域名解析失败时拒绝发起请求", async () => {
    const fixture = await createTask();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unresolved host must not be fetched"));
    const resolveHostname = vi
      .fn()
      .mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    const storage = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
      resolveHostname,
      storage,
    });

    try {
      await expect(process(fakeJob(fixture.task, 1))).rejects.toThrow(
        "生成结果域名解析失败",
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(storage.put).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      await cleanup(fixture.userId);
    }
  });

  it("素材持久化最多允许三次安全重定向", async () => {
    const fixture = await createTask();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) =>
        new Response(null, {
          headers: {
            Location: new URL("/next", String(input)).toString(),
          },
          status: 302,
        }),
    );
    const storage = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
      resolveHostname: resolvePublicHostname,
      storage,
    });

    try {
      await expect(process(fakeJob(fixture.task, 1))).rejects.toThrow(
        "生成结果重定向次数超过限制",
      );
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(storage.put).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      await cleanup(fixture.userId);
    }
  });

  it("素材持久化在读取响应体前拒绝非白名单图片类型", async () => {
    const fixture = await createTask();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>not an image</html>", {
        headers: { "Content-Type": "text/html" },
      }),
    );
    const storage = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
      resolveHostname: resolvePublicHostname,
      storage,
    });

    try {
      await expect(process(fakeJob(fixture.task, 1))).rejects.toThrow(
        "生成结果 Content-Type 不受支持",
      );
      expect(storage.put).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      await cleanup(fixture.userId);
    }
  });

  it("素材持久化对无 Content-Length 的流式响应执行 25MB 硬限制", async () => {
    const fixture = await createTask();
    const chunk = new Uint8Array(13 * 1024 * 1024);
    let emitted = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted < 2) {
          emitted += 1;
          controller.enqueue(chunk);
          return;
        }
        controller.close();
      },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, {
        headers: { "Content-Type": "image/png" },
      }),
    );
    const storage = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
      resolveHostname: resolvePublicHostname,
      storage,
    });

    try {
      await expect(process(fakeJob(fixture.task, 1))).rejects.toThrow(
        "生成结果超过 25MB",
      );
      expect(storage.put).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      await cleanup(fixture.userId);
    }
  });

  it("对象写入中途失败时 best-effort 删除本次尝试的全部 key", async () => {
    const fixture = await createTask();
    const source = await generatedSource();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Uint8Array.from(source), {
        headers: { "Content-Type": "image/png" },
      }),
    );
    const storage = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      put: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("thumbnail write failed")),
    };
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
      resolveHostname: resolvePublicHostname,
      storage,
    });

    try {
      await expect(process(fakeJob(fixture.task, 1))).rejects.toThrow(
        "thumbnail write failed",
      );
      expect(storage.delete.mock.calls.map(([key]) => key)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/\/source$/),
          expect.stringMatching(/\/thumbnail-1024\.webp$/),
        ]),
      );
    } finally {
      fetchMock.mockRestore();
      await cleanup(fixture.userId);
    }
  });

  it("对象补偿删除遇到瞬时失败时会重试", async () => {
    const fixture = await createTask();
    const source = await generatedSource();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Uint8Array.from(source), {
        headers: { "Content-Type": "image/png" },
      }),
    );
    const deleteAttempts = new Map<string, number>();
    const storage = {
      delete: vi.fn().mockImplementation(async (key: string) => {
        const attempt = (deleteAttempts.get(key) ?? 0) + 1;
        deleteAttempts.set(key, attempt);
        if (attempt === 1) {
          throw new Error("temporary delete failure");
        }
      }),
      get: vi.fn(),
      put: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("thumbnail write failed")),
    };
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
      resolveHostname: resolvePublicHostname,
      storage,
    });

    try {
      await expect(process(fakeJob(fixture.task, 1))).rejects.toThrow(
        "thumbnail write failed",
      );
      expect([...deleteAttempts.values()]).toEqual([2, 2]);
    } finally {
      fetchMock.mockRestore();
      await cleanup(fixture.userId);
    }
  });

  it("对象 key 绑定租约 attempt，避免旧租约补偿误删新租约对象", async () => {
    const fixture = await createTask();
    await prisma.generationTask.update({
      where: { id: fixture.task.id },
      data: { attemptCount: 4 },
    });
    const source = await generatedSource();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Uint8Array.from(source), {
        headers: { "Content-Type": "image/png" },
      }),
    );
    const storage = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
      resolveHostname: resolvePublicHostname,
      storage,
    });

    try {
      await expect(process(fakeJob(fixture.task))).resolves.toMatchObject({
        status: "succeeded",
      });
      expect(storage.put.mock.calls.map(([key]) => key)).toEqual([
        expect.stringContaining("/attempt-5/source"),
        expect.stringContaining("/attempt-5/thumbnail-1024.webp"),
      ]);
    } finally {
      fetchMock.mockRestore();
      await cleanup(fixture.userId);
    }
  });

  it("物化后并发取消会删除对象且不落资产、不计费", async () => {
    const fixture = await createTask();
    const source = await generatedSource();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Uint8Array.from(source), {
        headers: { "Content-Type": "image/png" },
      }),
    );
    const storage = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      put: vi.fn().mockImplementation(async (key: string) => {
        if (key.endsWith("/thumbnail-1024.webp")) {
          await prisma.generationTask.update({
            where: { id: fixture.task.id },
            data: {
              canceledAt: new Date(),
              completedAt: new Date(),
              status: GenerationTaskStatus.CANCELED,
            },
          });
        }
      }),
    };
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
      resolveHostname: resolvePublicHostname,
      storage,
    });

    try {
      await expect(process(fakeJob(fixture.task))).resolves.toMatchObject({
        skipped: true,
        status: "canceled",
      });
      const [assets, user] = await Promise.all([
        prisma.designAsset.findMany({
          where: { generationTaskId: fixture.task.id },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } }),
      ]);
      expect(assets).toHaveLength(0);
      expect(user.generationCount).toBe(0);
      expect(storage.delete).toHaveBeenCalledTimes(2);
    } finally {
      fetchMock.mockRestore();
      await cleanup(fixture.userId);
    }
  });

  it("数据库事务失败时补偿删除已物化对象", async () => {
    const fixture = await createTask();
    const source = await generatedSource();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(source), {
        headers: { "Content-Type": "image/png" },
      }),
    );
    const storage = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: {
        $transaction: vi.fn().mockRejectedValue(new Error("database down")),
        collectionLook: prisma.collectionLook,
        designAsset: prisma.designAsset,
        generationTask: prisma.generationTask,
      } as never,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
      resolveHostname: resolvePublicHostname,
      storage,
    });

    try {
      await expect(process(fakeJob(fixture.task, 1))).rejects.toThrow(
        "database down",
      );
      expect(storage.delete).toHaveBeenCalledTimes(2);
    } finally {
      fetchMock.mockRestore();
      await cleanup(fixture.userId);
    }
  });

  it("审核不通过时 task=moderation_failed、不给用户计次且不落设计资产", async () => {
    const fixture = await createTask();
    const moderator = {
      moderate: vi.fn().mockResolvedValue({
        categories: ["sexual"],
        status: "rejected" as const,
      }),
    };
    const job = fakeJob(fixture.task);
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: prisma,
      moderator,
      pollIntervalMs: 1,
    });

    try {
      await expect(process(job)).resolves.toMatchObject({
        status: "moderation_failed",
      });
      const [task, user, assets] = await Promise.all([
        prisma.generationTask.findUniqueOrThrow({
          where: { id: fixture.task.id },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } }),
        prisma.designAsset.findMany({
          where: { generationTaskId: fixture.task.id },
        }),
      ]);
      expect(task).toMatchObject({
        countedAt: null,
        errorCode: "CONTENT_MODERATION_FAILED",
        errorMessage: "该内容不符合平台规范",
        manualReviewRequired: false,
        moderationCategories: ["sexual"],
        status: GenerationTaskStatus.MODERATION_FAILED,
      });
      expect(task.output).toBeNull();
      expect(task.providerJob).toBeNull();
      expect(user.generationCount).toBe(0);
      expect(assets).toHaveLength(0);
      expect(job.updateProgress).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "moderation_failed" }),
      );
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("审核服务异常时隔离结果、不落资产且不计费", async () => {
    const fixture = await createTask();
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: prisma,
      moderator: {
        moderate: vi.fn().mockRejectedValue(new Error("moderation timeout")),
      },
      pollIntervalMs: 1,
    });

    try {
      await expect(process(fakeJob(fixture.task, 1))).rejects.toThrow(
        "内容审核服务暂时不可用",
      );
      const [task, user, assets] = await Promise.all([
        prisma.generationTask.findUniqueOrThrow({
          where: { id: fixture.task.id },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } }),
        prisma.designAsset.findMany({
          where: { generationTaskId: fixture.task.id },
        }),
      ]);
      expect(task).toMatchObject({
        countedAt: null,
        errorCode: "CONTENT_MODERATION_UNAVAILABLE",
        manualReviewRequired: false,
        output: null,
        status: GenerationTaskStatus.FAILED,
      });
      expect(user.generationCount).toBe(0);
      expect(assets).toHaveLength(0);
      expect(task.providerJob).toBeNull();
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("i2i 成功后新资产继承父资产与根血缘", async () => {
    const fixture = await createTask(GenerationTaskStatus.QUEUED, true);
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
    });

    try {
      await process(fakeJob(fixture.task));
      const child = await prisma.designAsset.findFirstOrThrow({
        where: { generationTaskId: fixture.task.id },
      });
      expect(child).toMatchObject({
        operation: DesignAssetOperation.VARIATION,
        parentAssetId: fixture.parentAssetId,
        rootAssetId: fixture.parentAssetId,
      });
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("系列生成成功后创建唯一 CollectionLook 并投递参考相似度任务", async () => {
    const fixture = await createTask(GenerationTaskStatus.QUEUED, true);
    if (!fixture.parentAssetId) throw new Error("测试 Hero 资产创建失败");
    const parent = await prisma.designAsset.findUniqueOrThrow({
      where: { id: fixture.parentAssetId },
    });
    const collection = await prisma.collection.create({
      data: {
        dna: {
          create: {
            fabrics: [],
            moodWords: [],
            palette: [],
            referenceFileIds: [],
            silhouettes: [],
          },
        },
        heroAssetId: parent.id,
        looks: {
          create: {
            designAssetId: parent.id,
            isHero: true,
            ordinal: 1,
          },
        },
        name: "Worker collection",
        projectId: parent.projectId,
      },
    });
    await prisma.generationTask.update({
      where: { id: fixture.task.id },
      data: {
        collectionId: collection.id,
        garmentTypeCode: "dress",
        garmentTypeLabel: "连衣裙",
        slotKey: "slot-02",
        variationAxis: CollectionVariationAxis.GARMENT_TYPE,
      },
    });
    const similarityJobs = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const process = createGenerationProcessor({
      ai: successfulAi(),
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
      similarityJobs,
    });

    try {
      await process(fakeJob(fixture.task));
      const looks = await prisma.collectionLook.findMany({
        where: { collectionId: collection.id },
        orderBy: { ordinal: "asc" },
      });
      expect(looks).toHaveLength(2);
      expect(looks[1]).toMatchObject({
        garmentTypeCode: "dress",
        garmentTypeLabel: "连衣裙",
        isHero: false,
        ordinal: 2,
        slotKey: "slot-02",
        variationAxis: CollectionVariationAxis.GARMENT_TYPE,
      });
      expect(similarityJobs.enqueue).toHaveBeenCalledWith(
        collection.id,
        looks[1]?.designAssetId,
      );
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("worker 取到 canceled task 时直接 ack 且不调用 AI", async () => {
    const fixture = await createTask(GenerationTaskStatus.CANCELED);
    const ai = successfulAi();
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
    });

    try {
      await expect(process(fakeJob(fixture.task))).resolves.toEqual({
        skipped: true,
        status: "canceled",
        taskId: fixture.task.id,
      });
      expect(ai.submit).not.toHaveBeenCalled();
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: fixture.userId },
      });
      expect(user.generationCount).toBe(0);
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("新鲜 RUNNING 租约会延迟 Bull job，避免把仍在执行的任务错误完成", async () => {
    const fixture = await createTask(GenerationTaskStatus.RUNNING);
    const ai = successfulAi();
    const job = fakeJob(fixture.task);
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
    });

    try {
      await expect(process(job)).rejects.toMatchObject({
        name: "DelayedError",
      });
      expect(job.moveToDelayed).toHaveBeenCalledOnce();
      expect(job.moveToDelayed).toHaveBeenCalledWith(
        expect.any(Number),
        "worker-token",
      );
      expect(ai.submit).not.toHaveBeenCalled();
      const task = await prisma.generationTask.findUniqueOrThrow({
        where: { id: fixture.task.id },
      });
      expect(task.attemptCount).toBe(0);
      expect(task.status).toBe(GenerationTaskStatus.RUNNING);
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("过期 RUNNING 租约可原子接管并复用 provider job", async () => {
    const fixture = await createTask(GenerationTaskStatus.RUNNING);
    const stale = await prisma.generationTask.update({
      where: { id: fixture.task.id },
      data: {
        providerJob: providerJob as never,
        updatedAt: new Date(Date.now() - 60_000),
      },
    });
    const ai = successfulAi();
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
    });

    try {
      await expect(process(fakeJob(stale))).resolves.toMatchObject({
        status: "succeeded",
      });
      expect(ai.submit).not.toHaveBeenCalled();
      const task = await prisma.generationTask.findUniqueOrThrow({
        where: { id: fixture.task.id },
      });
      expect(task.attemptCount).toBe(1);
      expect(task.status).toBe(GenerationTaskStatus.SUCCEEDED);
      expect(task.providerJob).toBeNull();
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("旧 Worker 丢失 attempt fencing token 后不能持久化或计费", async () => {
    const fixture = await createTask();
    let releaseSubmit: (() => void) | undefined;
    const submitGate = new Promise<void>((resolve) => {
      releaseSubmit = resolve;
    });
    const ai = successfulAi();
    ai.submit.mockImplementation(async () => {
      await submitGate;
      return providerJob;
    });
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
    });

    try {
      const running = process(fakeJob(fixture.task));
      await waitForTaskStatus(fixture.task.id, GenerationTaskStatus.RUNNING);
      await prisma.generationTask.update({
        where: { id: fixture.task.id },
        data: {
          attemptCount: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      releaseSubmit?.();

      await expect(running).rejects.toThrow("生成任务执行租约已失效");
      const [task, user, assets] = await Promise.all([
        prisma.generationTask.findUniqueOrThrow({
          where: { id: fixture.task.id },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } }),
        prisma.designAsset.findMany({
          where: { generationTaskId: fixture.task.id },
        }),
      ]);
      expect(task.status).toBe(GenerationTaskStatus.RUNNING);
      expect(task.countedAt).toBeNull();
      expect(user.generationCount).toBe(0);
      expect(assets).toHaveLength(0);
    } finally {
      releaseSubmit?.();
      await cleanup(fixture.userId);
    }
  });

  it("领取 CAS 输给并发取消时不把任务改回 running", async () => {
    const queuedTask = {
      attemptCount: 0,
      countedAt: null,
      id: "task-cancel-race",
      startedAt: null,
      status: GenerationTaskStatus.QUEUED,
      updatedAt: new Date(),
      userId: "user-1",
    } as GenerationTask;
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(queuedTask)
      .mockResolvedValueOnce({ status: GenerationTaskStatus.CANCELED });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const ai = successfulAi();
    const process = createGenerationProcessor({
      ai,
      billing: { incrementCount: vi.fn() },
      database: {
        generationTask: { findUnique, updateMany },
      } as never,
      moderator: approvedModerator(),
    });

    await expect(process(fakeJob(queuedTask))).resolves.toEqual({
      skipped: true,
      status: "canceled",
      taskId: queuedTask.id,
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          attemptCount: 0,
          id: queuedTask.id,
          status: GenerationTaskStatus.QUEUED,
          userId: queuedTask.userId,
        }),
      }),
    );
    expect(ai.submit).not.toHaveBeenCalled();
  });

  it("生成结果返回前被取消时不落成功结果也不计次", async () => {
    const fixture = await createTask();
    const ai = successfulAi();
    ai.getResult.mockImplementation(async () => {
      await prisma.generationTask.update({
        where: { id: fixture.task.id },
        data: {
          canceledAt: new Date(),
          completedAt: new Date(),
          status: GenerationTaskStatus.CANCELED,
        },
      });
      return providerResult;
    });
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
    });

    try {
      await expect(process(fakeJob(fixture.task))).resolves.toMatchObject({
        skipped: true,
        status: "canceled",
      });
      const [task, user] = await Promise.all([
        prisma.generationTask.findUniqueOrThrow({
          where: { id: fixture.task.id },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } }),
      ]);
      expect(task.status).toBe(GenerationTaskStatus.CANCELED);
      expect(task.output).toBeNull();
      expect(user.generationCount).toBe(0);
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("轮询中的任务被取消时 best-effort 取消远端 Provider job", async () => {
    const fixture = await createTask();
    const ai = successfulAi();
    ai.getStatus.mockImplementationOnce(async () => {
      await prisma.generationTask.update({
        where: { id: fixture.task.id },
        data: {
          canceledAt: new Date(),
          completedAt: new Date(),
          status: GenerationTaskStatus.CANCELED,
        },
      });
      return { status: "running" };
    });
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
    });

    try {
      await expect(process(fakeJob(fixture.task))).resolves.toMatchObject({
        skipped: true,
        status: "canceled",
      });
      expect(ai.cancel).toHaveBeenCalledWith(
        expect.objectContaining({ providerJobId: providerJob.providerJobId }),
      );
      expect(ai.getResult).not.toHaveBeenCalled();
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("远端 Provider cancel 永不返回时不阻塞本地取消收尾", async () => {
    const fixture = await createTask();
    const ai = successfulAi();
    let releaseCancel: (() => void) | undefined;
    ai.cancel.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseCancel = resolve;
        }),
    );
    ai.getStatus.mockImplementationOnce(async () => {
      await prisma.generationTask.update({
        where: { id: fixture.task.id },
        data: {
          canceledAt: new Date(),
          completedAt: new Date(),
          status: GenerationTaskStatus.CANCELED,
        },
      });
      return { status: "running" };
    });
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
      providerCancelTimeoutMs: 5,
    });
    const running = process(fakeJob(fixture.task));
    let guardTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      const guarded = Promise.race([
        running,
        new Promise<never>((_, reject) => {
          guardTimer = setTimeout(
            () => reject(new Error("Provider cancel blocked local cleanup")),
            1_000,
          );
        }),
      ]);
      await expect(guarded).resolves.toMatchObject({
        skipped: true,
        status: "canceled",
      });
      expect(ai.cancel).toHaveBeenCalledOnce();
      const task = await prisma.generationTask.findUniqueOrThrow({
        where: { id: fixture.task.id },
      });
      expect(task.status).toBe(GenerationTaskStatus.CANCELED);
    } finally {
      if (guardTimer) {
        clearTimeout(guardTimer);
      }
      releaseCancel?.();
      await running.catch(() => undefined);
      await cleanup(fixture.userId);
    }
  });

  it("Provider 调用阻塞时 heartbeat 能识别取消而不是误报租约丢失", async () => {
    const fixture = await createTask();
    await prisma.generationTask.update({
      where: { id: fixture.task.id },
      data: { providerJob: providerJob as never },
    });
    const ai = successfulAi();
    ai.getStatus.mockImplementation(
      async (_job: AiProviderJob, signal?: AbortSignal) =>
        new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      heartbeatIntervalMs: 5,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
    });

    try {
      const running = process(fakeJob(fixture.task));
      await waitForTaskStatus(fixture.task.id, GenerationTaskStatus.RUNNING);
      await prisma.generationTask.update({
        where: { id: fixture.task.id },
        data: {
          canceledAt: new Date(),
          completedAt: new Date(),
          status: GenerationTaskStatus.CANCELED,
        },
      });

      await expect(running).resolves.toMatchObject({
        skipped: true,
        status: "canceled",
      });
      expect(ai.cancel).toHaveBeenCalledWith(
        expect.objectContaining({ providerJobId: providerJob.providerJobId }),
      );
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it.each([{ attemptsMade: 0 }, { attemptsMade: 1 }])(
    "Provider 失败与取消竞态时保留 canceled 终态（attemptsMade=$attemptsMade）",
    async ({ attemptsMade }) => {
      const fixture = await createTask();
      const ai = successfulAi();
      ai.getResult.mockImplementationOnce(async () => {
        await prisma.generationTask.update({
          where: { id: fixture.task.id },
          data: {
            canceledAt: new Date(),
            completedAt: new Date(),
            status: GenerationTaskStatus.CANCELED,
          },
        });
        throw new AiProviderError({
          code: "PROVIDER_UNAVAILABLE",
          provider: "mock",
          message: "temporary failure",
          retryable: true,
        });
      });
      const job = fakeJob(fixture.task, attemptsMade);
      const process = createGenerationProcessor({
        ai,
        billing: new BillingService(prisma),
        database: prisma,
        moderator: approvedModerator(),
        pollIntervalMs: 1,
      });

      try {
        await expect(process(job)).resolves.toMatchObject({
          skipped: true,
          status: "canceled",
        });
        expect(job.updateProgress).toHaveBeenLastCalledWith(
          expect.objectContaining({ status: "canceled" }),
        );
        const task = await prisma.generationTask.findUniqueOrThrow({
          where: { id: fixture.task.id },
        });
        expect(task.status).toBe(GenerationTaskStatus.CANCELED);
      } finally {
        await cleanup(fixture.userId);
      }
    },
  );

  it("成功 CAS 失败且当前不是 succeeded/canceled 时抛不可恢复冲突", async () => {
    const fixture = await createTask();
    const ai = successfulAi();
    ai.getResult.mockImplementation(async () => {
      await prisma.generationTask.update({
        where: { id: fixture.task.id },
        data: {
          completedAt: new Date(),
          status: GenerationTaskStatus.FAILED,
        },
      });
      return providerResult;
    });
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
    });

    try {
      const error = await process(fakeJob(fixture.task)).catch(
        (cause: unknown) => cause,
      );
      expect(error).toBeInstanceOf(UnrecoverableError);
      expect(error).toMatchObject({
        message: expect.stringContaining("生成任务成功落库状态冲突"),
      });
      const [task, user] = await Promise.all([
        prisma.generationTask.findUniqueOrThrow({
          where: { id: fixture.task.id },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } }),
      ]);
      expect(task.status).toBe(GenerationTaskStatus.FAILED);
      expect(user.generationCount).toBe(0);
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("最终失败时 task=failed 且 generation_count 不增加", async () => {
    const fixture = await createTask();
    const ai = successfulAi();
    ai.getResult.mockRejectedValue(
      new AiProviderError({
        code: "PROVIDER_UNAVAILABLE",
        provider: "mock",
        message: "Provider unavailable",
        retryable: true,
      }),
    );
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
    });

    try {
      await expect(process(fakeJob(fixture.task, 1))).rejects.toBeInstanceOf(
        AiProviderError,
      );
      const [task, user] = await Promise.all([
        prisma.generationTask.findUniqueOrThrow({
          where: { id: fixture.task.id },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } }),
      ]);
      expect(task.status).toBe(GenerationTaskStatus.FAILED);
      expect(user.generationCount).toBe(0);
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("重试复用已入库 provider job，最终成功只计次一次", async () => {
    const fixture = await createTask();
    const ai = successfulAi();
    ai.getResult
      .mockRejectedValueOnce(
        new AiProviderError({
          code: "PROVIDER_UNAVAILABLE",
          provider: "mock",
          message: "temporary failure",
          retryable: true,
        }),
      )
      .mockResolvedValueOnce(providerResult);
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      pollIntervalMs: 1,
    });

    try {
      await expect(process(fakeJob(fixture.task, 0))).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
      });
      await process(fakeJob(fixture.task, 1));

      const [task, user] = await Promise.all([
        prisma.generationTask.findUniqueOrThrow({
          where: { id: fixture.task.id },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } }),
      ]);
      expect(task.status).toBe(GenerationTaskStatus.SUCCEEDED);
      expect(task.attemptCount).toBe(2);
      expect(user.generationCount).toBe(1);
      expect(ai.submit).toHaveBeenCalledOnce();
    } finally {
      await cleanup(fixture.userId);
    }
  });

  it("策略超时后自动标记 failed 且不计次", async () => {
    const fixture = await createTask();
    const ai = successfulAi();
    ai.submit.mockImplementation(
      async (_input: unknown, signal?: AbortSignal) =>
        new Promise<AiProviderJob>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const process = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      moderator: approvedModerator(),
      timeoutMs: 10,
    });

    try {
      await expect(process(fakeJob(fixture.task))).rejects.toThrow(
        "生成任务超过 10 毫秒",
      );
      const [task, user] = await Promise.all([
        prisma.generationTask.findUniqueOrThrow({
          where: { id: fixture.task.id },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } }),
      ]);
      expect(task.status).toBe(GenerationTaskStatus.FAILED);
      expect(task.errorCode).toBe("GENERATION_TIMEOUT");
      expect(user.generationCount).toBe(0);
    } finally {
      await cleanup(fixture.userId);
    }
  });
});

function successfulAi() {
  return {
    cancel: vi.fn().mockResolvedValue(undefined),
    submit: vi.fn().mockResolvedValue(providerJob),
    getStatus: vi.fn().mockResolvedValue({ status: "completed" }),
    getResult: vi.fn().mockResolvedValue(providerResult),
  };
}

function approvedModerator() {
  return {
    moderate: vi.fn().mockResolvedValue({
      categories: [],
      status: "approved" as const,
    }),
  };
}

async function generatedSource(): Promise<Buffer> {
  return sharp({
    create: {
      background: "#9c8874",
      channels: 3,
      height: 64,
      width: 64,
    },
  })
    .png()
    .toBuffer();
}

async function waitForTaskStatus(
  taskId: string,
  status: GenerationTaskStatus,
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const task = await prisma.generationTask.findUnique({
      where: { id: taskId },
      select: { status: true },
    });
    if (task?.status === status) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`等待任务状态 ${status} 超时`);
}

function fakeJob(
  task: GenerationTask,
  attemptsMade = 0,
): Job<GenerationJobData> & {
  moveToDelayed: ReturnType<typeof vi.fn>;
  updateProgress: ReturnType<typeof vi.fn>;
} {
  return {
    attemptsMade,
    data: { taskId: task.id, userId: task.userId },
    id: task.id,
    moveToDelayed: vi.fn().mockResolvedValue(undefined),
    opts: { attempts: 2 },
    token: "worker-token",
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as never;
}

async function createTask(
  status: GenerationTaskStatus = GenerationTaskStatus.QUEUED,
  withParent = false,
  projectless = false,
): Promise<{
  task: GenerationTask;
  userId: string;
  parentAssetId: string | null;
}> {
  const user = await prisma.user.create({
    data: {
      email: `generation-worker-${crypto.randomUUID()}@example.com`,
      generationLimit: 100,
      ownedWorkspaces: {
        create: {
          name: "Generation worker workspace",
          projects: { create: { name: "Generation worker project" } },
        },
      },
    },
    include: {
      ownedWorkspaces: { include: { projects: true } },
    },
  });
  const projectId = user.ownedWorkspaces[0]?.projects[0]?.id;
  if (!projectId) throw new Error("测试项目创建失败");
  const parentAssetId = withParent ? crypto.randomUUID() : null;
  if (parentAssetId) {
    await prisma.designAsset.create({
      data: {
        id: parentAssetId,
        operation: DesignAssetOperation.GENERATED,
        projectId,
        rootAssetId: parentAssetId,
        url: "https://cdn.test/parent.png",
      },
    });
  }
  const taskInput = withParent
    ? {
        ...request,
        referenceImageUrl: "https://cdn.test/parent.png",
        strength: 0.5,
        taskType: "i2i" as const,
      }
    : request;
  const task = await prisma.generationTask.create({
    data: {
      input: taskInput,
      parentAssetId,
      ...(projectless ? {} : { projectId }),
      status,
      taskType: taskInput.taskType,
      userId: user.id,
      ...(status === GenerationTaskStatus.CANCELED
        ? { canceledAt: new Date(), completedAt: new Date() }
        : {}),
    },
  });
  return { parentAssetId, task, userId: user.id };
}

async function cleanup(userId: string): Promise<void> {
  await prisma.user.delete({ where: { id: userId } });
}
