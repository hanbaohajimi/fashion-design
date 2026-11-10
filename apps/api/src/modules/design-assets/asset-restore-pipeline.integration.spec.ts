import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@fashion/db";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import sharp from "sharp";
import { DesignAssetsController } from "./design-assets.controller";
import { DesignAssetsService } from "./design-assets.service";
import { S3FileStorage } from "../files/storage.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { WorkflowsService } from "../workflows/workflows.service";
import { WorkflowRuntimeService } from "../workflow-runtime/workflow-runtime.service";
import { WorkflowRuntimeController } from "../workflow-runtime/workflow-runtime.controller";
import { CanvasService } from "../canvas/canvas.service";
import { RateLimitGuard } from "../../security/rate-limit.guard";

const storage = new S3FileStorage(), access = new ProjectAccessPolicy(prisma);
const assets = new DesignAssetsService(prisma, storage, access);
const workflows = new WorkflowsService(prisma, access);
const paidCall = vi.fn(() => { throw new Error("历史恢复不得调用模型或生成任务"); });
const runtime = new WorkflowRuntimeService(prisma, workflows, { createFromAgent: paidCall } as never, { generate: paidCall } as never, storage, assets, undefined, undefined, access);
const canvas = new CanvasService(prisma, access, workflows);
let app: INestApplication;
beforeAll(async () => {
  const module = await Test.createTestingModule({ controllers: [DesignAssetsController, WorkflowRuntimeController], providers: [
    { provide: DesignAssetsService, useValue: assets }, { provide: WorkflowRuntimeService, useValue: runtime }, { provide: CanvasService, useValue: canvas },
  ] }).overrideGuard(RateLimitGuard).useValue({ canActivate: () => true }).compile();
  app = module.createNestApplication();
  app.use((req: Request & { auth?: unknown }, _res: Response, next: NextFunction) => { req.auth = { userId: req.headers["x-test-user"] }; next(); });
  await app.init();
});
afterAll(async () => { await app?.close(); expect(paidCall).not.toHaveBeenCalled(); });

async function fixture() {
  const owner = await prisma.user.create({ data: { email: `restore-pipeline-${randomUUID()}@example.test`, ownedWorkspaces: { create: { name: "恢复链路验收", projects: { create: { name: "历史图片" } } } } }, include: { ownedWorkspaces: { include: { projects: true } } } });
  const workspace = owner.ownedWorkspaces[0], project = workspace?.projects[0];
  if (!workspace || !project) throw new Error("测试项目不存在");
  const viewer = await prisma.user.create({ data: { email: `restore-viewer-${randomUUID()}@example.test` } });
  await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: viewer.id, role: "VIEWER" } });
  const root = randomUUID(), current = randomUUID(), node = randomUUID();
  const key = `integration/asset-restore/${randomUUID()}/original.png`;
  const bytes = await sharp({ create: { width: 32, height: 48, channels: 4, background: { r: 30, g: 65, b: 95, alpha: .75 } } }).png().toBuffer();
  await storage.uploadBuffer(key, bytes, "image/png", createHash("sha256").update(bytes).digest("base64"));
  await prisma.designAsset.create({ data: { id: root, rootAssetId: root, projectId: project.id, operation: "GENERATED", url: `s3://${key}`, width: 32, height: 48, archivedAt: new Date(), createdAt: new Date("2026-10-01T00:00:00Z"), designStep: { create: { projectId: project.id, actor: "test", tool: "t2i", intent: "历史藏蓝外套", inputSnapshot: {} } } } });
  await prisma.designAsset.create({ data: { id: current, rootAssetId: root, parentAssetId: root, projectId: project.id, operation: "TRANSFORM", url: `s3://${key}`, width: 32, height: 48, createdAt: new Date("2026-10-02T00:00:00Z") } });
  await workflows.applySystemMutation(project.id, { mode: "semantic", mutationId: randomUUID(), baseRevision: 0, operations: [{ type: "add_node", node: { id: node, type: "candidate", kind: "asset", title: "当前外套", payload: { assetId: current, imageUrl: `/api/design-assets/${current}/content` }, status: "completed", x: 0, y: 0 } }] });
  await canvas.initialize(owner.id, project.id);
  const restore = (user = owner.id, requestId = randomUUID()) => request(app.getHttpServer()).post(`/design-assets/${root}/restore`).set("x-test-user", user).send({ currentAssetId: current, clientRequestId: requestId });
  const attach = (assetId: string, mutationId = randomUUID(), user = owner.id) => request(app.getHttpServer()).post(`/projects/${project.id}/workflow/import-asset`).set("x-test-user", user).send({ sourceNodeId: node, assetId, operation: "restore", mutationId });
  return { owner: owner.id, viewer: viewer.id, workspace: workspace.id, project: project.id, root, current, node, key, bytes, restore, attach,
    cleanup: async () => { await storage.delete(key); await prisma.workspace.delete({ where: { id: workspace.id } }); await prisma.user.deleteMany({ where: { id: { in: [owner.id, viewer.id] } } }); } };
}

it("真实HTTP恢复归档历史并接入白板，原文件字节和两个来源均保留", async () => {
  const f = await fixture();
  try {
    const restored = await f.restore().expect(201); const id = restored.body.id as string;
    expect(restored.body).toMatchObject({ operation: "restore", parentAssetId: f.current, restoredFromAssetId: f.root, archivedAt: null });
    const response = await f.attach(id); expect(response.status, JSON.stringify(response.body)).toBe(201);
    const output = response.body.nodes.find((node: { payload: { assetId?: string } }) => node.payload.assetId === id);
    expect(output).toMatchObject({ type: "candidate", title: "恢复的版本" });
    const document = await canvas.read(f.owner, f.project);
    expect(document.bindings.filter(binding => binding.nodeId === output.id)).toHaveLength(1);
    expect(document.bindings.some(binding => binding.nodeId === f.node)).toBe(true);
    const download = await request(app.getHttpServer()).get(`/design-assets/${id}/content`).set("x-test-user", f.owner).expect(307);
    expect(download.headers["cache-control"]).toBe("private, no-store");
    const url = download.headers.location; if (!url) throw new Error("缺少文件地址");
    const original = await fetch(url); expect(original.ok).toBe(true);
    expect(Buffer.from(await original.arrayBuffer())).toEqual(f.bytes);
    const path = await request(app.getHttpServer()).get(`/design-assets/${id}/path`).set("x-test-user", f.owner).expect(200);
    const restoreStep = path.body.steps.find((step: { tool: string }) => step.tool === "restore_version" || step.tool === "restore");
    expect(restoreStep, JSON.stringify(path.body)).toBeTruthy();
    expect(restoreStep.sources).toEqual(expect.arrayContaining([expect.objectContaining({ assetId: f.root, role: "restore_source" }), expect.objectContaining({ assetId: f.current, role: "edit_source" })]));
    expect((await prisma.designAsset.findUniqueOrThrow({ where: { id: f.root } })).archivedAt).not.toBeNull();
    expect(await prisma.generationTask.count({ where: { projectId: f.project } })).toBe(0);
  } finally { await f.cleanup(); }
}, 30000);

it("两步重复提交只保留一个恢复产物、执行回执和白板摆放", async () => {
  const f = await fixture();
  try {
    const requestId = randomUUID(), mutationId = randomUUID();
    const [a, b] = await Promise.all([f.restore(f.owner, requestId).expect(201), f.restore(f.owner, requestId).expect(201)]);
    expect(a.body.id).toBe(b.body.id);
    await f.attach(a.body.id, mutationId).expect(201);
    await f.attach(a.body.id, mutationId).expect(201);
    const graph = await workflows.get(f.owner, f.project), doc = await canvas.read(f.owner, f.project);
    const outputs = graph.nodes.filter(node => node.payload && typeof node.payload === "object" && !Array.isArray(node.payload) && node.payload.assetId === a.body.id);
    expect(outputs).toHaveLength(1); expect(doc.bindings.filter(binding => binding.nodeId === outputs[0]?.id)).toHaveLength(1);
    expect(await prisma.designAsset.count({ where: { projectId: f.project, operation: "RESTORE" } })).toBe(1);
    expect(await prisma.workflowAttempt.count({ where: { projectId: f.project, executionKey: `workflow:restore:${mutationId}` } })).toBe(1);
  } finally { await f.cleanup(); }
}, 30000);

it("只读成员能读历史但不能恢复，权限撤销阻止接入且不丢恢复记录", async () => {
  const f = await fixture();
  try {
    await request(app.getHttpServer()).get(`/design-assets/${f.current}/versions`).set("x-test-user", f.viewer).expect(200);
    await f.restore(f.viewer).expect(403);
    await prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: f.workspace, userId: f.viewer } }, data: { role: "EDITOR" } });
    const restored = await f.restore(f.viewer).expect(201);
    await prisma.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: f.workspace, userId: f.viewer } } });
    await f.attach(restored.body.id, randomUUID(), f.viewer).expect(403);
    await request(app.getHttpServer()).get(`/design-assets/${f.current}/versions`).set("x-test-user", f.viewer).expect(403);
    expect(await prisma.designAsset.findUnique({ where: { id: restored.body.id } })).not.toBeNull();
    expect(await prisma.workflowAttempt.count({ where: { projectId: f.project } })).toBe(0);
  } finally { await f.cleanup(); }
}, 30000);

it("项目归档后拒绝创建恢复和接入，已有图片记录保留", async () => {
  const f = await fixture();
  try {
    const restored = await f.restore().expect(201);
    await prisma.project.update({ where: { id: f.project }, data: { archived: true } });
    await f.restore().expect(403);
    await f.attach(restored.body.id).expect(403);
    expect(await prisma.designAsset.count({ where: { projectId: f.project, operation: "RESTORE" } })).toBe(1);
    await request(app.getHttpServer()).get(`/design-assets/${f.current}/versions`).set("x-test-user", f.owner).expect(200);
  } finally { await f.cleanup(); }
}, 30000);

it("两步之间来源节点变化时拒绝接入，已创建恢复版本不被删除", async () => {
  const f = await fixture();
  try {
    const restored = await f.restore().expect(201);
    const graph = await workflows.get(f.owner, f.project);
    await workflows.applySystemMutation(f.project, { mode: "semantic", mutationId: randomUUID(), baseRevision: graph.revision, operations: [{ type: "update_node", nodeId: f.node, payload: { assetId: f.root } }] });
    const rejected = await f.attach(restored.body.id);
    expect(rejected.status).toBe(400); expect(rejected.body.message).toContain("来源不匹配");
    expect(await prisma.designAsset.findUnique({ where: { id: restored.body.id } })).not.toBeNull();
    expect(await prisma.workflowAttempt.count({ where: { projectId: f.project } })).toBe(0);
  } finally { await f.cleanup(); }
}, 30000);

it("原文件丢失时不创建空恢复，文件重新可用后可沿用原编号", async () => {
  const f = await fixture();
  try {
    const requestId = randomUUID();
    await storage.delete(f.key);
    const failed = await f.restore(f.owner, requestId).expect(503);
    expect(failed.body.code).toBe("RESTORE_SOURCE_UNAVAILABLE");
    expect(await prisma.designAsset.count({ where: { projectId: f.project, operation: "RESTORE" } })).toBe(0);
    await storage.uploadBuffer(f.key, f.bytes, "image/png", createHash("sha256").update(f.bytes).digest("base64"));
    const restored = await f.restore(f.owner, requestId).expect(201);
    await f.attach(restored.body.id).expect(201);
    expect(await prisma.designAsset.count({ where: { projectId: f.project, operation: "RESTORE" } })).toBe(1);
  } finally { await f.cleanup(); }
}, 30000);

it("创建记录后原文件丢失阻止接入，重试不会重复新建资产", async () => {
  const f = await fixture();
  try {
    const requestId = randomUUID(), mutationId = randomUUID();
    const restored = await f.restore(f.owner, requestId).expect(201);
    await storage.delete(f.key);
    await f.attach(restored.body.id, mutationId).expect(503);
    expect(await prisma.workflowAttempt.count({ where: { projectId: f.project } })).toBe(0);
    const replay = await f.restore(f.owner, requestId).expect(201); expect(replay.body.id).toBe(restored.body.id);
    await storage.uploadBuffer(f.key, f.bytes, "image/png", createHash("sha256").update(f.bytes).digest("base64"));
    await f.attach(replay.body.id, mutationId).expect(201);
    expect(await prisma.designAsset.count({ where: { projectId: f.project, operation: "RESTORE" } })).toBe(1);
  } finally { await f.cleanup(); }
}, 30000);
