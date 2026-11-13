import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@fashion/db";
import { canvasCommandSchema, canvasMediaUrl, type CanvasCommand } from "@fashion/shared";
import { afterAll, beforeAll, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import { CanvasService } from "./canvas.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { WorkflowsService } from "../workflows/workflows.service";
import { S3FileStorage } from "../files/storage.service";
import { CanvasCommandService } from "../workflow-runtime/canvas-command.service";
import { CanvasCommandsController } from "../workflow-runtime/canvas-commands.controller";
import { RateLimitGuard } from "../../security/rate-limit.guard";
import { ProjectGeneratedFilesService } from "../project-generated-files/project-generated-files.service";
import { generatedAudioBytes, generatedVideoBytes } from "../../../../../tests/e2e/generated-media-fixture";
import { RunwayController } from "../runway/runway.controller";
import { RunwayService } from "../runway/runway.service";
import { RunwayStorage } from "../runway/runway-storage.service";

const storage = new S3FileStorage(), access = new ProjectAccessPolicy(prisma), workflows = new WorkflowsService(prisma, access);
const canvas = new CanvasService(prisma, access, workflows), commands = new CanvasCommandService(canvas, workflows, {} as never, storage);
const cleanups = new Set<() => Promise<void>>();
let app: INestApplication;
beforeAll(async () => {
  const mediaStorage = new RunwayStorage();
  const module = await Test.createTestingModule({ controllers: [CanvasCommandsController, RunwayController], providers: [
    { provide: CanvasCommandService, useValue: commands },
    { provide: RunwayService, useValue: new RunwayService(prisma, access, mediaStorage) },
    { provide: RunwayStorage, useValue: mediaStorage },
  ] }).overrideGuard(RateLimitGuard).useValue({ canActivate: () => true }).compile();
  app = module.createNestApplication();
  app.use((req: Request & { auth?: unknown }, _res: Response, next: NextFunction) => { req.auth = { userId: req.headers["x-test-user"] }; next(); });
  await app.init();
});
afterAll(async () => { for (const cleanup of cleanups) await cleanup(); await app?.close(); });
async function fixture(kind: "video" | "audio" = "video") {
  const user = await prisma.user.create({ data: { email: `place-media-${randomUUID()}@example.test`, ownedWorkspaces: { create: { name: "媒体白板隔离", projects: { create: { name: "媒体项目" } } } } }, include: { ownedWorkspaces: { include: { projects: true } } } });
  const workspace = user.ownedWorkspaces[0], project = workspace?.projects[0]; if (!workspace || !project) throw new Error("缺少项目");
  let storedKey: string | null = null;
  const cleanup = async () => { if (storedKey) await storage.delete(storedKey); await prisma.workspace.delete({ where: { id: workspace.id } }); await prisma.user.delete({ where: { id: user.id } }); cleanups.delete(cleanup); };
  cleanups.add(cleanup);
  const show = await prisma.runwayShow.create({ data: { ownerId: user.id, projectId: project.id, title: "秋冬作品", requestKey: randomUUID(), draft: {} } });
  const run = await prisma.runwayRun.create({ data: { userId: user.id, projectId: project.id, showId: show.id, requestKey: randomUUID(), inputSnapshot: {}, status: "SUCCEEDED" } });
  const key = `integration/generated-media/${randomUUID()}.${kind === "video" ? "mp4" : "wav"}`, mimeType = kind === "video" ? "video/mp4" : "audio/wav";
  storedKey = key;
  const bytes = kind === "video" ? generatedVideoBytes : generatedAudioBytes();
  await storage.uploadBuffer(key, bytes, mimeType, createHash("sha256").update(bytes).digest("base64"));
  const media = await prisma.runwayMedia.create({ data: { runId: run.id, projectId: project.id, kind: kind === "video" ? "FINAL_VIDEO" : "MUSIC", objectKey: key, mimeType, sha256: createHash("sha256").update(bytes).digest("hex"), originalName: kind === "video" ? "秋冬成片.mp4" : "系列配乐.wav", sizeBytes: bytes.length, durationMs: 2000, width: kind === "video" ? 240 : null, height: kind === "video" ? 160 : null, source: {} } });
  await canvas.initialize(user.id, project.id);
  const command: Extract<CanvasCommand, { type: "place_generated_media" }> = { type: "place_generated_media", mutationId: randomUUID(), mediaId: media.id, position: { x: 125, y: 280 } };
  return { user: user.id, workspace: workspace.id, project: project.id, media, show, key, bytes, command,
    send: (input: object = command, account = user.id) => request(app.getHttpServer()).post(`/projects/${project.id}/canvas/commands`).set("x-test-user", account).send(input),
    cleanup };
}

it.each(["video", "audio"] as const)("%s放回沿用原媒体文件，保存位置、来源和稳定地址，重复请求幂等", async kind => {
  const f = await fixture(kind);
  try {
    const [first, replay] = await Promise.all([f.send().expect(201), f.send().expect(201)]);
    expect(first.body.nodeId).toBe(replay.body.nodeId);
    const node = first.body.graph.nodes.find((item: { id: string }) => item.id === first.body.nodeId);
    expect(node).toMatchObject({ type: "media", kind: "asset", payload: { mediaId: f.media.id, mediaKind: kind, runId: f.media.runId, showId: f.show.id, mediaUrl: canvasMediaUrl(f.project, f.media.id) } });
    expect(first.body.canvas.snapshot.placementHints[`shape:generated-media-${f.command.mutationId}`]).toEqual(f.command.position);
    expect(await prisma.runwayMedia.count({ where: { projectId: f.project } })).toBe(1);
    expect(await prisma.workflowNode.count({ where: { projectId: f.project } })).toBe(1);
    expect(await prisma.canvasMutation.count({ where: { projectId: f.project } })).toBe(1);
    expect(await prisma.generationTask.count({ where: { projectId: f.project } })).toBe(0);
    const listed = await new ProjectGeneratedFilesService(prisma, access, storage).list(f.user, f.project, { kind, q: "", limit: 30 });
    expect(listed.items[0]).toMatchObject({ resourceId: f.media.id, nodeId: first.body.nodeId });
    const downloaded = await new ProjectGeneratedFilesService(prisma, access, storage).download(f.user, f.project, "runway", f.media.id);
    expect(Buffer.from(await (await fetch(downloaded.url)).arrayBuffer())).toEqual(f.bytes);
    await f.send({ ...f.command, position: { x: 0, y: 0 } }).expect(409);
  } finally { await f.cleanup(); }
}, 30000);

it("媒体原文件丢失或类型不一致不留下半份摆放，原编号可续办", async () => {
  const f = await fixture();
  try {
    await storage.delete(f.key); await f.send().expect(503);
    expect(await prisma.canvasMutation.count({ where: { projectId: f.project } })).toBe(0);
    await storage.uploadBuffer(f.key, f.bytes, "application/octet-stream", createHash("sha256").update(f.bytes).digest("base64"));
    await f.send().expect(503);
    await storage.uploadBuffer(f.key, f.bytes.subarray(0, 24), f.media.mimeType, createHash("sha256").update(f.bytes.subarray(0, 24)).digest("base64"));
    await f.send().expect(503);
    await storage.uploadBuffer(f.key, f.bytes, f.media.mimeType, createHash("sha256").update(f.bytes).digest("base64"));
    await f.send().expect(201);
    expect(await prisma.canvasObjectBinding.count({ where: { projectId: f.project } })).toBe(1);
  } finally { await f.cleanup(); }
}, 30000);

it("项目外、只读、归档项目及输入媒体禁止放置，拒绝任意播放URL", async () => {
  const f = await fixture(), other = await fixture();
  const viewer = await prisma.user.create({ data: { email: `media-viewer-${randomUUID()}@example.test` } });
  try {
    await prisma.workspaceMember.create({ data: { workspaceId: f.workspace, userId: viewer.id, role: "VIEWER" } });
    await f.send(f.command, viewer.id).expect(403);
    await f.send({ ...f.command, mediaId: other.media.id }).expect(400);
    await prisma.runwayMedia.update({ where: { id: f.media.id }, data: { source: { input: true } } });
    await f.send().expect(400);
    await prisma.project.update({ where: { id: f.project }, data: { archived: true } });
    await f.send().expect(403);
    expect(canvasCommandSchema.safeParse({ ...f.command, mediaUrl: "https://outside.test/forged.mp4" }).success).toBe(false);
    expect(await prisma.canvasMutation.count({ where: { projectId: f.project } })).toBe(0);
  } finally { await f.cleanup(); await other.cleanup(); await prisma.user.delete({ where: { id: viewer.id } }); }
}, 30000);

it("归档来源可回看，删除摆放后重新放入复用同一素材节点且原媒体不变", async () => {
  const f = await fixture();
  try {
    await prisma.runwayShow.update({ where: { id: f.show.id }, data: { archived: true } });
    const first = await f.send().expect(201);
    const binding = first.body.canvas.bindings[0];
    await prisma.canvasObjectBinding.update({ where: { projectId_shapeId: { projectId: f.project, shapeId: binding.shapeId } }, data: { removedAt: new Date() } });
    const next = await f.send({ ...f.command, mutationId: randomUUID(), position: { x: 900, y: 600 } }).expect(201);
    expect(next.body.nodeId).toBe(first.body.nodeId);
    expect(await prisma.workflowNode.count({ where: { projectId: f.project } })).toBe(1);
    expect(await prisma.runwayMedia.count({ where: { projectId: f.project } })).toBe(1);
    expect(next.body.canvas.bindings).toHaveLength(2);
  } finally { await f.cleanup(); }
}, 30000);

it("一般语义修改也不能伪造媒体来源、身份或格式", async () => {
  const f = await fixture();
  try {
    const first = await f.send().expect(201);
    const node = first.body.graph.nodes.find((item: { id: string }) => item.id === first.body.nodeId);
    await expect(workflows.applySystemMutation(f.project, { mode: "semantic", mutationId: randomUUID(), baseRevision: first.body.graph.revision, operations: [{ type: "update_node", nodeId: node.id, payload: { ...node.payload, mediaUrl: "https://outside.test/file.mp4" } }] }, undefined, undefined, undefined, f.user)).rejects.toThrow("不一致");
  } finally { await f.cleanup(); }
}, 30000);

it("同一媒体认证入口支持真实字节范围与原文件下载，项目外身份不能读取", async () => {
  const f = await fixture();
  try {
    await f.send().expect(201);
    const path = `/projects/${f.project}/runway/media/${f.media.id}/content`;
    const binary = (response: request.Response, done: (error: Error | null, body?: Buffer) => void) => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(Buffer.from(chunk)));
      response.on("end", () => done(null, Buffer.concat(chunks)));
      response.on("error", error => done(error));
    };
    const range = await request(app.getHttpServer()).get(path).set("x-test-user", f.user).set("Range", "bytes=20-89").buffer(true).parse(binary).expect(206);
    expect(range.body).toEqual(f.bytes.subarray(20, 90));
    expect(range.headers["content-range"]).toBe(`bytes 20-89/${f.bytes.length}`);
    expect(range.headers["cache-control"]).toBe("private, no-store");
    const original = await request(app.getHttpServer()).get(`${path}?download=1`).set("x-test-user", f.user).buffer(true).parse(binary).expect(200);
    expect(original.body).toEqual(f.bytes); expect(original.headers["content-disposition"]).toContain("attachment");
    await request(app.getHttpServer()).get(path).set("x-test-user", randomUUID()).expect(403);
    await request(app.getHttpServer()).get(path).set("x-test-user", f.user).set("Range", "bytes=999999-9999999").expect(416);
  } finally { await f.cleanup(); }
}, 30000);
