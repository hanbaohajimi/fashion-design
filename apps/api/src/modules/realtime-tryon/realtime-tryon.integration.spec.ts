import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@fashion/db";
import { REALTIME_TRYON_CONSENT_VERSION, type ThumbnailJobData, type CreateRealtimeTryOnSession } from "@fashion/shared";
import { createHash, randomUUID } from "node:crypto";
import { Queue, QueueEvents, Worker } from "bullmq";
import sharp from "sharp";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { FilesService } from "../files/files.service";
import { S3FileStorage } from "../files/storage.service";
import { DesignAssetsService } from "../design-assets/design-assets.service";
import { createThumbnailProcessor } from "../../../../worker/src/processors/thumbnail.processor";
import { S3ThumbnailStorage } from "../../../../worker/src/storage";
import { RealtimeTryOnSessionRepository } from "./realtime-tryon-session.repository";
import { RealtimeTryOnService } from "./realtime-tryon.service";

const enabled = process.env.RUN_TRYON_LOCAL_INTEGRATION === "1";
describe.skipIf(!enabled)("实时试穿真实本地 PostgreSQL / Redis / MinIO（供应商仅Mock）", () => {
  const suffix = randomUUID();
  let userId: string;
  let otherId: string;
  let viewerId: string;
  let projectId: string;
  let garmentId: string;
  let queue: Queue<ThumbnailJobData>;
  let events: QueueEvents;
  let worker: Worker;
  let files: FilesService;
  let service: RealtimeTryOnService;
  const storage = new S3FileStorage();
  const access = new ProjectAccessPolicy(prisma);
  const assets = new DesignAssetsService(prisma, storage, access);
  const tokens = { create: vi.fn() };
  const nativeFetch = globalThis.fetch;
  const input = (): CreateRealtimeTryOnSession => ({ projectId, garmentAssetId: garmentId, consentVersion: REALTIME_TRYON_CONSENT_VERSION });
  async function upload(color: string) {
    const buffer = await sharp({ create: { width: 128, height: 96, channels: 3, background: color } }).png().toBuffer();
    const signed = await files.signUpload(userId, { projectId, mimeType: "image/png", name: `模拟输出-${color}.png`, sha256: createHash("sha256").update(buffer).digest("hex"), size: buffer.length });
    if (signed.upload) {
      const response = await fetch(signed.upload.url, { method: "PUT", headers: signed.upload.headers, body: buffer });
      expect(response.ok).toBe(true);
      await files.complete(userId, signed.file.id);
      const job = await queue.getJob(signed.file.id);
      if (job) await job.waitUntilFinished(events, 15_000);
    }
    const file = await files.get(userId, signed.file.id);
    expect(file.status).toBe("READY");
    return file;
  }
  beforeAll(async () => {
    // Refuse all production/default schemas and non-local dependencies before any write.
    const url = new URL(process.env.TRYON_TEST_DATABASE_URL ?? "http://invalid");
    if (process.env.DATABASE_URL !== process.env.TRYON_TEST_DATABASE_URL || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.searchParams.get("schema")?.startsWith("tryon_verify_")) throw new Error("需要独立的本机 tryon_verify_ schema");
    for (const endpoint of [process.env.S3_ENDPOINT, process.env.REDIS_URL]) {
      if (!endpoint || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(endpoint).hostname)) throw new Error("集成测试仅访问本机存储/队列");
    }
    vi.stubGlobal("fetch", (request: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url);
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("禁止供应商或其他外网请求");
      return nativeFetch(request, init);
    });
    const user = await prisma.user.create({ data: { email: `tryon-${suffix}@example.com` } }); userId = user.id;
    otherId = (await prisma.user.create({ data: { email: `tryon-other-${suffix}@example.com` } })).id;
    viewerId = (await prisma.user.create({ data: { email: `tryon-viewer-${suffix}@example.com` } })).id;
    const workspace = await prisma.workspace.create({ data: { name: "试穿集成测试", ownerId: userId } });
    await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: viewerId, role: "VIEWER" } });
    projectId = (await prisma.project.create({ data: { name: "模拟试穿项目", wsId: workspace.id } })).id;
    const redis = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
    const connection = { host: redis.hostname, port: Number(redis.port || 6379), username: redis.username || undefined, password: redis.password || undefined };
    const name = `tryon-local-${suffix}`;
    queue = new Queue(name, { connection });
    events = new QueueEvents(name, { connection }); await events.waitUntilReady();
    const processThumbnail = createThumbnailProcessor({ database: prisma, storage: new S3ThumbnailStorage() });
    worker = new Worker(name, async (job) => processThumbnail(job.data.fileId), { connection });
    files = new FilesService(prisma, storage, { enqueue: async (fileId) => { await queue.add("thumbnail", { fileId }, { jobId: fileId }); } }, access);
    const garment = await upload("green");
    garmentId = (await assets.importFile(userId, projectId, garment.id)).id;
    service = new RealtimeTryOnService(new RealtimeTryOnSessionRepository(prisma), access, tokens, storage);
  });
  beforeEach(async () => {
    await prisma.realtimeTryOnCapture.deleteMany();
    await prisma.realtimeTryOnSession.deleteMany();
    tokens.create.mockReset().mockImplementation(async () => ({ apiKey: "mock-short-token", expiresAt: new Date(Date.now() + 20_000).toISOString() }));
    const env = { REALTIME_TRYON_ENABLED: "true", REALTIME_TRYON_ACCESS_MODE: "internal", REALTIME_TRYON_ALLOWED_USER_IDS: `${userId},${otherId},${viewerId}`, DECART_API_KEY: "mock-permanent-key-never-used", REALTIME_TRYON_MODEL_CONFIRMED: "true", DECART_REALTIME_MODEL: "lucy-vton-3.6", REALTIME_TRYON_ALLOWED_ORIGINS: "http://localhost:3000", REALTIME_TRYON_USD_PER_SECOND: "0.02", REALTIME_TRYON_PRICE_VERIFIED_AT: "2026-10-29", REALTIME_TRYON_DAILY_BUDGET_USD: "5", REALTIME_TRYON_MAX_ACTIVE_GLOBAL: "1" };
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  });
  afterAll(async () => {
    await worker?.close();
    await events?.close();
    if (queue) { await queue.obliterate({ force: true }); await queue.close(); }
    if (userId) {
      const rows = await prisma.fileAsset.findMany({ where: { ownerId: userId } });
      await Promise.all(rows.flatMap((file) => [file.objectKey, file.thumbnail256Key, file.thumbnail1024Key].filter((key): key is string => Boolean(key)).map((key) => storage.delete(key))));
      await prisma.realtimeTryOnCapture.deleteMany(); await prisma.realtimeTryOnSession.deleteMany();
      await prisma.user.deleteMany({ where: { id: { in: [userId, otherId, viewerId] } } });
    }
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
  });
  it("并发重复请求只签发一次，响应丢失后不能再签发", async () => {
    const results = await Promise.allSettled([service.create(userId, "same-request", input()), service.create(userId, "same-request", input())]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(tokens.create).toHaveBeenCalledOnce();
    await expect(service.create(userId, "same-request", input())).rejects.toMatchObject({ response: { code: "SESSION_ALREADY_ISSUED" } });
    expect(tokens.create).toHaveBeenCalledOnce();
    expect(JSON.stringify(await prisma.realtimeTryOnSession.findMany())).not.toMatch(/mock-short-token|mock-permanent-key/u);
  });
  it("不同请求的并发决策原子化，结束仍保留风险时限和预算", async () => {
    const results = await Promise.allSettled([service.create(userId, "request-one", input()), service.create(userId, "request-two", input())]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const session = await prisma.realtimeTryOnSession.findFirstOrThrow();
    await service.end(userId, session.id, "user-stop"); await service.end(userId, session.id, "user-stop");
    expect((await prisma.realtimeTryOnSession.findUniqueOrThrow({ where: { id: session.id } })).reservedUsd.toString()).toBe("1.2");
    await expect(service.create(userId, "request-three", input())).rejects.toMatchObject({ response: { code: "TRYON_SESSION_CONFLICT" } });
  });
  it("未知签发结果保留风险和幂等记录", async () => {
    tokens.create.mockRejectedValue(new Error("mock failure"));
    await expect(service.create(userId, "unknown-request", input())).rejects.toMatchObject({ status: 503 });
    expect((await prisma.realtimeTryOnSession.findFirstOrThrow()).status).toBe("unknown");
    await expect(service.create(userId, "unknown-request", input())).rejects.toMatchObject({ status: 409 });
    expect(tokens.create).toHaveBeenCalledOnce();
  });
  it("预算按decimal精确预留，客户端结束不会退费", async () => {
    vi.stubEnv("REALTIME_TRYON_DAILY_BUDGET_USD", "1.199999");
    await expect(service.create(userId, "budget-request", input())).rejects.toMatchObject({ response: { code: "TRYON_BUDGET_EXCEEDED" } });
    expect(tokens.create).not.toHaveBeenCalled();
  });
  it("其他账号、只读角色、跨项目输入不能签发", async () => {
    await expect(service.create(otherId, "foreign-request", input())).rejects.toMatchObject({ status: 403 });
    await expect(service.create(viewerId, "readonly-request", input())).rejects.toMatchObject({ status: 403 });
    const workspace = await prisma.workspace.findFirstOrThrow({ where: { ownerId: userId } });
    const otherProject = await prisma.project.create({ data: { name: "其他项目", wsId: workspace.id } });
    await expect(service.create(userId, "wrong-project", { ...input(), projectId: otherProject.id })).rejects.toMatchObject({ status: 404 });
    expect(tokens.create).not.toHaveBeenCalled();
  });
  it("累计tick不相加、不倒退，乱序重复忽略，越权与超限拒绝", async () => {
    const session = await service.create(userId, "observe-request", input());
    await service.observe(userId, session.sessionId, { sequence: 1, generationSeconds: 10 });
    await service.observe(userId, session.sessionId, { sequence: 2, generationSeconds: 10 });
    await service.observe(userId, session.sessionId, { sequence: 3, generationSeconds: 8 });
    expect((await service.observe(userId, session.sessionId, { sequence: 2, generationSeconds: 15 })).accepted).toBe(false);
    const record = await prisma.realtimeTryOnSession.findFirstOrThrow(); expect(record.generationSeconds).toBe(10);
    await expect(service.observe(userId, session.sessionId, { sequence: 4, generationSeconds: 61 })).rejects.toMatchObject({ status: 400 });
    await expect(service.end(otherId, session.sessionId, "foreign-stop")).rejects.toMatchObject({ status: 404 });
  });
  it("模拟输出经真实上传、队列、缩略图、资产注册和授权再次读取；重复保存幂等", async () => {
    const session = await service.create(userId, "capture-request", input());
    const file = await upload("orange");
    const capture = { fileId: file.id, garmentAssetId: garmentId, garmentRevision: 2, width: 128, height: 96, capturedAt: new Date().toISOString() };
    const result = await service.capture(userId, session.sessionId, "capture-idem", capture);
    expect(await service.capture(userId, session.sessionId, "capture-idem", capture)).toEqual(result);
    const url = await assets.downloadUrl(userId, result.assetId, "content");
    expect((await sharp(Buffer.from(await (await fetch(url)).arrayBuffer())).metadata()).width).toBe(128);
    const saved = await prisma.realtimeTryOnCapture.findUniqueOrThrow({ where: { assetId: result.assetId } });
    expect(saved.metadata).toMatchObject({ source: "realtime-tryon-capture", aiGenerated: true, modelId: "lucy-vton-3.6", garmentRevision: 2 });
    await expect(service.capture(otherId, session.sessionId, "foreign-capture", capture)).rejects.toMatchObject({ status: 404 });
    await expect(service.capture(userId, session.sessionId, "capture-idem", { ...capture, width: 127 })).rejects.toMatchObject({ status: 409 });
  });
});
