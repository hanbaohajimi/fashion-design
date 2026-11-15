import { prisma } from "@fashion/db";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import type { LibraryAsset } from "@fashion/shared";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { S3FileStorage } from "../files/storage.service";
import { AssetLibraryService } from "./asset-library.service";
import { AssetLibraryController } from "./asset-library.controller";
import { assetQuerySchema, type AssetQuery } from "./asset-library.schemas";

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("测试数据缺失");
  return value;
}
const storage = new S3FileStorage();
const service = new AssetLibraryService(
  prisma,
  new ProjectAccessPolicy(prisma),
  storage,
);
const at = new Date("2026-11-14T00:00:00Z");
const query = (overrides: Partial<AssetQuery> = {}) =>
  assetQuerySchema.parse(overrides);
const ids: string[] = [];
let app: INestApplication,
  owner = "",
  viewer = "",
  stranger = "",
  workspace = "",
  project = "",
  second = "",
  fileId = "",
  exportId = "",
  objectKey = "";
let bytes: Buffer;
beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `asset-library-${randomUUID()}@example.com`,
      ownedWorkspaces: {
        create: {
          name: "资产库验证",
          projects: {
            create: [
              { name: "秋冬项目" },
              { name: "春夏项目", archived: true },
            ],
          },
        },
      },
    },
    include: { ownedWorkspaces: { include: { projects: true } } },
  });
  owner = user.id;
  workspace = required(user.ownedWorkspaces[0]).id;
  project = required(required(user.ownedWorkspaces[0]).projects[0]).id;
  second = required(required(user.ownedWorkspaces[0]).projects[1]).id;
  viewer = (
    await prisma.user.create({
      data: { email: `asset-reader-${randomUUID()}@example.com` },
    })
  ).id;
  stranger = (
    await prisma.user.create({
      data: { email: `asset-stranger-${randomUUID()}@example.com` },
    })
  ).id;
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace, userId: viewer, role: "VIEWER" },
  });
  bytes = await sharp({
    create: {
      width: 24,
      height: 32,
      channels: 4,
      background: { r: 45, g: 90, b: 60, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  objectKey = `integration/asset-library/${randomUUID()}/upload.png`;
  await storage.uploadBuffer(
    objectKey,
    bytes,
    "image/png",
    createHash("sha256").update(bytes).digest("base64"),
  );
  const file = await prisma.fileAsset.create({
    data: {
      ownerId: owner,
      originalName: "共享参考.png",
      mimeType: "image/png",
      sizeBytes: bytes.length,
      sha256: randomUUID(),
      objectKey,
      status: "READY",
      width: 24,
      height: 32,
    },
  });
  fileId = file.id;
  for (const projectId of [project, second]) {
    const id = randomUUID();
    await prisma.designAsset.create({
      data: {
        id,
        rootAssetId: id,
        projectId,
        operation: "IMPORTED",
        sourceFileId: fileId,
        url: `s3://${objectKey}`,
        createdAt: at,
      },
    });
  }
  for (let i = 0; i < 7; i++) {
    const id = randomUUID();
    ids.push(id);
    await prisma.designAsset.create({
      data: {
        id,
        rootAssetId: id,
        projectId: i % 2 ? second : project,
        operation: "GENERATED",
        url: `s3://${objectKey}`,
        createdAt: at,
        designStep: {
          create: {
            projectId: i % 2 ? second : project,
            actor: "test",
            tool: "t2i",
            intent: `外套方案 ${i}`,
            inputSnapshot: {},
          },
        },
      },
    });
  }
  const mask = randomUUID();
  await prisma.designAsset.create({
    data: {
      id: mask,
      rootAssetId: mask,
      projectId: project,
      operation: "GENERATED",
      url: `s3://${objectKey}`,
      designStep: {
        create: {
          projectId: project,
          actor: "test",
          tool: "wardrobe-material-mask",
          intent: "内部蒙版",
          inputSnapshot: {},
        },
      },
    },
  });
  const deleted = await prisma.project.create({
    data: { wsId: workspace, name: "已删除项目", deletedAt: at },
  });
  const hidden = randomUUID();
  await prisma.designAsset.create({
    data: {
      id: hidden,
      rootAssetId: hidden,
      projectId: deleted.id,
      operation: "GENERATED",
      url: `s3://${objectKey}`,
    },
  });
  const show = await prisma.runwayShow.create({
    data: {
      projectId: project,
      ownerId: owner,
      title: "服装秀测试",
      draft: {},
      requestKey: randomUUID(),
    },
  });
  const run = await prisma.runwayRun.create({
    data: {
      projectId: project,
      userId: owner,
      showId: show.id,
      requestKey: randomUUID(),
      inputSnapshot: {},
      status: "SUCCEEDED",
    },
  });
  for (const uploaded of [false, true])
    await prisma.runwayMedia.create({
      data: {
        projectId: project,
        runId: run.id,
        kind: uploaded ? "model" : "music",
        mimeType: uploaded ? "image/png" : "audio/mpeg",
        originalName: uploaded ? "模特参考.png" : "生成音乐.mp3",
        objectKey: `integration/record-only/${randomUUID()}`,
        sha256: randomUUID(),
        sizeBytes: 12,
        source: { input: uploaded },
        createdAt: at,
      },
    });
  for (const expired of [false, true]) {
    const record = await prisma.exportJob.create({
      data: {
        projectId: project,
        userId: owner,
        format: "PDF",
        quality: "STANDARD",
        watermark: false,
        status: expired ? "EXPIRED" : "SUCCEEDED",
        objectKey: `integration/record-only/${randomUUID()}`,
        fileName: "技术包.pdf",
        expiresAt: expired ? at : new Date(Date.now() + 600000),
        createdAt: at,
      },
    });
    if (expired) exportId = record.id;
  }
  const module = await Test.createTestingModule({
    controllers: [AssetLibraryController],
    providers: [{ provide: AssetLibraryService, useValue: service }],
  }).compile();
  app = module.createNestApplication();
  app.use(
    (req: Request & { auth?: unknown }, _res: Response, next: NextFunction) => {
      req.auth = { userId: req.headers["x-test-user"] ?? viewer };
      next();
    },
  );
  await app.init();
}, 30000);
afterAll(async () => {
  await app?.close();
  if (objectKey) await storage.delete(objectKey);
  if (workspace) await prisma.workspace.delete({ where: { id: workspace } });
  for (const id of [owner, viewer, stranger].filter(Boolean))
    await prisma.user.delete({ where: { id } });
}, 30000);

async function allPages(options: Partial<AssetQuery>) {
  const result: LibraryAsset[] = [];
  let cursor: string | undefined;
  do {
    const page = await service.list(
      viewer,
      query({ ...options, limit: 3, ...(cursor ? { cursor } : {}) }),
    );
    result.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return result;
}
describe("跨项目资产库真实数据库与存储", () => {
  it("聚合四种资源、去重上传、保留归档项目且过滤内部及删除资源", async () => {
    const page = await service.list(viewer, query({ limit: 60 }));
    expect(page.items).toHaveLength(12);
    expect(page.counts).toEqual({
      all: 12,
      image: 9,
      video: 0,
      audio: 1,
      document: 2,
    });
    expect(
      page.items.find((item) => item.domain === "file")?.projects,
    ).toHaveLength(2);
    expect(
      page.items.filter((item) => item.title === "共享参考.png"),
    ).toHaveLength(1);
    expect(page.items.some((item) => item.archived)).toBe(true);
    expect(
      page.items.find((item) => item.resourceId === exportId)?.status,
    ).toBe("expired");
    expect(
      page.items.find((item) => item.resourceId === exportId)?.contentUrl,
    ).toBeNull();
  });
  it("同时间跨资源连续分页与双向时间排序无重复遗漏", async () => {
    for (const sort of ["newest", "oldest"] as const) {
      const rows = await allPages({ sort });
      const whole = await service.list(viewer, query({ sort, limit: 60 }));
      expect(rows.map((row) => row.id)).toEqual(
        whole.items.map((row) => row.id),
      );
      expect(new Set(rows.map((row) => row.id)).size).toBe(12);
    }
  });
  it("只读成员可设置个人评级，两个账号互不影响并持久化", async () => {
    await request(app.getHttpServer())
      .patch(`/assets/asset/${ids[0]}/rating`)
      .send({ rating: 5 })
      .expect(200);
    await service.rate(owner, "asset", required(ids[0]), 1);
    expect(
      (await service.list(viewer, query({ rating: "5" }))).items.map(
        (item) => item.resourceId,
      ),
    ).toEqual([ids[0]]);
    expect(
      (await service.list(owner, query({ rating: "1" }))).items.map(
        (item) => item.resourceId,
      ),
    ).toEqual([ids[0]]);
    expect(
      (
        await prisma.assetRating.findUniqueOrThrow({
          where: {
            userId_domain_resourceId: {
              userId: viewer,
              domain: "asset",
              resourceId: required(ids[0]),
            },
          },
        })
      ).rating,
    ).toBe(5);
  });
  it("跨页按评级排序，未评级始终最后，清除后恢复未评级", async () => {
    await service.rate(viewer, "asset", required(ids[1]), 2);
    await service.rate(viewer, "file", fileId, 5);
    for (const sort of ["rating-asc", "rating-desc"] as const) {
      const rows = await allPages({ sort });
      expect(rows).toHaveLength(12);
      expect(new Set(rows.map((row) => row.id)).size).toBe(12);
      expect(rows.slice(0, 3).map((row) => row.rating)).toEqual(
        sort === "rating-asc" ? [2, 5, 5] : [5, 5, 2],
      );
      expect(rows.slice(3).every((row) => row.rating === null)).toBe(true);
    }
    await service.rate(viewer, "asset", required(ids[1]), null);
    expect(
      (
        await service.list(viewer, query({ rating: "unrated", limit: 60 }))
      ).items.some((row) => row.resourceId === ids[1]),
    ).toBe(true);
  });
  it("搜索、来源和分类数量由完整数据库结果计算", async () => {
    const generated = await service.list(
      viewer,
      query({ source: "generated", kind: "audio", limit: 1 }),
    );
    expect(generated.items).toHaveLength(1);
    expect(generated.counts.all).toBe(8);
    const matching = await service.list(
      viewer,
      query({ q: "春夏项目", kind: "image", limit: 60 }),
    );
    expect(matching.items.length).toBeGreaterThan(1);
    expect(
      matching.items.every((row) =>
        row.projects.some((p) => p.name === "春夏项目"),
      ),
    ).toBe(true);
    expect((await service.list(viewer, query({ q: "%_" }))).items).toHaveLength(
      0,
    );
  });
  it("校验评级、游标账号和筛选范围，陌生账号无法读写或签名", async () => {
    for (const rating of [0, 6, 1.5, "5"])
      await request(app.getHttpServer())
        .patch(`/assets/asset/${ids[0]}/rating`)
        .send({ rating })
        .expect(400);
    const first = await service.list(viewer, query({ limit: 2 }));
    await expect(
      service.list(
        viewer,
        query({ cursor: required(first.nextCursor), sort: "oldest" }),
      ),
    ).rejects.toThrow("分页信息");
    await expect(
      service.list(owner, query({ cursor: required(first.nextCursor) })),
    ).rejects.toThrow("分页信息");
    expect((await service.list(stranger, query())).items).toEqual([]);
    await request(app.getHttpServer())
      .patch(`/assets/asset/${ids[0]}/rating`)
      .set("x-test-user", stranger)
      .send({ rating: 4 })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/assets/file/${fileId}/download`)
      .set("x-test-user", stranger)
      .expect(404);
  });
  it("原文件下载保留真实字节，过期与权限撤销立即阻止读取", async () => {
    const download = await request(app.getHttpServer())
      .get(`/assets/file/${fileId}/download`)
      .expect(200);
    expect(
      Buffer.from(await (await fetch(download.body.url)).arrayBuffer()),
    ).toEqual(bytes);
    await request(app.getHttpServer())
      .get(`/assets/file/${fileId}/content`)
      .expect(307);
    await request(app.getHttpServer())
      .get(`/assets/export/${exportId}/download`)
      .expect(410);
    await prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId: workspace, userId: viewer } },
    });
    try {
      expect((await service.list(viewer, query())).items).toEqual([]);
      await request(app.getHttpServer())
        .get(`/assets/file/${fileId}/content`)
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/assets/file/${fileId}/rating`)
        .send({ rating: 1 })
        .expect(404);
    } finally {
      await prisma.workspaceMember.create({
        data: { workspaceId: workspace, userId: viewer, role: "VIEWER" },
      });
    }
  });
});
