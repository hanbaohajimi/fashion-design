import { randomUUID } from "node:crypto";
import { prisma, readAuthorizedStudioBrand } from "@fashion/db";
import { studioTechPackSchema } from "@fashion/shared";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { ExportsController } from "./exports.controller";
import { ExportsService } from "./exports.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { StudioService } from "../studio/studio.service";

const access = new ProjectAccessPolicy(prisma);
const jobs = { enqueue: vi.fn().mockResolvedValue(undefined) };
const exportsService = new ExportsService(prisma, jobs, {} as never, access);
const studio = new StudioService(prisma, access);
let app: INestApplication;
let ownerId = "", editorId = "", reviewerId = "", workspaceId = "", projectId = "", assetId = "", brandId = "";

beforeAll(async () => {
  const owner = await prisma.user.create({ data: { email: `export-approval-${randomUUID()}@example.test`, ownedWorkspaces: { create: { name: "导出审批回归", projects: { create: { name: "隔离导出项目" } } } } }, include: { ownedWorkspaces: { include: { projects: true } } } });
  ownerId = owner.id;
  const workspace = owner.ownedWorkspaces[0], project = workspace?.projects[0];
  if (!workspace || !project) throw new Error("缺少测试项目");
  workspaceId = workspace.id; projectId = project.id;
  const editor = await prisma.user.create({ data: { email: `export-editor-${randomUUID()}@example.test` } });
  editorId = editor.id;
  await prisma.workspaceMember.create({ data: { workspaceId, userId: editorId, role: "EDITOR" } });
  const reviewer = await prisma.user.create({ data: { email: `export-reviewer-${randomUUID()}@example.test` } });
  reviewerId = reviewer.id;
  await prisma.workspaceMember.create({ data: { workspaceId, userId: reviewerId, role: "REVIEWER" } });
  assetId = randomUUID();
  await prisma.designAsset.create({ data: { id: assetId, rootAssetId: assetId, projectId, operation: "GENERATED", url: `s3://integration/export-approval/${assetId}.png`, width: 60, height: 80 } });
  const brand = await prisma.studioDocument.create({ data: { projectId, ownerId, createdById: ownerId, type: "BRAND_PROFILE", documentId: randomUUID(), revision: 1, payload: { name: "私有品牌", referenceAssetIds: [], colors: [] } } });
  brandId = brand.id;
  const module = await Test.createTestingModule({ controllers: [ExportsController], providers: [{ provide: ExportsService, useValue: exportsService }] }).compile();
  app = module.createNestApplication();
  app.use((req: Request & { auth?: unknown }, _res: Response, next: NextFunction) => { req.auth = { userId: req.headers["x-test-user"] }; next(); });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  if (projectId) {
    await prisma.studioDocument.deleteMany({ where: { projectId } });
    await prisma.styleRevision.deleteMany({ where: { style: { projectId } } });
    await prisma.style.deleteMany({ where: { projectId } });
  }
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } });
  if (editorId) await prisma.user.delete({ where: { id: editorId } });
  if (reviewerId) await prisma.user.delete({ where: { id: reviewerId } });
  if (ownerId) await prisma.user.delete({ where: { id: ownerId } });
});

const send = (userId: string, body: Record<string, unknown>, key = randomUUID()) => request(app.getHttpServer()).post("/exports").set("x-test-user", userId).set("idempotency-key", key).send({ sourceType: "asset", assetId, quality: "standard", ...body });

it.each(["png", "jpg", "webp", "pdf"])("%s 单图导出经过实际HTTP和数据库约束，同编号重放不创建新任务", async format => {
  const key = randomUUID();
  const first = await send(ownerId, { format }, key).expect(202);
  const replay = await send(ownerId, { format }, key).expect(202);
  expect(first.body).toMatchObject({ format, status: "queued" });
  expect(first.body.id).toBe(replay.body.id);
  expect(await prisma.exportJob.count({ where: { userId: ownerId, requestKey: key } })).toBe(1);
  expect(await prisma.workflowOutbox.count({ where: { projectId, eventKey: `export:${first.body.id}:dispatch` } })).toBe(1);
});

it("同项目编辑者不能把另一账号的私有品牌写入导出，所有者仍可使用", async () => {
  const count = await prisma.exportJob.count({ where: { projectId } });
  await send(editorId, { format: "pdf", brandRevisionId: brandId }).expect(404);
  expect(await prisma.exportJob.count({ where: { projectId } })).toBe(count);
  const own = await send(ownerId, { format: "pdf", brandRevisionId: brandId }).expect(202);
  expect(own.body.brandRevisionId).toBe(brandId);
});

it("同项目其他成员不能通过保存技术包取得私有品牌引用", async () => {
  const pack = studioTechPackSchema.parse({ name: "待核对技术包", styleRevisionId: "not-yet-referenced", brandRevisionId: brandId });
  await expect(studio.saveDocument(editorId, projectId, { type: "TECH_PACK", requestKey: randomUUID(), payload: pack })).rejects.toThrow("品牌资料修订不存在或不属于当前项目");
  expect(await prisma.studioDocument.count({ where: { projectId, type: "TECH_PACK" } })).toBe(0);
});

it("品牌所有者明确绑定的共享资料允许同事保留引用，不能借此使用其他私有品牌", async () => {
  const style = await prisma.style.create({ data: { projectId, code: `test-${randomUUID()}`, name: "隔离款式", category: "外套", season: "AW26" } });
  const revision = await prisma.styleRevision.create({ data: { styleId: style.id, revision: 1, sourceAssetId: assetId, createdBy: ownerId, payload: {
    name: "隔离款式", code: style.code, category: "外套", season: "AW26", description: "", sourceAssetId: assetId, views: [], status: "DESIGNING", changeNote: "",
  } } });
  const pack = studioTechPackSchema.parse({
    name: "已授权品牌技术包", styleRevisionId: revision.id, brandRevisionId: brandId,
    views: [{ kind: "front", assetId, reviewed: true }, { kind: "back", assetId, reviewed: true }],
    bom: [{ name: "主料", material: "棉", quantity: 2, unit: "m", reviewed: true, source: "supplier" }],
    pom: [{ name: "胸围", value: 100, tolerance: 1, reviewed: true, source: "measured" }],
    colors: [{ name: "藏蓝", hex: "#203449", reviewed: true }],
  });
  const created = await studio.saveDocument(ownerId, projectId, { type: "TECH_PACK", requestKey: randomUUID(), payload: pack });
  const updated = await studio.saveDocument(editorId, projectId, { type: "TECH_PACK", documentId: created.id, expectedVersion: 1, requestKey: randomUUID(), payload: { ...pack, name: "同事继续整理" } });
  expect(updated.version).toBe(2);
  const published = await studio.saveDocument(reviewerId, projectId, { type: "TECH_PACK", documentId: created.id, expectedVersion: 2, requestKey: randomUUID(), payload: { ...updated.currentRevision.payload, status: "PUBLISHED", reviewConfirmed: true } });
  expect(published.version).toBe(3);
  const saved = await prisma.studioDocument.findUniqueOrThrow({ where: { id: published.currentRevision.id } });
  expect((await readAuthorizedStudioBrand(prisma, { projectId, actorId: editorId, brandRevisionId: brandId, inherited: saved }))?.id).toBe(brandId);
  const exported = await exportsService.create(editorId, { sourceType: "tech_pack", studioRevisionId: saved.id, format: "pdf", quality: "standard" }, randomUUID());
  expect(exported.status).toBe("queued");
  const other = await prisma.studioDocument.create({ data: { projectId, ownerId, createdById: ownerId, type: "BRAND_PROFILE", documentId: randomUUID(), revision: 1, payload: { name: "另一私有品牌" } } });
  await expect(studio.saveDocument(editorId, projectId, { type: "TECH_PACK", documentId: created.id, expectedVersion: 3, requestKey: randomUUID(), payload: { ...pack, brandRevisionId: other.id } })).rejects.toThrow("品牌资料修订不存在或不属于当前项目");
});

it("历史未授权的私有品牌引用不能被当成合法继承", async () => {
  const forged = await prisma.studioDocument.create({ data: { projectId, ownerId: editorId, createdById: editorId, type: "TECH_PACK", documentId: randomUUID(), revision: 1, payload: { name: "旧未核实引用", brandRevisionId: brandId } } });
  expect(await readAuthorizedStudioBrand(prisma, { projectId, actorId: editorId, brandRevisionId: brandId, inherited: forged })).toBeNull();
});
