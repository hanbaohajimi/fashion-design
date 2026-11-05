import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, DesignAssetOperation } from "@fashion/db";
import { BillingService } from "@fashion/billing";
import {
  AiRuntimeService,
  AmuxAdapter,
  createReferenceImageLoader,
} from "@fashion/ai";
import type { GenerationJobData, OutfitSnapshotView } from "@fashion/shared";
import { Queue, QueueEvents, Worker } from "bullmq";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { GenerationService } from "../generation/generation.service";
import { BullGenerationJobs } from "../generation/generation-queue.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { S3FileStorage } from "../files/storage.service";
import { createGenerationProcessor } from "../../../../worker/src/processors/generation.processor";
import { S3ThumbnailStorage } from "../../../../worker/src/storage";
import { WardrobeService } from "./wardrobe.service";

describe.skipIf(process.env.RUN_WARDROBE_LOCAL_INTEGRATION !== "1")(
  "衣架真实接纳 / BullMQ / Worker / 私有图片闭环（仅本机 HTTP 图片替身）",
  () => {
    const suffix = randomUUID();
    const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    const apiStorage = new S3FileStorage();
    const access = new ProjectAccessPolicy(prisma);
    const billing = new BillingService(prisma);
    const jobs = new BullGenerationJobs();
    const keys = new Set<string>();
    let queue: Queue<GenerationJobData>;
    let events: QueueEvents;
    let worker: Worker<GenerationJobData>;
    let server: Server;
    let generation: GenerationService;
    let wardrobe: WardrobeService;
    let userId: string;
    let workspaceId: string;
    let projectId: string;
    let modelId: string;
    let sourceId: string;
    let snapshot: OutfitSnapshotView;
    let savedResultId: string;
    let mode: "success" | "failure" | "held" = "success";
    let releaseResponse: (() => void) | undefined;
    let requestArrived: (() => void) | undefined;
    let localHttpRequests = 0;
    let lastImageCount = 0;
    let sourceBytes: Buffer;
    const nativeFetch = globalThis.fetch;

    async function seedAsset() {
      const id = randomUUID();
      const key = `wardrobe-pipeline/${suffix}/${id}.png`;
      keys.add(key);
      await apiStorage.uploadBuffer(
        key,
        sourceBytes,
        "image/png",
        createHash("sha256").update(sourceBytes).digest("base64"),
      );
      await prisma.designAsset.create({
        data: {
          id,
          projectId,
          rootAssetId: id,
          operation: DesignAssetOperation.GENERATED,
          url: `s3://${key}`,
          width: 64,
          height: 64,
        },
      });
      return id;
    }
    async function completed(taskId: string | null) {
      if (!taskId) throw new Error("任务没有接纳");
      const job = await queue.getJob(taskId);
      if (!job) throw new Error("真实隔离队列缺少任务");
      return job.waitUntilFinished(events, 20_000);
    }

    beforeAll(async () => {
      const database = new URL(
        process.env.WARDROBE_TEST_DATABASE_URL ?? "http://invalid",
      );
      if (
        process.env.DATABASE_URL !== process.env.WARDROBE_TEST_DATABASE_URL ||
        !localHosts.has(database.hostname) ||
        !database.searchParams.get("schema")?.startsWith("wardrobe_verify_")
      )
        throw new Error("只允许独立本机衣架测试 schema");
      const schemaRows = await prisma.$queryRaw<
        Array<{ current_schema: string }>
      >`SELECT current_schema()`;
      if (schemaRows[0]?.current_schema !== database.searchParams.get("schema"))
        throw new Error("原生 SQL search_path 未隔离，禁止执行计费/队列测试");
      for (const endpoint of [process.env.REDIS_URL, process.env.S3_ENDPOINT])
        if (!endpoint || !localHosts.has(new URL(endpoint).hostname))
          throw new Error("仅允许本机 Redis 和 MinIO");
      vi.stubGlobal(
        "fetch",
        (
          input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ) => {
          const url = new URL(
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url,
          );
          if (!localHosts.has(url.hostname))
            throw new Error("集成测试禁止外网 HTTP");
          return nativeFetch(input, init);
        },
      );
      sourceBytes = await sharp({
        create: {
          width: 64,
          height: 64,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([
          {
            input: await sharp({
              create: {
                width: 24,
                height: 40,
                channels: 4,
                background: "green",
              },
            })
              .png()
              .toBuffer(),
            left: 20,
            top: 12,
          },
        ])
        .png()
        .toBuffer();
      server = createServer((request, response) => {
        if (request.url !== "/v1/images/edits" || request.method !== "POST") {
          response.writeHead(404).end();
          return;
        }
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          localHttpRequests++;
          lastImageCount = (
            Buffer.concat(chunks)
              .toString("latin1")
              .match(/name="image"/gu) ?? []
          ).length;
          const respond = () => {
            if (response.writableEnded || response.headersSent) return;
            response.writeHead(mode === "failure" ? 400 : 200, {
              "Content-Type": "application/json",
            });
            response.end(
              JSON.stringify(
                mode === "failure"
                  ? {
                      error: {
                        message: "local deterministic provider rejection",
                      },
                    }
                  : { data: [{ b64_json: sourceBytes.toString("base64") }] },
              ),
            );
          };
          if (mode === "held") {
            releaseResponse = respond;
            requestArrived?.();
          } else respond();
        });
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("本机图片替身未启动");
      const provider = new AmuxAdapter(
        {
          apiKey: () => "local-fixture-only",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          imageModel: "mock/wardrobe-no-paid",
          quality: "low",
          imageCostUsd: 0,
          editCostUsd: 0,
          creditsPerUsd: 0,
        },
        undefined,
        createReferenceImageLoader({
          allowedOrigins: [
            new URL(process.env.S3_ENDPOINT ?? "http://invalid").origin,
          ],
        }),
      );
      const ai = new AiRuntimeService([provider], {
        primaryProvider: "amux",
        timeoutMs: 20_000,
        retryBaseMs: 1,
        maxRetries: 0,
      });
      const actualStorage = new S3ThumbnailStorage();
      const processor = createGenerationProcessor({
        database: prisma,
        billing,
        ai,
        timeoutMs: 25_000,
        pollIntervalMs: 10,
        moderator: {
          moderate: async () => ({ status: "approved", categories: [] }),
        },
        storage: {
          get: (key) => actualStorage.get(key),
          delete: (key) => actualStorage.delete(key),
          downloadUrl: (key) => actualStorage.downloadUrl(key),
          put: async (key, bytes, type) => {
            keys.add(key);
            await actualStorage.put(key, bytes, type);
          },
        },
      });
      const redis = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
      const connection = {
        host: redis.hostname.replace(/^\[|\]$/gu, ""),
        port: Number(redis.port || 6379),
        username: redis.username
          ? decodeURIComponent(redis.username)
          : undefined,
        password: redis.password
          ? decodeURIComponent(redis.password)
          : undefined,
      };
      const name = `wardrobe-generation-${suffix}`;
      const prefix = `wardrobe-verify-${suffix}`;
      queue = new Queue(name, { connection, prefix });
      events = new QueueEvents(name, { connection, prefix });
      await events.waitUntilReady();
      // Inject only this unique queue into the production queue adapter; its default queue is never opened.
      Object.assign(jobs, { queue });
      worker = new Worker(name, (job) => processor(job), {
        connection,
        prefix,
        concurrency: 1,
      });
      await worker.waitUntilReady();
      generation = new GenerationService(
        prisma,
        jobs,
        billing,
        {
          compile: async () => {
            throw new Error("衣架入口不得调用提示词模型");
          },
        } as never,
        apiStorage,
        access,
      );
      wardrobe = new WardrobeService(prisma, access, apiStorage, generation);
      userId = (
        await prisma.user.create({
          data: {
            email: `wardrobe-pipeline-${suffix}@example.com`,
            generationLimit: 20,
          },
        })
      ).id;
      workspaceId = (
        await prisma.workspace.create({
          data: { ownerId: userId, name: "隔离真实队列验证" },
        })
      ).id;
      projectId = (
        await prisma.project.create({
          data: { wsId: workspaceId, name: "衣架真实管线" },
        })
      ).id;
      sourceId = await seedAsset();
      modelId = await seedAsset();
    }, 30_000);

    afterAll(async () => {
      releaseResponse?.();
      wardrobe?.onModuleDestroy();
      await worker?.close();
      await events?.close();
      if (queue) {
        await queue.obliterate({ force: true });
        await jobs.onModuleDestroy();
      }
      if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      if (projectId) {
        await prisma.wardrobeTryOn.deleteMany({ where: { projectId } });
        await prisma.wardrobeOutfit.deleteMany({ where: { projectId } });
        await prisma.wardrobeItem.deleteMany({ where: { projectId } });
      }
      if (workspaceId)
        await prisma.workspace.delete({ where: { id: workspaceId } });
      if (userId) await prisma.user.delete({ where: { id: userId } });
      for (const key of keys) await apiStorage.delete(key);
      vi.unstubAllGlobals();
      await prisma.$disconnect();
      writeFileSync(
        "../../output/wardrobe/pipeline-report.json",
        JSON.stringify(
          {
            providerRequests: 0,
            localMockHttpRequests: localHttpRequests,
            productionAdmission: true,
            productionQueueAdapter: true,
            productionWorkerProcessor: true,
            database: "isolated-local-schema",
            queue: `wardrobe-generation-${suffix}`,
            redisPrefix: `wardrobe-verify-${suffix}`,
            storage: "real-local-private-MinIO",
            moderation: "deterministic-approved-stub",
            garmentSemantics: "not-validated",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
    }, 30_000);

    it("对尚未确认的生成候选再提取时保留祖先补全标记与原设计血缘", async () => {
      const first = await wardrobe.prepare(userId, projectId, {
        requestKey: randomUUID(),
        sourceAssetId: sourceId,
        name: "草图转换候选",
        category: "top",
        sourceKind: "sketch",
        mode: "complete",
      });
      if (first.error) throw new Error(first.error);
      await completed(first.taskId);
      const firstCandidate = (await wardrobe.summary(userId, projectId))
        .preparations.find((row) => row.id === first.id)?.candidates[0];
      if (!firstCandidate) throw new Error("缺少首次生成候选");
      expect(await prisma.wardrobeRevision.count({
        where: { assetId: firstCandidate.assetId },
      })).toBe(0);
      const second = await wardrobe.prepare(userId, projectId, {
        requestKey: randomUUID(),
        sourceAssetId: firstCandidate.assetId,
        name: "再提取候选",
        category: "top",
        sourceKind: "isolated",
        mode: "extract",
      });
      if (second.error) throw new Error(second.error);
      await completed(second.taskId);
      const secondCandidate = (await wardrobe.summary(userId, projectId))
        .preparations.find((row) => row.id === second.id)?.candidates[0];
      if (!secondCandidate) throw new Error("缺少再提取候选");
      const item = await wardrobe.confirm(userId, projectId, {
        requestKey: randomUUID(),
        preparationId: second.id,
        assetId: secondCandidate.assetId,
        name: "来源保留测试",
        category: "top",
        display: "hanger",
        reviewed: true,
      });
      expect(item.currentRevision).toMatchObject({
        sourceAssetId: firstCandidate.assetId,
        sourceKind: "isolated",
        generatedCompletion: true,
      });
      expect(await prisma.designAsset.findUniqueOrThrow({
        where: { id: secondCandidate.assetId },
      })).toMatchObject({
        parentAssetId: firstCandidate.assetId,
        rootAssetId: sourceId,
      });
    });

    it("真实接纳与图片提取任务经独立队列、实际Worker、HTTP替身生成私有候选", async () => {
      const prepared = await wardrobe.prepare(userId, projectId, {
        requestKey: randomUUID(),
        sourceAssetId: sourceId,
        name: "模拟上衣",
        category: "top",
        sourceKind: "isolated",
        mode: "extract",
      });
      if (prepared.error) throw new Error(`真实接纳失败：${prepared.error}`);
      await completed(prepared.taskId);
      const after = (
        await wardrobe.summary(userId, projectId)
      ).preparations.find((item) => item.id === prepared.id);
      expect(after?.status).toBe("ready");
      const candidate = after?.candidates[0];
      if (!candidate) throw new Error("缺少实际生成候选");
      const item = await wardrobe.confirm(userId, projectId, {
        requestKey: randomUUID(),
        preparationId: prepared.id,
        assetId: candidate.assetId,
        name: "模拟上衣",
        category: "top",
        display: "hanger",
        reviewed: true,
      });
      const bag = await wardrobe.confirm(userId, projectId, {
        requestKey: randomUUID(),
        preparationId: prepared.id,
        assetId: candidate.assetId,
        name: "测试第二件引用",
        category: "bag",
        display: "hook",
        reviewed: true,
      });
      snapshot = await wardrobe.saveTrialSnapshot(userId, projectId, {
        requestKey: randomUUID(),
        name: "两件模拟组合",
        items: [
          { revisionId: item.currentRevision.id, layer: 0 },
          { revisionId: bag.currentRevision.id, layer: 1 },
        ],
      });
      expect(
        await prisma.generationTask.findUniqueOrThrow({
          where: { id: prepared.taskId ?? "" },
        }),
      ).toMatchObject({
        status: "SUCCEEDED",
        countedAt: expect.any(Date),
        compiledPrompt: { presentationPolicy: { mode: "garment_only" } },
      });
    }, 30_000);

    it("静态多件完整参考经实际生成链路落资产，并保留原始模特及快照来源", async () => {
      const request = {
        requestKey: randomUUID(),
        snapshotId: snapshot.id,
        modelAssetId: modelId,
      };
      const run = await wardrobe.tryOn(userId, projectId, request);
      await completed(run.taskId);
      const result = (await wardrobe.summary(userId, projectId)).tryOns.find(
        (item) => item.id === run.id,
      );
      expect(result?.status).toBe("ready");
      expect(lastImageCount).toBe(3);
      savedResultId = result?.results[0]?.assetId ?? "";
      const asset = await prisma.designAsset.findUniqueOrThrow({
        where: { id: savedResultId },
      });
      expect(asset.parentAssetId).toBe(modelId);
      expect((await apiStorage.head(asset.url.slice(5))).contentType).toBe(
        "image/png",
      );
      const step = await prisma.designStep.findUniqueOrThrow({
        where: { generationTaskId: run.taskId ?? "" },
      });
      expect(step.inputSnapshot).toMatchObject({
        parameters: { outfitSnapshotId: snapshot.id },
        sources: expect.arrayContaining([
          expect.objectContaining({ assetId: modelId }),
          expect.objectContaining({ assetId: snapshot.items[0]?.assetId }),
        ]),
      });
      const httpBefore = localHttpRequests;
      expect((await wardrobe.tryOn(userId, projectId, request)).taskId).toBe(
        run.taskId,
      );
      expect(localHttpRequests).toBe(httpBefore);
    }, 30_000);

    it("真实失败和运行中取消均不覆盖旧结果，不写入失败/取消候选", async () => {
      const countBefore = (await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      })).generationCount;
      const original = await prisma.designAsset.findUniqueOrThrow({
        where: { id: savedResultId },
      });
      mode = "failure";
      const failed = await wardrobe.tryOn(userId, projectId, {
        requestKey: randomUUID(),
        snapshotId: snapshot.id,
        modelAssetId: modelId,
      });
      await expect(completed(failed.taskId)).rejects.toThrow();
      expect(
        (
          await prisma.generationTask.findUniqueOrThrow({
            where: { id: failed.taskId ?? "" },
          })
        ).status,
      ).toBe("FAILED");
      mode = "held";
      const arrived = new Promise<void>((resolve) => {
        requestArrived = resolve;
      });
      const canceled = await wardrobe.tryOn(userId, projectId, {
        requestKey: randomUUID(),
        snapshotId: snapshot.id,
        modelAssetId: modelId,
      });
      await arrived;
      await generation.cancel(userId, canceled.taskId ?? "");
      releaseResponse?.();
      await completed(canceled.taskId);
      expect(
        (
          await prisma.generationTask.findUniqueOrThrow({
            where: { id: canceled.taskId ?? "" },
          })
        ).status,
      ).toBe("CANCELED");
      expect(
        await prisma.designAsset.count({
          where: {
            generationTaskId: {
              in: [failed.taskId ?? "", canceled.taskId ?? ""],
            },
          },
        }),
      ).toBe(0);
      expect(
        await prisma.designAsset.findUniqueOrThrow({
          where: { id: savedResultId },
        }),
      ).toEqual(original);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: userId } }))
          .generationCount,
      ).toBe(countBefore);
    }, 30_000);
  },
);
