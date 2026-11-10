import { prisma } from "@fashion/db";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { ProjectGeneratedFilesService } from "./project-generated-files.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { S3FileStorage } from "../files/storage.service";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { ProjectGeneratedFilesController } from "./project-generated-files.controller";

const storage = new S3FileStorage(), access = new ProjectAccessPolicy(prisma);
const service = new ProjectGeneratedFilesService(prisma, access, storage);
let app: INestApplication, owner = "", viewer = "", outsider = "", project = "", foreign = "", workspace = "", downloadable = "";
let original: Buffer;
const expected: string[] = [], keys: string[] = [];
const at = new Date("2026-11-09T12:00:00.000Z");
beforeAll(async () => {
  const person = await prisma.user.create({ data: { email: `generated-files-${randomUUID()}@example.com`, ownedWorkspaces: { create: { name: "生成文件验收", projects: { create: [{ name: "目标项目" }, { name: "隔离项目" }] } } } }, include: { ownedWorkspaces: { include: { projects: true } } } });
  owner = person.id; workspace = person.ownedWorkspaces[0]?.id ?? ""; project = person.ownedWorkspaces[0]?.projects[0]?.id ?? ""; foreign = person.ownedWorkspaces[0]?.projects[1]?.id ?? "";
  viewer = (await prisma.user.create({ data: { email: `files-viewer-${randomUUID()}@example.com` } })).id;
  outsider = (await prisma.user.create({ data: { email: `files-outsider-${randomUUID()}@example.com` } })).id;
  await prisma.workspaceMember.create({ data: { workspaceId: workspace, userId: viewer, role: "VIEWER" } });
  original = await sharp({ create: { width: 24, height: 32, channels: 4, background: { r: 50, g: 90, b: 65, alpha: .7 } } }).png().toBuffer();
  const objectKey = `integration/generated-files/${randomUUID()}/original.png`; keys.push(objectKey);
  await storage.uploadBuffer(objectKey, original, "image/png", createHash("sha256").update(original).digest("base64"));
  for (let i = 0; i < 7; i++) {
    const id = randomUUID(); await prisma.designAsset.create({ data: { id, rootAssetId: id, projectId: project, operation: i === 6 ? "RESTORE" : "GENERATED", createdAt: at, url: `s3://${objectKey}`, width: 24, height: 32, archivedAt: i === 6 ? at : null, designStep: { create: { projectId: project, actor: "test", tool: "t2i", intent: `秋冬外套 ${i}`, inputSnapshot: {} } } } });
    expected.push(`asset:${id}`); if (i === 0) downloadable = id;
  }
  await prisma.workflowGraph.create({ data: { projectId: project, nodes: { create: { id: randomUUID(), kind: "asset", type: "candidate", title: "实际作品", payload: { assetId: downloadable }, x: 0, y: 0 } } } });
  const imported = randomUUID(), mask = randomUUID(), other = randomUUID();
  await prisma.designAsset.createMany({ data: [{ id: imported, rootAssetId: imported, projectId: project, operation: "IMPORTED", url: `s3://${objectKey}`, createdAt: at }, { id: mask, rootAssetId: mask, projectId: project, operation: "GENERATED", url: `s3://${objectKey}`, createdAt: at }, { id: other, rootAssetId: other, projectId: foreign, operation: "GENERATED", url: `s3://${objectKey}`, createdAt: at }] });
  await prisma.designStep.create({ data: { projectId: project, outputAssetId: mask, actor: "wardrobe", tool: "wardrobe-material-mask", intent: "内部蒙版", inputSnapshot: {} } });
  const probe = await prisma.generationTask.create({ data: { userId: owner, projectId: project, taskType: "i2i", input: {}, compiledPrompt: { notes: ["wardrobe-material-alpha-probe:v1"] }, status: "SUCCEEDED" } });
  const probeId = randomUUID(); await prisma.designAsset.create({ data: { id: probeId, rootAssetId: probeId, projectId: project, generationTaskId: probe.id, operation: "GENERATED", url: `s3://${objectKey}`, createdAt: at } });
  const show = await prisma.runwayShow.create({ data: { projectId: project, ownerId: owner, title: "秋冬服装秀", draft: {}, requestKey: randomUUID() } });
  const run = await prisma.runwayRun.create({ data: { projectId: project, userId: owner, showId: show.id, requestKey: randomUUID(), inputSnapshot: {}, status: "SUCCEEDED" } });
  for (const [kind, mimeType, source] of [["poster", "image/png", {}], ["final_video", "video/mp4", {}], ["music", "audio/mpeg", {}], ["model", "image/png", { input: true }]] as const) {
    const id = randomUUID(); await prisma.runwayMedia.create({ data: { id, runId: run.id, projectId: project, kind, mimeType, source, originalName: `${kind}.test`, objectKey: `integration/record-only/${id}`, sha256: "test", sizeBytes: 12, createdAt: at } });
    if (!("input" in source)) expected.push(`runway:${id}`);
  }
  for (const [format, status] of [["PDF", "SUCCEEDED"], ["PNG", "EXPIRED"], ["PNG", "QUEUED"]] as const) {
    const id = randomUUID(); await prisma.exportJob.create({ data: { id, userId: owner, projectId: project, format, status, quality: "STANDARD", watermark: false, fileName: `秋冬-${id}.${format.toLowerCase()}`, createdAt: at, objectKey: `integration/export-record/${id}`, expiresAt: status === "EXPIRED" ? at : new Date(Date.now() + 60000) } });
    if (status !== "QUEUED") expected.push(`export:${id}`);
  }
  const module = await Test.createTestingModule({ controllers: [ProjectGeneratedFilesController], providers: [{ provide: ProjectGeneratedFilesService, useValue: service }] }).compile();
  app = module.createNestApplication();
  app.use((req: Request & { auth?: unknown }, _res: Response, next: NextFunction) => { req.auth = { userId: req.headers["x-test-user"] ?? viewer }; next(); });
  await app.init();
}, 30000);
afterAll(async () => {
  await app?.close();
  for (const key of keys) await storage.delete(key);
  if (workspace) await prisma.workspace.delete({ where: { id: workspace } });
  for (const id of [owner, viewer, outsider].filter(Boolean)) await prisma.user.delete({ where: { id } });
}, 30000);

describe("真实项目生成文件接口", () => {
  it("同时间跨领域连续分页无遗漏重复，归档结果可读，输入与内部产物排除", async () => {
    const ids: string[] = []; let cursor: string | undefined;
    do { const page = await service.list(viewer, project, { kind: "all", q: "", limit: 2, ...(cursor ? { cursor } : {}) }); ids.push(...page.items.map(item => item.id)); cursor = page.nextCursor ?? undefined; } while (cursor);
    expect(ids).toEqual([...expected].sort().reverse()); expect(new Set(ids).size).toBe(expected.length);
    const page = await service.list(viewer, project, { kind: "all", q: "", limit: 60 });
    expect(page.items.some(item => item.archived)).toBe(true);
    expect(page.items.find(item => item.resourceId === downloadable)?.nodeId).toBeTruthy();
    expect(page.items.find(item => item.status === "expired")?.contentUrl).toBeNull();
  });
  it("类型与跨页搜索由数据库过滤，外来用户不可读取和签名", async () => {
    for (const kind of ["image", "video", "audio", "document"] as const) {
      const page = await service.list(viewer, project, { kind, q: "秋冬", limit: 60 }); expect(page.items.length).toBeGreaterThan(0); expect(page.items.every(item => item.kind === kind)).toBe(true);
    }
    await request(app.getHttpServer()).get(`/projects/${project}/generated-files`).set("x-test-user", outsider).expect(403);
    await request(app.getHttpServer()).get(`/projects/${foreign}/generated-files/asset/${downloadable}/download`).set("x-test-user", viewer).expect(404);
    await request(app.getHttpServer()).get(`/projects/${project}/generated-files?limit=61`).expect(400);
    const response = await request(app.getHttpServer()).get(`/projects/${project}/generated-files?limit=1`).expect(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });
  it("原文件下载重新核验成员权限，签名返回真实字节和中文文件名", async () => {
    const response = await request(app.getHttpServer()).get(`/projects/${project}/generated-files/asset/${downloadable}/download`).expect(200);
    const file = await fetch(response.body.url); expect(file.ok).toBe(true);
    expect(Buffer.from(await file.arrayBuffer())).toEqual(original);
    expect(decodeURIComponent(file.headers.get("content-disposition") ?? "")).toContain("生成设计-");
    expect(response.body.fileName.endsWith(".png")).toBe(true);
    await prisma.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: workspace, userId: viewer } } });
    await request(app.getHttpServer()).get(`/projects/${project}/generated-files/asset/${downloadable}/download`).expect(403);
    await prisma.workspaceMember.create({ data: { workspaceId: workspace, userId: viewer, role: "VIEWER" } });
  });
  it("翻页期间新增记录和删除游标记录，不重复或遗漏剩余结果", async () => {
    const separate = await prisma.project.create({ data: { wsId: workspace, name: "分页变化" } });
    try {
      const oldIds = Array.from({ length: 8 }, () => randomUUID()).sort().reverse();
      await prisma.designAsset.createMany({ data: oldIds.map(id => ({ id, rootAssetId: id, projectId: separate.id, operation: "GENERATED" as const, url: "s3://record-only", createdAt: at })) });
      const first = await service.list(viewer, separate.id, { kind: "image", q: "", limit: 3 });
      const boundary = first.items.at(-1); if (!boundary || !first.nextCursor) throw new Error("缺少边界记录");
      await prisma.designAsset.delete({ where: { id: boundary.resourceId } });
      const newest = randomUUID(); await prisma.designAsset.create({ data: { id: newest, rootAssetId: newest, projectId: separate.id, operation: "GENERATED", url: "s3://record-only", createdAt: new Date(at.getTime() + 1000) } });
      const remaining: string[] = []; let cursor: string | undefined = first.nextCursor;
      while (cursor) { const next = await service.list(viewer, separate.id, { kind: "image", q: "", limit: 2, cursor }); remaining.push(...next.items.map(file => file.resourceId)); cursor = next.nextCursor ?? undefined; }
      expect(remaining).toEqual(oldIds.slice(3));
      expect((await service.list(viewer, separate.id, { kind: "image", q: "", limit: 2 })).items[0]?.resourceId).toBe(newest);
    } finally { await prisma.project.delete({ where: { id: separate.id } }); }
  });
  it("媒体与导出签名返回真实文件，存储丢失和到期保留记录并拒绝下载", async () => {
    const run = await prisma.runwayRun.findFirstOrThrow({ where: { projectId: project } });
    const show = await prisma.runwayShow.findUniqueOrThrow({ where: { id: run.showId } });
    const body = Buffer.from("RIFF-test-audio-preserved-bytes");
    const key = `integration/generated-files/${randomUUID()}/track.wav`; keys.push(key);
    await storage.uploadBuffer(key, body, "audio/wav", createHash("sha256").update(body).digest("base64"));
    const track = await prisma.runwayMedia.create({ data: { projectId: project, runId: run.id, kind: "music", objectKey: key, mimeType: "audio/wav", originalName: "秋冬配乐.wav", sizeBytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), source: {} } });
    const documentId = randomUUID();
    const document = await prisma.studioDocument.create({ data: { documentId, projectId: project, ownerId: owner, type: "TECH_PACK", revision: 1, payload: { name: "历史技术包" } } });
    const exportKey = `integration/generated-files/${randomUUID()}/old.pdf`; keys.push(exportKey);
    const pdf = Buffer.from("%PDF-1.4\nOriginal revision output\n%%EOF");
    await storage.uploadBuffer(exportKey, pdf, "application/pdf", createHash("sha256").update(pdf).digest("base64"));
    const exported = await prisma.exportJob.create({ data: { projectId: project, userId: owner, studioRevisionId: document.id, format: "PDF", quality: "STANDARD", watermark: false, status: "SUCCEEDED", objectKey: exportKey, fileName: "历史技术包.pdf", expiresAt: new Date(Date.now() + 30000) } });
    try {
      const trackDownload = await service.download(viewer, project, "runway", track.id);
      expect(Buffer.from(await (await fetch(trackDownload.url)).arrayBuffer())).toEqual(body);
      const exportDownload = await service.download(viewer, project, "export", exported.id);
      expect(Number(new URL(exportDownload.url).searchParams.get("X-Amz-Expires"))).toBeLessThanOrEqual(30);
      expect(Buffer.from(await (await fetch(exportDownload.url)).arrayBuffer())).toEqual(pdf);
      const list = await service.list(viewer, project, { kind: "all", q: "", limit: 60 });
      expect(list.items.find(item => item.resourceId === track.id)?.sourceHref).toContain(`showId=${show.id}&runId=${run.id}`);
      expect(list.items.find(item => item.resourceId === exported.id)?.sourceHref).toContain(`documentId=${documentId}`);
      await storage.delete(key);
      await expect(service.download(viewer, project, "runway", track.id)).rejects.toThrow("文件暂时无法读取");
      expect((await service.list(viewer, project, { kind: "audio", q: "", limit: 60 })).items.some(item => item.resourceId === track.id)).toBe(true);
      await prisma.exportJob.update({ where: { id: exported.id }, data: { expiresAt: new Date(0) } });
      await request(app.getHttpServer()).get(`/projects/${project}/generated-files/export/${exported.id}/download`).expect(410);
      expect((await service.list(viewer, project, { kind: "document", q: "", limit: 60 })).items.find(item => item.resourceId === exported.id)?.status).toBe("expired");
    } finally {
      await prisma.runwayMedia.delete({ where: { id: track.id } }); await prisma.exportJob.delete({ where: { id: exported.id } }); await prisma.studioDocument.delete({ where: { id: document.id } });
    }
  });
});
