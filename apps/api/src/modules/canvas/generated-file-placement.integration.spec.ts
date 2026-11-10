import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@fashion/db";
import { canvasCommandSchema, type CanvasCommand } from "@fashion/shared";
import { afterAll, beforeAll, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import sharp from "sharp";
import { CanvasService, canvasObject } from "./canvas.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { WorkflowsService } from "../workflows/workflows.service";
import { S3FileStorage } from "../files/storage.service";
import { DesignAssetsService } from "../design-assets/design-assets.service";
import { CanvasCommandService } from "../workflow-runtime/canvas-command.service";
import { CanvasCommandsController } from "../workflow-runtime/canvas-commands.controller";
import { RateLimitGuard } from "../../security/rate-limit.guard";

const storage = new S3FileStorage(), access = new ProjectAccessPolicy(prisma), workflows = new WorkflowsService(prisma, access);
const canvas = new CanvasService(prisma, access, workflows);
const commands = new CanvasCommandService(canvas, workflows, {} as never, storage);
let app: INestApplication;
beforeAll(async () => {
  const module = await Test.createTestingModule({ controllers: [CanvasCommandsController], providers: [{ provide: CanvasCommandService, useValue: commands }] }).overrideGuard(RateLimitGuard).useValue({ canActivate: () => true }).compile();
  app = module.createNestApplication();
  app.use((req: Request & { auth?: unknown }, _res: Response, next: NextFunction) => { req.auth = { userId: req.headers["x-test-user"] }; next(); });
  await app.init();
});
afterAll(async () => app?.close());
async function fixture(archived = false) {
  const user = await prisma.user.create({ data: { email: `place-generated-${randomUUID()}@example.test`, ownedWorkspaces: { create: { name: "放回生成图片", projects: { create: { name: "图片项目" } } } } }, include: { ownedWorkspaces: { include: { projects: true } } } });
  const workspace = user.ownedWorkspaces[0], project = workspace?.projects[0]; if (!workspace || !project) throw new Error("缺少测试项目");
  const key = `integration/generated-file-placement/${randomUUID()}.png`;
  const bytes = await sharp({ create: { width: 30, height: 40, channels: 4, background: { r: 30, g: 60, b: 90, alpha: .6 } } }).png().toBuffer();
  await storage.uploadBuffer(key, bytes, "image/png", createHash("sha256").update(bytes).digest("base64"));
  const assetId = randomUUID();
  await prisma.designAsset.create({ data: { id: assetId, rootAssetId: assetId, projectId: project.id, operation: "GENERATED", archivedAt: archived ? new Date() : null, url: `s3://${key}`, width: 30, height: 40, designStep: { create: { projectId: project.id, actor: "test", tool: "t2i", intent: "藏蓝通勤外套", inputSnapshot: {} } } } });
  await canvas.initialize(user.id, project.id);
  const command: Extract<CanvasCommand, { type: "place_generated_asset" }> = { type: "place_generated_asset", mutationId: randomUUID(), assetId, archived, position: { x: 125, y: 280 } };
  const send = (input: CanvasCommand = command, account = user.id) => request(app.getHttpServer()).post(`/projects/${project.id}/canvas/commands`).set("x-test-user", account).send(input);
  return { user: user.id, project: project.id, workspace: workspace.id, assetId, key, bytes, command, send, cleanup: async () => { await storage.delete(key); await prisma.workspace.delete({ where: { id: workspace.id } }); await prisma.user.delete({ where: { id: user.id } }); } };
}

it("放回未归档生成图只增加摆放，使用原文件并保留位置", async () => {
  const f = await fixture();
  try {
    const response = await f.send().expect(201);
    const node = response.body.graph.nodes.find((node: { id: string }) => node.id === response.body.nodeId);
    expect(node.payload).toMatchObject({ assetId: f.assetId, imageWidth: 30, imageHeight: 40 });
    expect(await prisma.designAsset.count({ where: { projectId: f.project } })).toBe(1);
    expect(response.body.canvas.bindings).toHaveLength(1);
    const shape = `shape:generated-file-${f.command.mutationId}`;
    expect(response.body.canvas.snapshot.placementHints[shape]).toEqual(f.command.position);
    const signed = await new DesignAssetsService(prisma, storage, access).downloadUrl(f.user, f.assetId, "content");
    expect(Buffer.from(await (await fetch(signed)).arrayBuffer())).toEqual(f.bytes);
    expect(await prisma.generationTask.count({ where: { projectId: f.project } })).toBe(0);
  } finally { await f.cleanup(); }
}, 30000);

it("归档图以新版本放回，重复请求只创建一次且来源仍可追溯", async () => {
  const f = await fixture(true);
  try {
    const [first, replay] = await Promise.all([f.send().expect(201), f.send().expect(201)]);
    expect(first.body.nodeId).toBe(replay.body.nodeId);
    const restored = await prisma.designAsset.findFirstOrThrow({ where: { projectId: f.project, operation: "RESTORE" } });
    expect(restored).toMatchObject({ parentAssetId: f.assetId, restoredFromAssetId: f.assetId, archivedAt: null });
    expect(await prisma.designAsset.count({ where: { projectId: f.project } })).toBe(2);
    expect(await prisma.canvasObjectBinding.count({ where: { projectId: f.project } })).toBe(1);
    expect(await prisma.canvasMutation.count({ where: { projectId: f.project } })).toBe(1);
    expect((await prisma.designAsset.findUniqueOrThrow({ where: { id: f.assetId } })).archivedAt).not.toBeNull();
    const path = await new DesignAssetsService(prisma, storage, access).path(f.user, restored.id);
    expect(path.steps.some(step => step.sources.some(source => source.assetId === f.assetId && source.role === "restore_source"))).toBe(true);
    await f.send({ ...f.command, position: { x: 0, y: 0 } }).expect(409);
  } finally { await f.cleanup(); }
}, 30000);

it("已移除的摆放和当前其他副本都不被覆盖，复用原候选节点", async () => {
  const f = await fixture();
  try {
    const old = await f.send().expect(201);
    const binding = old.body.canvas.bindings[0];
    await prisma.canvasObjectBinding.update({ where: { projectId_shapeId: { projectId: f.project, shapeId: binding.shapeId } }, data: { removedAt: new Date() } });
    const next = { ...f.command, mutationId: randomUUID(), position: { x: 600, y: 500 } };
    const response = await f.send(next).expect(201);
    expect(response.body.nodeId).toBe(old.body.nodeId);
    expect(response.body.graph.nodes).toHaveLength(1);
    expect(response.body.canvas.bindings).toHaveLength(2);
    expect(response.body.canvas.bindings.find((item: { shapeId: string }) => item.shapeId === binding.shapeId).removed).toBe(true);
    expect(canvasObject(response.body.canvas.snapshot.placementHints)[`shape:generated-file-${next.mutationId}`]).toEqual(next.position);
  } finally { await f.cleanup(); }
}, 30000);

it("文件丢失、归档状态变化及内部素材拒绝放置，不留下半份新版本", async () => {
  const f = await fixture(true);
  try {
    await storage.delete(f.key); await f.send().expect(503);
    expect(await prisma.designAsset.count({ where: { projectId: f.project, operation: "RESTORE" } })).toBe(0);
    expect(await prisma.canvasMutation.count({ where: { projectId: f.project } })).toBe(0);
    await storage.uploadBuffer(f.key, f.bytes, "image/png", createHash("sha256").update(f.bytes).digest("base64"));
    await f.send({ ...f.command, archived: false }).expect(400);
    await prisma.designStep.updateMany({ where: { outputAssetId: f.assetId }, data: { tool: "wardrobe-material-mask" } });
    await f.send().expect(400);
    expect(await prisma.workflowNode.count({ where: { projectId: f.project } })).toBe(0);
  } finally { await f.cleanup(); }
}, 30000);

it("跨项目、只读和归档项目禁止放置，接口只接受真实资产身份", async () => {
  const f = await fixture(), other = await fixture();
  const viewer = await prisma.user.create({ data: { email: `place-viewer-${randomUUID()}@example.test` } });
  try {
    await prisma.workspaceMember.create({ data: { workspaceId: f.workspace, userId: viewer.id, role: "VIEWER" } });
    await f.send(f.command, viewer.id).expect(403);
    await f.send({ ...f.command, assetId: other.assetId }).expect(400);
    await prisma.project.update({ where: { id: f.project }, data: { archived: true } });
    await f.send().expect(403);
    expect(canvasCommandSchema.safeParse({ ...f.command, url: "https://example.com/forged.png" }).success).toBe(false);
    expect(await prisma.canvasMutation.count({ where: { projectId: f.project } })).toBe(0);
  } finally { await f.cleanup(); await other.cleanup(); await prisma.user.delete({ where: { id: viewer.id } }); }
}, 30000);
