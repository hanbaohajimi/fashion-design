import {
  AiProviderError,
  type AiGenerationRequest,
  type AiProviderJob,
} from "@fashion/ai";
import { BillingService } from "@fashion/billing";
import { prisma, type Prisma } from "@fashion/db";
import type { GenerationJobData } from "@fashion/shared";
import { Queue, QueueEvents, Worker } from "bullmq";
import sharp from "sharp";
import { afterAll, describe, expect, it, vi } from "vitest";
import { S3ThumbnailStorage, type ThumbnailStorage } from "../storage";
import { createGenerationProcessor } from "./generation.processor";
import { createImageEditCleanupProcessor } from "./image-edit-cleanup.processor";
import {
  createImageEditCleanupJobs,
  type ImageEditCleanupJobData,
} from "../queues/image-edit-cleanup.queue";

// Real database, Redis jobs and private object storage; the provider is local
// and deterministic. No provider adapter or paid generation service is loaded.
const frame = { width: 1024, height: 1024, left: 32, top: 48 };

async function exerciseEdit(
  intent: "outpaint" | "remove_background" | "edit" | "inpaint" | "feedback",
  result: { bytes: Buffer; contentType: string },
  verify: (fixture: Awaited<ReturnType<typeof prepareEdit>>) => Promise<void>,
) {
  const fixture = await prepareEdit(intent, result);
  try {
    await verify(fixture);
  } finally {
    await fixture.cleanup();
  }
}

async function prepareEdit(
  intent: "outpaint" | "remove_background" | "edit" | "inpaint" | "feedback",
  result: { bytes: Buffer; contentType: string },
) {
  const id = crypto.randomUUID();
  const storage = new S3ThumbnailStorage();
  const keys = new Set<string>();
  const writes: { key: string; contentType: string }[] = [];
  const tracked: ThumbnailStorage = {
    get: (key) => storage.get(key),
    downloadUrl: (key) => storage.downloadUrl(key),
    delete: vi.fn((key) => storage.delete(key)),
    put: async (key, body, contentType) => {
      keys.add(key);
      await storage.put(key, body, contentType);
      writes.push({ key, contentType });
    },
  };
  const user = await prisma.user.create({
    data: {
      email: `image-edit-${id}@example.com`,
      generationLimit: 100,
      ownedWorkspaces: {
        create: {
          name: "图片编辑验证",
          projects: { create: { name: "图片编辑" } },
        },
      },
    },
    include: { ownedWorkspaces: { include: { projects: true } } },
  });
  const redis = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:16379");
  const connection = {
    host: redis.hostname,
    port: Number(redis.port || 6379),
    username: redis.username || undefined,
    password: redis.password || undefined,
  };
  const queueName = `image-edit-test-${id}`;
  const queue = new Queue<GenerationJobData>(queueName, { connection });
  const events = new QueueEvents(queueName, { connection });
  const cleanupQueue = new Queue<ImageEditCleanupJobData>(
    `${queueName}-cleanup`,
    { connection },
  );
  const cleanupEvents = new QueueEvents(`${queueName}-cleanup`, { connection });
  const imageInputCleanup = createImageEditCleanupJobs(cleanupQueue, 0);
  imageInputCleanup.enqueue = vi.fn(imageInputCleanup.enqueue);
  let worker: Worker<GenerationJobData> | undefined;
  let cleanupWorker: Worker<ImageEditCleanupJobData> | undefined;
  const cleanup = async () => {
    await worker?.close();
    await cleanupWorker?.close();
    await events.close();
    await cleanupEvents.close();
    await queue.obliterate({ force: true });
    await cleanupQueue.obliterate({ force: true });
    await queue.close();
    await cleanupQueue.close();
    await Promise.all([...keys].map((key) => storage.delete(key)));
    await prisma.workspace.deleteMany({ where: { ownerId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  };
  try {
    const project = user.ownedWorkspaces[0]?.projects[0];
    if (!project) throw new Error("测试项目缺失");
    const sourceKey = `integration/image-edit/${id}/original.png`;
    const sourcePixels = Buffer.alloc(16 * 16 * 4);
    for (let offset = 0; offset < sourcePixels.length; offset += 4) {
      sourcePixels[offset] = 90;
      sourcePixels[offset + 1] = 150;
      sourcePixels[offset + 2] = 210;
      sourcePixels[offset + 3] = [0, 64, 128, 255][(offset / 4) % 4] ?? 255;
    }
    const source = await sharp(sourcePixels, {
      raw: { width: 16, height: 16, channels: 4 },
    })
      .png()
      .toBuffer();
    await tracked.put(sourceKey, source, "image/png");
    const maskKey = `integration/image-edit/${id}/mask.png`;
    const maskPixels = Buffer.alloc(16 * 16 * 4);
    for (let offset = 0; offset < maskPixels.length; offset += 4)
      maskPixels[offset + 3] = [255, 255, 128, 0][(offset / 4) % 4] ?? 255;
    const mask = await sharp(maskPixels, {
      raw: { width: 16, height: 16, channels: 4 },
    })
      .png()
      .toBuffer();
    if (intent === "inpaint") await tracked.put(maskKey, mask, "image/png");
    const parent = await prisma.designAsset.create({
      data: {
        id,
        projectId: project.id,
        operation: "GENERATED",
        rootAssetId: id,
        url: `s3://${sourceKey}`,
        width: 16,
        height: 16,
      },
    });
    const input: AiGenerationRequest = {
      ...(intent === "inpaint"
        ? {
            taskType: "inpaint" as const,
            maskImageUrl: "https://expired.invalid/mask.png",
          }
        : { taskType: "i2i" as const }),
      prompt: "验证图片编辑与原图保护",
      width: 1024,
      height: 1024,
      referenceImageUrl: await storage.downloadUrl(sourceKey),
      ...(intent === "inpaint"
        ? {}
        : {
            imageEdit: {
              intent,
              ...(intent === "outpaint" ? { outpaint: frame } : {}),
            },
          }),
    };
    const task = await prisma.generationTask.create({
      data: {
        userId: user.id,
        projectId: project.id,
        parentAssetId: parent.id,
        taskType: input.taskType,
        input,
        ...(intent === "inpaint"
          ? {
              compiledPrompt: {
                inpaintSource: {
                  version: 1,
                  sourceObjectKey: sourceKey,
                  maskObjectKey: maskKey,
                },
              },
            }
          : {}),
      },
    });
    const remote: AiProviderJob = {
      provider: "mock",
      providerJobId: `local-${id}`,
      model: "local/image-edit-test",
      taskType: input.taskType,
      submittedAt: new Date().toISOString(),
      cost: {
        rawCost: 0,
        credits: 0,
        currency: "USD",
        billableMegapixels: 1,
        estimated: true,
      },
      completedResult: {
        images: [
          {
            url: `data:${result.contentType};base64,${result.bytes.toString("base64")}`,
          },
        ],
      },
    };
    const ai = {
      submit: vi
        .fn<(request: AiGenerationRequest) => Promise<AiProviderJob>>()
        .mockResolvedValue(remote),
      getStatus: vi.fn(async () => ({ status: "completed" as const })),
      getResult: vi.fn(async () => ({
        job: remote,
        images: remote.completedResult?.images ?? [],
        cost: remote.cost,
      })),
    };
    const processor = createGenerationProcessor({
      ai,
      billing: new BillingService(prisma),
      database: prisma,
      storage: tracked,
      imageInputCleanup,
      moderator: {
        moderate: async () => ({ status: "approved", categories: [] }),
      },
      pollIntervalMs: 1,
    });
    worker = new Worker<GenerationJobData>(queueName, (job) => processor(job), {
      connection,
    });
    await events.waitUntilReady();
    await worker.waitUntilReady();
    await cleanupEvents.waitUntilReady();
    const startCleanup = async (graceMs = 0, retryMs = 50) => {
      cleanupWorker = new Worker<ImageEditCleanupJobData>(
        `${queueName}-cleanup`,
        createImageEditCleanupProcessor({
          database: prisma,
          storage: tracked,
          graceMs,
          retryMs,
        }),
        { connection },
      );
      await cleanupWorker.waitUntilReady();
      return cleanupWorker;
    };
    const run = async (jobId: string = task.id, attempts = 1) => {
      const job = await queue.add(
        "image-edit",
        { taskId: task.id, userId: user.id },
        { jobId, attempts },
      );
      return job.waitUntilFinished(events, 15_000);
    };
    return {
      ai,
      cleanup,
      input,
      keys,
      parent,
      project,
      result,
      run,
      source,
      sourceKey,
      sourcePixels,
      storage,
      task,
      user,
      writes,
      mask,
      maskKey,
      tracked,
      remote,
      queue,
      cleanupQueue,
      cleanupEvents,
      imageInputCleanup,
      startCleanup,
      stopGeneration: async () => worker?.close(),
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

describe("图片编辑真实保存链路", () => {
  afterAll(async () => prisma.$disconnect());

  it("编号意见实际传递原图、标记图与面料参考，终态清理临时图且重放不重复提交", async () => {
    const bytes = await sharp({ create: { width: 16, height: 16, channels: 4, background: "blue" } }).png().toBuffer();
    await exerciseEdit("feedback", { bytes, contentType: "image/png" }, async (f) => {
      const fabricKey = `integration/image-edit/${f.task.id}/fabric.png`;
      const fabric = await sharp({ create: { width: 16, height: 16, channels: 4, background: "green" } }).png().toBuffer();
      await f.tracked.put(fabricKey, fabric, "image/png");
      const fabricUrl = await f.storage.downloadUrl(fabricKey);
      if (f.input.taskType !== "i2i") throw new Error("图片意见必须使用图片编辑夹具");
      const input: AiGenerationRequest = {
        ...f.input,
        prompt: "意见 2，标记 2 (0.750,0.500)：收窄袖口，保留面料纹理",
        imageEdit: { intent: "feedback", markers: [{ number: 2, point: { x: .75, y: .5 } }] },
        referenceImages: [{ url: fabricUrl, order: 0, role: "fabric_texture", weight: .7 }],
      };
      await prisma.generationTask.update({ where: { id: f.task.id }, data: { input } });
      f.ai.submit.mockImplementationOnce(async request => {
        if (request.taskType !== "i2i") throw new Error("图片意见必须进入图片编辑");
        expect(request.imageEdit?.markers).toEqual(input.imageEdit?.markers);
        expect(request.prompt).toContain("意见 2，标记 2");
        expect(request.referenceImageUrls).toHaveLength(3);
        expect(request.referenceImages?.map(({ order, role, weight }) => ({ order, role, weight }))).toEqual([
          { order: 0, role: "style_ref", weight: 1 },
          { order: 1, role: "detail_ref", weight: 1 },
          { order: 2, role: "fabric_texture", weight: .7 },
        ]);
        const urls = request.referenceImageUrls ?? [];
        const read = async (url: string | undefined) => {
          if (!url) throw new Error("图片参考缺失");
          const response = await fetch(url);
          expect(response.status).toBe(200);
          return Buffer.from(await response.arrayBuffer());
        };
        expect(await read(urls[0])).toEqual(f.source);
        const marked = await read(urls[1]);
        expect(await sharp(marked).metadata()).toMatchObject({ width: 16, height: 16, format: "png" });
        const region = { left: 7, top: 4, width: 8, height: 8 };
        expect(await sharp(marked).extract(region).raw().toBuffer()).not.toEqual(await sharp(f.source).extract(region).raw().toBuffer());
        const corner = { left: 0, top: 0, width: 2, height: 2 };
        expect(await sharp(marked).extract(corner).flatten({ background: "white" }).raw().toBuffer()).toEqual(await sharp(f.source).extract(corner).flatten({ background: "white" }).raw().toBuffer());
        expect(await read(urls[2])).toEqual(fabric);
        return f.remote;
      });
      await expect(f.run()).resolves.toMatchObject({ status: "succeeded" });
      const asset = await prisma.designAsset.findFirstOrThrow({ where: { generationTaskId: f.task.id } });
      expect(asset).toMatchObject({ parentAssetId: f.parent.id, operation: "VARIATION" });
      expect(await sharp(await f.storage.get(asset.url.slice(5))).raw().toBuffer()).toEqual(await sharp(bytes).raw().toBuffer());
      await expect(f.storage.get(`image-edit/${f.task.id}/annotations.png`)).rejects.toMatchObject({ name: "NoSuchKey" });
      expect(await f.storage.get(f.sourceKey)).toEqual(f.source);
      expect(await f.storage.get(fabricKey)).toEqual(fabric);
      await expect(f.run(`${f.task.id}-replay`)).resolves.toMatchObject({ skipped: true, status: "succeeded" });
      expect(f.ai.submit).toHaveBeenCalledOnce();
      expect(await prisma.designAsset.count({ where: { generationTaskId: f.task.id } })).toBe(1);
    });
  }, 30_000);

  it("局部重绘忽略过期链接，真实私有输入副本、PNG输出与选区保护一致", async () => {
    const bytes = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "blue" },
    })
      .png()
      .toBuffer();
    await exerciseEdit(
      "inpaint",
      { bytes, contentType: "image/png" },
      async (f) => {
        f.ai.submit.mockImplementationOnce(async (request) => {
          if (request.taskType !== "inpaint")
            throw new Error("inpaint required");
          const source = await fetch(request.referenceImageUrl);
          expect(source.status).toBe(200);
          expect(Buffer.from(await source.arrayBuffer())).toEqual(f.source);
          const selection = await fetch(request.maskImageUrl);
          expect(Buffer.from(await selection.arrayBuffer())).toEqual(f.mask);
          return f.remote;
        });
        await expect(f.run()).resolves.toMatchObject({ status: "succeeded" });
        const asset = await prisma.designAsset.findFirstOrThrow({
          where: { generationTaskId: f.task.id },
        });
        expect(asset).toMatchObject({
          operation: "INPAINT",
          parentAssetId: f.parent.id,
          width: 16,
          height: 16,
        });
        const response = await fetch(
          await f.storage.downloadUrl(asset.url.slice(5)),
        );
        expect(response.headers.get("content-type")).toBe("image/png");
        const rgba = await sharp(Buffer.from(await response.arrayBuffer()))
          .raw()
          .toBuffer();
        for (let offset = 0; offset < rgba.length; offset += 16) {
          expect(rgba.subarray(offset, offset + 8)).toEqual(
            f.sourcePixels.subarray(offset, offset + 8),
          );
          expect([...rgba.subarray(offset + 8, offset + 16)]).toEqual([
            30, 50, 240, 191, 0, 0, 255, 255,
          ]);
        }
        for (const name of ["inpaint-source.png", "inpaint-mask.png"])
          await expect(
            f.storage.get(`image-edit/${f.task.id}/${name}`),
          ).rejects.toMatchObject({ name: "NoSuchKey" });
        expect(await f.storage.get(f.sourceKey)).toEqual(f.source);
        expect(await f.storage.get(f.maskKey)).toEqual(f.mask);
      },
    );
  }, 30_000);

  it("暂时失败保留输入副本，重试即使原素材不再可读仍复用同一输入", async () => {
    const bytes = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "blue" },
    })
      .png()
      .toBuffer();
    await exerciseEdit(
      "inpaint",
      { bytes, contentType: "image/png" },
      async (f) => {
        f.ai.submit.mockImplementationOnce(async () => {
          await expect(
            f.storage.get(`image-edit/${f.task.id}/inpaint-mask.png`),
          ).resolves.toEqual(f.mask);
          // Simulate the originals being unavailable without deleting user assets.
          const read = f.tracked.get;
          f.tracked.get = (key) =>
            key === f.sourceKey || key === f.maskKey
              ? Promise.reject(new Error("original temporarily offline"))
              : read(key);
          throw new AiProviderError({
            provider: "mock",
            code: "PROVIDER_UNAVAILABLE",
            message: "temporary",
            retryable: true,
          });
        });
        await expect(f.run(f.task.id, 2)).resolves.toMatchObject({
          status: "succeeded",
        });
        expect(f.ai.submit).toHaveBeenCalledTimes(2);
        expect(
          f.writes.filter((write) =>
            write.key.startsWith(`image-edit/${f.task.id}/`),
          ),
        ).toHaveLength(2);
        expect(
          (
            await prisma.generationTask.findUniqueOrThrow({
              where: { id: f.task.id },
            })
          ).attemptCount,
        ).toBe(2);
        await expect(
          f.storage.get(`image-edit/${f.task.id}/inpaint-mask.png`),
        ).rejects.toMatchObject({ name: "NoSuchKey" });
        expect(await f.storage.get(f.maskKey)).toEqual(f.mask);
      },
    );
  }, 30_000);

  it("已有远端作业重试只恢复结果，不再提交或重写局部编辑输入", async () => {
    const bytes = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "blue" },
    })
      .png()
      .toBuffer();
    await exerciseEdit(
      "inpaint",
      { bytes, contentType: "image/png" },
      async (f) => {
        const asynchronous = { ...f.remote };
        delete asynchronous.completedResult;
        f.ai.submit.mockResolvedValue(asynchronous);
        f.ai.getStatus.mockRejectedValueOnce(
          new Error("temporary status outage"),
        );
        await expect(f.run(f.task.id, 2)).resolves.toMatchObject({
          status: "succeeded",
        });
        expect(f.ai.submit).toHaveBeenCalledOnce();
        expect(f.ai.getStatus).toHaveBeenCalledTimes(2);
        expect(
          f.writes.filter((write) =>
            write.key.startsWith(`image-edit/${f.task.id}/`),
          ),
        ).toHaveLength(2);
        await expect(
          f.storage.get(`image-edit/${f.task.id}/inpaint-source.png`),
        ).rejects.toMatchObject({ name: "NoSuchKey" });
      },
    );
  }, 30_000);

  it("输入写入中断后清理已上传部分，蒙版不合法时不调用模型", async () => {
    const bytes = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "blue" },
    })
      .png()
      .toBuffer();
    await exerciseEdit(
      "inpaint",
      { bytes, contentType: "image/png" },
      async (f) => {
        const put = f.tracked.put;
        f.tracked.put = (key, body, mime) =>
          key.endsWith("/inpaint-mask.png")
            ? Promise.reject(new Error("mask upload failed"))
            : put(key, body, mime);
        await expect(f.run()).rejects.toThrow();
        expect(f.ai.submit).not.toHaveBeenCalled();
        await expect(
          f.storage.get(`image-edit/${f.task.id}/inpaint-source.png`),
        ).rejects.toMatchObject({ name: "NoSuchKey" });
        expect(await f.storage.get(f.maskKey)).toEqual(f.mask);
      },
    );
    await exerciseEdit(
      "inpaint",
      { bytes, contentType: "image/png" },
      async (f) => {
        await f.storage.put(f.maskKey, bytes, "image/png");
        await expect(f.run(f.task.id, 2)).rejects.toThrow("还没有选择");
        expect(f.ai.submit).not.toHaveBeenCalled();
        expect(
          (
            await prisma.generationTask.findUniqueOrThrow({
              where: { id: f.task.id },
            })
          ).errorCode,
        ).toBe("IMAGE_EDIT_INVALID_INPUT");
      },
    );
  }, 30_000);

  it("删除暂不可用不改变成功结果，终态重放补偿清理且不重复计次", async () => {
    const bytes = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "blue" },
    })
      .png()
      .toBuffer();
    await exerciseEdit(
      "inpaint",
      { bytes, contentType: "image/png" },
      async (f) => {
        const remove = f.tracked.delete;
        f.tracked.delete = vi.fn(async () => {
          throw new Error("storage temporarily unavailable");
        });
        await expect(f.run()).resolves.toMatchObject({ status: "succeeded" });
        expect(
          await f.storage.get(`image-edit/${f.task.id}/inpaint-mask.png`),
        ).toEqual(f.mask);
        expect(f.tracked.delete).toHaveBeenCalledTimes(6);
        f.tracked.delete = remove;
        await expect(
          f.run(`${f.task.id}-cleanup-replay`),
        ).resolves.toMatchObject({ skipped: true, status: "succeeded" });
        await expect(
          f.storage.get(`image-edit/${f.task.id}/inpaint-mask.png`),
        ).rejects.toMatchObject({ name: "NoSuchKey" });
        expect(f.ai.submit).toHaveBeenCalledOnce();
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } }))
            .generationCount,
        ).toBe(1);
      },
    );
  }, 30_000);

  it("已有远端作业缺失输入副本时不重新提交，也不保存未保护结果", async () => {
    const bytes = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "blue" },
    })
      .png()
      .toBuffer();
    await exerciseEdit(
      "inpaint",
      { bytes, contentType: "image/png" },
      async (f) => {
        const remote = { ...f.remote };
        delete remote.completedResult;
        await prisma.generationTask.update({
          where: { id: f.task.id },
          data: {
            providerJob: JSON.parse(
              JSON.stringify(remote),
            ) as Prisma.InputJsonValue,
          },
        });
        await expect(f.run(f.task.id, 2)).rejects.toThrow("输入副本已丢失");
        expect(f.ai.submit).not.toHaveBeenCalled();
        expect(f.ai.getResult).not.toHaveBeenCalled();
        expect(
          await prisma.designAsset.count({
            where: { generationTaskId: f.task.id },
          }),
        ).toBe(0);
        expect(await f.storage.get(f.sourceKey)).toEqual(f.source);
      },
    );
  }, 30_000);

  it("先持久登记清理再写输入，登记失败自动重试且不会提前调用模型", async () => {
    const bytes = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "blue" },
    })
      .png()
      .toBuffer();
    await exerciseEdit(
      "inpaint",
      { bytes, contentType: "image/png" },
      async (f) => {
        vi.mocked(f.imageInputCleanup.enqueue).mockImplementationOnce(
          async () => {
            expect(
              f.writes.filter((write) =>
                write.key.startsWith(`image-edit/${f.task.id}/`),
              ),
            ).toHaveLength(0);
            expect(f.ai.submit).not.toHaveBeenCalled();
            throw new Error("cleanup queue temporarily unavailable");
          },
        );
        const put = f.tracked.put;
        f.tracked.put = async (key, body, mime) => {
          if (key.startsWith(`image-edit/${f.task.id}/`))
            expect(await f.cleanupQueue.getJob(f.task.id)).toBeDefined();
          await put(key, body, mime);
        };
        await expect(f.run(f.task.id, 2)).resolves.toMatchObject({
          status: "succeeded",
        });
        expect(f.imageInputCleanup.enqueue).toHaveBeenCalledTimes(2);
        expect(f.ai.submit).toHaveBeenCalledOnce();
      },
    );
  }, 30_000);

  it("生成进程停止后独立清理仍可重试，不重放生成、不改变成功回执", async () => {
    const bytes = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "blue" },
    })
      .png()
      .toBuffer();
    await exerciseEdit(
      "inpaint",
      { bytes, contentType: "image/png" },
      async (f) => {
        const remove = f.tracked.delete;
        f.tracked.delete = vi.fn(async () => {
          throw new Error("storage offline");
        });
        await expect(f.run()).resolves.toMatchObject({ status: "succeeded" });
        await f.stopGeneration();
        const pending = await f.cleanupQueue.getJob(f.task.id);
        if (!pending) throw new Error("持久清理记录缺失");
        const maintenance = await f.startCleanup();
        await vi.waitFor(async () => {
          const retry = await f.cleanupQueue.getJob(f.task.id);
          expect(retry?.data.failures).toBeGreaterThanOrEqual(1);
          expect(await retry?.getState()).toBe("delayed");
        });
        await maintenance.close();
        expect(
          await f.storage.get(`image-edit/${f.task.id}/inpaint-mask.png`),
        ).toEqual(f.mask);
        f.tracked.delete = remove;
        await f.startCleanup();
        await pending.waitUntilFinished(f.cleanupEvents, 5_000);
        await expect(
          f.storage.get(`image-edit/${f.task.id}/inpaint-mask.png`),
        ).rejects.toMatchObject({ name: "NoSuchKey" });
        expect(
          (
            await prisma.generationTask.findUniqueOrThrow({
              where: { id: f.task.id },
            })
          ).status,
        ).toBe("SUCCEEDED");
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } }))
            .generationCount,
        ).toBe(1);
        expect(f.ai.submit).toHaveBeenCalledOnce();
        expect(await f.storage.get(f.sourceKey)).toEqual(f.source);
      },
    );
  }, 30_000);

  it("待重试任务保留副本，取消并移除生成作业后由独立清理回收", async () => {
    const bytes = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "blue" },
    })
      .png()
      .toBuffer();
    await exerciseEdit(
      "inpaint",
      { bytes, contentType: "image/png" },
      async (f) => {
        f.ai.submit.mockRejectedValue(
          new AiProviderError({
            provider: "mock",
            code: "PROVIDER_UNAVAILABLE",
            message: "temporary",
            retryable: true,
          }),
        );
        const job = await f.queue.add(
          "generation",
          { taskId: f.task.id, userId: f.user.id },
          {
            jobId: f.task.id,
            attempts: 2,
            backoff: { type: "fixed", delay: 60_000 },
          },
        );
        await vi.waitFor(async () =>
          expect(await job.getState()).toBe("delayed"),
        );
        const pending = await f.cleanupQueue.getJob(f.task.id);
        if (!pending) throw new Error("持久清理记录缺失");
        await f.startCleanup();
        await vi.waitFor(async () =>
          expect(await pending.getState()).toBe("delayed"),
        );
        expect(f.tracked.delete).not.toHaveBeenCalled();
        expect(
          await f.storage.get(`image-edit/${f.task.id}/inpaint-source.png`),
        ).toEqual(f.source);
        await prisma.generationTask.update({
          where: { id: f.task.id },
          data: {
            status: "CANCELED",
            canceledAt: new Date(),
            completedAt: new Date(),
          },
        });
        await job.remove();
        await pending.waitUntilFinished(f.cleanupEvents, 5_000);
        await expect(
          f.storage.get(`image-edit/${f.task.id}/inpaint-source.png`),
        ).rejects.toMatchObject({ name: "NoSuchKey" });
        expect(f.ai.submit).toHaveBeenCalledOnce();
        expect(
          await prisma.designAsset.count({
            where: { generationTaskId: f.task.id },
          }),
        ).toBe(0);
      },
    );
  }, 30_000);

  it("取消发生在第一份上传之后时停止后续写入，不调用模型", async () => {
    const bytes = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "blue" },
    })
      .png()
      .toBuffer();
    await exerciseEdit(
      "inpaint",
      { bytes, contentType: "image/png" },
      async (f) => {
        const put = f.tracked.put;
        f.tracked.put = async (key, body, mime) => {
          await put(key, body, mime);
          if (key.endsWith("/inpaint-source.png"))
            await prisma.generationTask.update({
              where: { id: f.task.id },
              data: {
                status: "CANCELED",
                canceledAt: new Date(),
                completedAt: new Date(),
              },
            });
        };
        await expect(f.run()).resolves.toMatchObject({ status: "canceled" });
        expect(
          f.writes.filter((write) => write.key.endsWith("/inpaint-mask.png")),
        ).toHaveLength(0);
        expect(f.ai.submit).not.toHaveBeenCalled();
        await expect(
          f.storage.get(`image-edit/${f.task.id}/inpaint-source.png`),
        ).rejects.toMatchObject({ name: "NoSuchKey" });
      },
    );
  }, 30_000);

  it.each(["inpaint", "outpaint", "feedback"] as const)(
    "%s明确失败后清理任务副本，重放不会再次生成",
    async (intent) => {
      const bytes = await sharp({
        create: { width: 16, height: 16, channels: 4, background: "blue" },
      })
        .png()
        .toBuffer();
      await exerciseEdit(
        intent,
        { bytes, contentType: "image/png" },
        async (f) => {
          f.ai.submit.mockRejectedValue(
            new AiProviderError({
              provider: "mock",
              code: "INVALID_REQUEST",
              message: "provider denied",
              retryable: false,
            }),
          );
          await expect(f.run(f.task.id, 2)).rejects.toThrow();
          const temporary = f.writes.filter((write) =>
            write.key.startsWith(`image-edit/${f.task.id}/`),
          );
          expect(temporary.length).toBeGreaterThan(0);
          for (const item of temporary)
            await expect(f.storage.get(item.key)).rejects.toMatchObject({
              name: "NoSuchKey",
            });
          await expect(f.run(`${f.task.id}-replay`)).rejects.toThrow();
          expect(f.ai.submit).toHaveBeenCalledOnce();
          expect(await f.storage.get(f.sourceKey)).toEqual(f.source);
          expect(
            (await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } }))
              .generationCount,
          ).toBe(0);
        },
      );
    },
    30_000,
  );

  it("生成期间取消会回收输入，取消后的返回不会创建资产或增加计次", async () => {
    const bytes = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "blue" },
    })
      .png()
      .toBuffer();
    await exerciseEdit(
      "inpaint",
      { bytes, contentType: "image/png" },
      async (f) => {
        f.ai.submit.mockImplementationOnce(async () => {
          await prisma.generationTask.update({
            where: { id: f.task.id },
            data: { status: "CANCELED" },
          });
          return f.remote;
        });
        await expect(f.run()).resolves.toMatchObject({ status: "canceled" });
        expect(
          await prisma.designAsset.count({
            where: { generationTaskId: f.task.id },
          }),
        ).toBe(0);
        await expect(
          f.storage.get(`image-edit/${f.task.id}/inpaint-mask.png`),
        ).rejects.toMatchObject({ name: "NoSuchKey" });
        expect(await f.storage.get(f.maskKey)).toEqual(f.mask);
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } }))
            .generationCount,
        ).toBe(0);
      },
    );
  }, 30_000);

  it("失去执行权的旧作业不能删除新作业仍需使用的输入", async () => {
    const bytes = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "blue" },
    })
      .png()
      .toBuffer();
    await exerciseEdit(
      "inpaint",
      { bytes, contentType: "image/png" },
      async (f) => {
        f.ai.submit.mockImplementationOnce(async () => {
          await prisma.generationTask.update({
            where: { id: f.task.id },
            data: { attemptCount: { increment: 1 } },
          });
          return f.remote;
        });
        await expect(f.run()).rejects.toThrow();
        expect(
          await f.storage.get(`image-edit/${f.task.id}/inpaint-mask.png`),
        ).toEqual(f.mask);
        expect(f.tracked.delete).not.toHaveBeenCalled();
        expect(
          (
            await prisma.generationTask.findUniqueOrThrow({
              where: { id: f.task.id },
            })
          ).status,
        ).toBe("RUNNING");
      },
    );
  }, 30_000);

  it("扩图经过真实队列保存PNG，透明原图逐像素保留，重复作业不再生成或计次", async () => {
    const bytes = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: "blue" },
    })
      .jpeg()
      .toBuffer();
    await exerciseEdit(
      "outpaint",
      { bytes, contentType: "image/jpeg" },
      async (f) => {
        await expect(f.run()).resolves.toMatchObject({ status: "succeeded" });
        const assets = await prisma.designAsset.findMany({
          where: { generationTaskId: f.task.id },
        });
        expect(assets).toHaveLength(1);
        const asset = assets[0];
        if (!asset) throw new Error("扩图结果缺失");
        expect(asset).toMatchObject({
          parentAssetId: f.parent.id,
          rootAssetId: f.parent.id,
          operation: "OUTPAINT",
          width: 1024,
          height: 1024,
        });
        const saved = await f.storage.get(asset.url.slice(5));
        expect((await sharp(saved).metadata()).format).toBe("png");
        expect(
          await sharp(saved)
            .extract({
              left: frame.left,
              top: frame.top,
              width: 16,
              height: 16,
            })
            .ensureAlpha()
            .raw()
            .toBuffer(),
        ).toEqual(f.sourcePixels);
        const download = await fetch(
          await f.storage.downloadUrl(asset.url.slice(5)),
        );
        expect(download.headers.get("content-type")).toBe("image/png");
        expect(Buffer.from(await download.arrayBuffer())).toEqual(saved);
        expect(
          (
            await prisma.generationTask.findUniqueOrThrow({
              where: { id: f.task.id },
            })
          ).output,
        ).toMatchObject({ images: [{ contentType: "image/png" }] });
        expect(await f.storage.get(f.sourceKey)).toEqual(f.source);
        const writes = f.writes.length;
        await expect(f.run(`${f.task.id}-duplicate`)).resolves.toMatchObject({
          skipped: true,
          status: "succeeded",
        });
        expect(f.ai.submit).toHaveBeenCalledOnce();
        expect(f.writes).toHaveLength(writes);
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } }))
            .generationCount,
        ).toBe(1);
        const request = f.ai.submit.mock.calls[0];
        expect(request?.[0]).toMatchObject({
          taskType: "inpaint",
          width: 1024,
          height: 1024,
        });
      },
    );
  }, 30_000);

  it.each(["png", "jpeg", "webp", "avif"] as const)(
    "%s存储类型按真实编码确定，不沿用供应商错误的标签",
    async (format) => {
      const bytes = await sharp({
        create: { width: 32, height: 24, channels: 3, background: "green" },
      })
        .toFormat(format)
        .toBuffer();
      await exerciseEdit(
        "edit",
        { bytes, contentType: format === "png" ? "image/jpeg" : "image/png" },
        async (f) => {
          await f.run();
          const asset = await prisma.designAsset.findFirstOrThrow({
            where: { generationTaskId: f.task.id },
          });
          const response = await fetch(
            await f.storage.downloadUrl(asset.url.slice(5)),
          );
          expect(response.headers.get("content-type")).toBe(`image/${format}`);
          expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
        },
      );
    },
    30_000,
  );

  it("缺少扩图范围时在生成前说明原因，不自动重试", async () => {
    const bytes = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    await exerciseEdit(
      "outpaint",
      { bytes, contentType: "image/png" },
      async (f) => {
        await prisma.generationTask.update({
          where: { id: f.task.id },
          data: { input: { ...f.input, imageEdit: { intent: "outpaint" } } },
        });
        await expect(f.run(f.task.id, 2)).rejects.toThrow("扩图范围无效");
        expect(f.ai.submit).not.toHaveBeenCalled();
        expect(
          await prisma.generationTask.findUniqueOrThrow({
            where: { id: f.task.id },
          }),
        ).toMatchObject({
          status: "FAILED",
          errorCode: "IMAGE_EDIT_INVALID_INPUT",
          errorMessage: "扩图范围无效，请重新选择画布尺寸",
        });
        expect(f.writes).toEqual([
          { key: f.sourceKey, contentType: "image/png" },
        ]);
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } }))
            .generationCount,
        ).toBe(0);
      },
    );
  }, 30_000);

  it("有效去背景结果保留透明像素与来源，原图不覆写", async () => {
    const rgba = Buffer.from([
      200, 100, 50, 255, 200, 100, 50, 128, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const bytes = await sharp(rgba, {
      raw: { width: 2, height: 2, channels: 4 },
    })
      .png()
      .toBuffer();
    await exerciseEdit(
      "remove_background",
      { bytes, contentType: "image/png" },
      async (f) => {
        await f.run();
        const asset = await prisma.designAsset.findFirstOrThrow({
          where: { generationTaskId: f.task.id },
        });
        expect(asset).toMatchObject({
          parentAssetId: f.parent.id,
          operation: "REMOVE_BACKGROUND",
        });
        expect(await f.storage.get(asset.url.slice(5))).toEqual(bytes);
        expect(await f.storage.get(f.sourceKey)).toEqual(f.source);
        const anonymous = new URL(
          await f.storage.downloadUrl(asset.url.slice(5)),
        );
        anonymous.search = "";
        const response = await fetch(anonymous);
        expect(response.status).toBe(403);
        await response.body?.cancel();
      },
    );
  }, 30_000);

  it.each(["opaque", "empty"] as const)(
    "无效去背景结果%s不会保存为成功资产或计次",
    async (kind) => {
      const bytes = await sharp({
        create: {
          width: 16,
          height: 16,
          channels: 4,
          background: {
            r: 255,
            g: 255,
            b: 255,
            alpha: kind === "opaque" ? 1 : 0,
          },
        },
      })
        .png()
        .toBuffer();
      await exerciseEdit(
        "remove_background",
        { bytes, contentType: "image/png" },
        async (f) => {
          await expect(f.run(f.task.id, 2)).rejects.toThrow(
            "去背景结果缺少有效透明区域或主体",
          );
          expect(
            await prisma.designAsset.count({
              where: { generationTaskId: f.task.id },
            }),
          ).toBe(0);
          expect(
            await prisma.generationTask.findUniqueOrThrow({
              where: { id: f.task.id },
            }),
          ).toMatchObject({
            status: "FAILED",
            errorCode: "IMAGE_EDIT_INVALID_RESULT",
            errorMessage: "去背景结果缺少有效透明区域或主体，请重试",
          });
          expect(f.ai.submit).toHaveBeenCalledOnce();
          expect(
            (await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } }))
              .generationCount,
          ).toBe(0);
          expect(f.writes).toEqual([
            { key: f.sourceKey, contentType: "image/png" },
          ]);
          expect(await f.storage.get(f.sourceKey)).toEqual(f.source);
        },
      );
    },
    30_000,
  );
});
