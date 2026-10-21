import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { prisma } from "@fashion/db";
import { BillingService } from "@fashion/billing";
import type { AiProviderJob } from "@fashion/ai";
import type { GenerationJobData } from "@fashion/shared";
import { Queue, Worker } from "bullmq";
import sharp from "../../worker/node_modules/sharp";
import { expect, it } from "vitest";

import { FilesService } from "./modules/files/files.service";
import { S3FileStorage } from "./modules/files/storage.service";
import { cleanupExpiredUploads } from "./modules/files/uploads-cleanup.service";
import { GenerationService } from "./modules/generation/generation.service";
import { ContextCompilerService } from "./modules/generation/compiler/context-compiler.service";
import { WorkflowsService } from "./modules/workflows/workflows.service";
import { WorkflowRuntimeService } from "./modules/workflow-runtime/workflow-runtime.service";
import { DesignAssetsService } from "./modules/design-assets/design-assets.service";
import { ExportsService } from "./modules/exports/exports.service";
import { S3ThumbnailStorage } from "../../worker/src/storage";
import { createThumbnailProcessor } from "../../worker/src/processors/thumbnail.processor";
import { createGenerationProcessor } from "../../worker/src/processors/generation.processor";
import { createExportProcessor } from "../../worker/src/processors/export.processor";

for (const crash of [false, true]) {
it(`上传→真实 Redis 节点任务→Worker 产物→归属→导出，${crash ? "进程崩溃恢复" : "完成后重放"}不重复生成或计次`, async () => {
  const suffix = randomUUID();
  const redis = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  const connection = { host: redis.hostname, port: Number(redis.port || 6379), ...(redis.password ? { password: decodeURIComponent(redis.password) } : {}), maxRetriesPerRequest: null };
  const generationQueue = new Queue<GenerationJobData>(`review-generation-${suffix}`, { connection });
  const exportQueue = new Queue<{ exportId: string }>(`review-export-${suffix}`, { connection });
  const storage = new S3ThumbnailStorage();
  const apiStorage = new S3FileStorage();
  const billing = new BillingService(prisma);
  const source = await sharp({ create: { width: 256, height: 256, channels: 3, background: "#263950" } }).png().toBuffer();
  let providerSubmissions = 0;
  const providerJob: AiProviderJob = { provider: "mock", providerJobId: suffix, model: "mock/review", taskType: "t2i", submittedAt: new Date().toISOString(), cost: { credits: 1, rawCost: 0, currency: "USD", billableMegapixels: 1, estimated: true } };
  const generationProcessor = createGenerationProcessor({ database: prisma, billing, storage, pollIntervalMs: 1,
    moderator: { moderate: async () => ({ status: "approved", categories: [] }) },
    ai: { submit: async () => { providerSubmissions++; return providerJob; }, getStatus: async () => ({ status: "completed" }),
      getResult: async (job) => ({ job, cost: job.cost, images: [{ url: `data:image/png;base64,${source.toString("base64")}` }] }) },
  });
  let crashedProcess: ChildProcess | undefined;
  const generationWorker = new Worker<GenerationJobData>(generationQueue.name, (job) => generationProcessor(job), { connection, autorun: !crash,
    lockDuration: 500, stalledInterval: 100, maxStalledCount: 1 });
  const exportWorker = new Worker<{ exportId: string }>(exportQueue.name, (job) => createExportProcessor({ database: prisma, storage })(job.data.exportId), { connection });
  const user = await prisma.user.create({ data: { email: `review-${suffix}@example.com`, generationLimit: 20,
    ownedWorkspaces: { create: { name: "Review", projects: { create: { name: "Review pipeline" } } } } }, include: { ownedWorkspaces: { include: { projects: true } } } });
  const projectId = user.ownedWorkspaces[0]?.projects[0]?.id;
  if (!projectId) throw new Error("链路验收项目创建失败");
  const objects = new Set<string>();
  try {
    await Promise.all([generationWorker.waitUntilReady(), exportWorker.waitUntilReady()]);
    const processThumbnail = createThumbnailProcessor({ database: prisma, storage });
    const files = new FilesService(prisma, apiStorage, { enqueue: processThumbnail });
    const signed = await files.signUpload(user.id, { projectId, name: "reference.png", mimeType: "image/png", size: source.length, sha256: createHash("sha256").update(source).digest("hex") });
    if (!signed.upload) throw new Error("缺少上传签名");
    expect((await fetch(signed.upload.url, { method: "PUT", body: source, headers: signed.upload.headers })).ok).toBe(true);
    await files.complete(user.id, signed.file.id);
    expect((await files.get(user.id, signed.file.id)).status).toBe("READY");
    const compiler = new ContextCompilerService(prisma, { enhancePrompt: async () => { throw new Error("此测试禁止真实模型请求"); } } as never, apiStorage);
    const generations = new GenerationService(prisma, { enqueue: async (taskId, userId) => { await generationQueue.add("generate", { taskId, userId }, { jobId: taskId, attempts: 1 }); }, cancel: async () => undefined }, billing, compiler, apiStorage);
    const workflows = new WorkflowsService(prisma);
    const assets = new DesignAssetsService(prisma, apiStorage);
    const runtime = new WorkflowRuntimeService(prisma, workflows, generations, {} as never, apiStorage, assets);
    const referenceId = randomUUID(), constraintId = randomUUID(), toolId = randomUUID();
    await workflows.patch(user.id, projectId, { mode: "semantic", baseRevision: 0, mutationId: randomUUID(), operations: [
      { type: "add_node", node: { id: referenceId, kind: "asset", type: "reference_image", title: "参考", payload: { fileAssetId: signed.file.id, role: "style_ref" }, x: 0, y: 0 } },
      { type: "add_node", node: { id: constraintId, kind: "asset", type: "constraint", title: "设计约束", payload: { text: "藏蓝色服装" }, x: 0, y: 300 } },
      { type: "add_node", node: { id: toolId, kind: "tool", type: "generate_design", title: "生成", payload: { toolKey: "generate_design", toolVersion: "1", params: { prompt: "藏蓝色风衣", width: 256, height: 256, count: 1 } }, x: 350, y: 0 } },
      { type: "add_edge", edge: { id: randomUUID(), sourceNodeId: referenceId, targetNodeId: toolId, sourcePort: "out", targetPort: "reference" } },
      { type: "add_edge", edge: { id: randomUUID(), sourceNodeId: constraintId, targetNodeId: toolId, sourcePort: "out", targetPort: "constraint" } },
    ] });
    const mutationId = randomUUID();
    await runtime.execute(user.id, projectId, toolId, { mutationId });
    if (crash) {
      crashedProcess = spawn(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "--tsconfig", "tsconfig.json",
        resolve("../../scripts/review-generation-crash-worker.ts"), generationQueue.name], { env: process.env, stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true });
      const child = crashedProcess;
      let crashOutput = "";
      child.stderr?.on("data", (chunk: Buffer) => { crashOutput += chunk.toString("utf8"); });
      await new Promise<void>((done, reject) => {
        const timer = setTimeout(() => reject(new Error("崩溃模拟进程未持久化远程任务")), 15_000);
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`崩溃模拟进程提前退出 ${code}: ${crashOutput}`)); });
        child.once("message", () => { clearTimeout(timer); done(); });
      });
      providerSubmissions += 1;
      const exited = new Promise<void>((done) => child.once("exit", () => done()));
      child.kill("SIGKILL");
      await exited;
      const interrupted = await prisma.generationTask.findFirstOrThrow({ where: { projectId } });
      expect(interrupted.status).toBe("RUNNING");
      expect(interrupted.providerJob).not.toBeNull();
      // Advance only the test row's lease; BullMQ must still recover the actual abandoned lock.
      await prisma.generationTask.update({ where: { id: interrupted.id }, data: { updatedAt: new Date(Date.now() - 31_000) } });
      void generationWorker.run().catch(() => undefined);
    }
    await expect.poll(async () => {
      const failed = await generationQueue.getFailed();
      if (failed[0]) throw new Error(failed[0].failedReason);
      return (await prisma.generationTask.findFirst({ where: { projectId } }))?.status;
    }, { timeout: 10_000 }).toBe("SUCCEEDED");
    const graph = await runtime.sync(user.id, projectId);
    const candidate = graph.nodes.find((node) => node.type === "candidate");
    expect(candidate).toBeDefined();
    const asset = await prisma.designAsset.findFirstOrThrow({ where: { projectId, generationTaskId: { not: null } } });
    expect((candidate?.payload as { assetId: string }).assetId).toBe(asset.id);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: asset.projectId }, include: { workspace: true } })).workspace.ownerId).toBe(user.id);
    await expect(files.get("different-user", signed.file.id)).rejects.toMatchObject({ status: 403 });
    await runtime.execute(user.id, projectId, toolId, { mutationId });
    const task = await prisma.generationTask.findFirstOrThrow({ where: { projectId } });
    if (crash) expect(task.attemptCount).toBeGreaterThanOrEqual(2);
    await generationQueue.add("replay", { taskId: task.id, userId: user.id }, { jobId: `replay-${task.id}` });
    await expect.poll(async () => (await generationQueue.getJob(`replay-${task.id}`))?.getState()).toBe("completed");
    expect(await prisma.designAsset.count({ where: { generationTaskId: task.id } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).generationCount).toBe(1);
    expect(providerSubmissions).toBe(1);
    const exports = new ExportsService(prisma, { enqueue: async (exportId) => { await exportQueue.add("export", { exportId }); } }, apiStorage);
    const created = await exports.create(user.id, { sourceType: "asset", assetId: asset.id, format: "png", quality: "standard" });
    await expect.poll(async () => (await exports.get(user.id, created.id)).status, { timeout: 10_000 }).toBe("succeeded");
    const exported = await exports.get(user.id, created.id);
    if (!exported.downloadUrl) throw new Error("导出未返回下载地址");
    expect(exported.downloadUrl).toBe(`/api/exports/${created.id}/content`);
    const signedDownload = await exports.downloadUrl(user.id, created.id);
    expect(new URL(signedDownload).searchParams.get("X-Amz-Expires")).toBe("60");
    const response = await fetch(signedDownload);
    expect(response.ok).toBe(true);
    expect((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format).toBe("png");
    await expect(exports.get("different-user", created.id)).rejects.toMatchObject({ status: 403 });
  } finally {
    if (crashedProcess && crashedProcess.exitCode === null) crashedProcess.kill("SIGKILL");
    await Promise.all([generationWorker.close(), exportWorker.close()]);
    await generationQueue.obliterate({ force: true });
    await exportQueue.obliterate({ force: true });
    await Promise.all([generationQueue.close(), exportQueue.close()]);
    const files = await prisma.fileAsset.findMany({ where: { ownerId: user.id } });
    for (const file of files) for (const key of [file.objectKey, file.thumbnail256Key, file.thumbnail1024Key]) if (key) objects.add(key);
    for (const asset of await prisma.designAsset.findMany({ where: { projectId } })) if (asset.url.startsWith("s3://")) objects.add(asset.url.slice(5));
    for (const job of await prisma.exportJob.findMany({ where: { userId: user.id } })) if (job.objectKey) objects.add(job.objectKey);
    await Promise.all([...objects].map((key) => storage.delete(key)));
    await prisma.user.delete({ where: { id: user.id } });
  }
}, 60_000);
}

it("错误对象标记失败并在过期后清理，READY、PROCESSING 和活跃上传保持完整", async () => {
  const user = await prisma.user.create({ data: { email: `cleanup-${randomUUID()}@example.com`,
    ownedWorkspaces: { create: { name: "Cleanup", projects: { create: { name: "Cleanup verification" } } } } },
    include: { ownedWorkspaces: { include: { projects: true } } } });
  const projectId = user.ownedWorkspaces[0]?.projects[0]?.id;
  if (!projectId) throw new Error("清理验收项目创建失败");
  const storage = new S3FileStorage();
  const files = new FilesService(prisma, storage, { enqueue: async () => undefined });
  const original = Buffer.from("declared image");
  const incorrect = Buffer.from("incorrect uploaded object with a different length");
  const keys: string[] = [];
  try {
    const signed = await files.signUpload(user.id, { projectId, name: "invalid.png", mimeType: "image/png",
      size: original.length, sha256: createHash("sha256").update(original).digest("hex") });
    const invalid = await prisma.fileAsset.findUniqueOrThrow({ where: { id: signed.file.id } });
    keys.push(invalid.objectKey);
    // Trusted test credentials seed an inconsistent object; the browser signature cannot upload this body.
    await storage.uploadBuffer(invalid.objectKey, incorrect, "image/png", createHash("sha256").update(incorrect).digest("base64"));
    await expect(files.complete(user.id, invalid.id)).rejects.toMatchObject({ response: { code: "UPLOAD_MISMATCH" } });
    expect((await prisma.fileAsset.findUniqueOrThrow({ where: { id: invalid.id } })).status).toBe("FAILED");
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await prisma.fileAsset.update({ where: { id: invalid.id }, data: { updatedAt: old } });
    const protectedFiles = [];
    for (const status of ["READY", "PROCESSING", "PENDING"] as const) {
      const key = `review-cleanup/${user.id}/${status}`;
      keys.push(key);
      await storage.uploadBuffer(key, original, "image/png", createHash("sha256").update(original).digest("base64"));
      protectedFiles.push(await prisma.fileAsset.create({ data: { ownerId: user.id, objectKey: key,
        originalName: `${status}.png`, mimeType: "image/png", sizeBytes: original.length,
        sha256: createHash("sha256").update(status).digest("hex"), status, updatedAt: status === "PENDING" ? new Date() : old } }));
    }
    await cleanupExpiredUploads(prisma, storage);
    await expect(storage.head(invalid.objectKey)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    expect((await prisma.fileAsset.findUniqueOrThrow({ where: { id: invalid.id } })).errorMessage).toBe("EXPIRED_UPLOAD_CLEANED");
    for (const file of protectedFiles) {
      expect((await storage.head(file.objectKey)).contentLength).toBe(original.length);
      expect((await prisma.fileAsset.findUniqueOrThrow({ where: { id: file.id } })).status).toBe(file.status);
    }
  } finally {
    await Promise.all(keys.map((key) => storage.delete(key)));
    await prisma.user.delete({ where: { id: user.id } });
  }
}, 30_000);
