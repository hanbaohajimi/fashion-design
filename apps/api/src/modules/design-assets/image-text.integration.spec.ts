import { prisma } from "@fashion/db";
import { Test } from "@nestjs/testing";
import type { AmuxClaudeJsonRequest } from "@fashion/ai";
import request from "supertest";
import sharp from "sharp";
import { afterAll, expect, it, vi } from "vitest";
import {
  RATE_LIMIT_STORE,
  RateLimitGuard,
} from "../../security/rate-limit.guard";
import { S3FileStorage } from "../files/storage.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { ImageWorkspaceService } from "./image-workspace.service";
import { ImageTextService } from "./image-text.service";
import { ImageTextController } from "./image-text.controller";
import { S3ThumbnailStorage } from "../../../../worker/src/storage";

afterAll(async () => prisma.$disconnect());
it("实际 HTTP、数据库与私有图片识别：编辑权限、缓存隔离和限流；供应商结果受控", async () => {
  const owner = await prisma.user.create({
    data: {
      email: `text-owner-${crypto.randomUUID()}@example.com`,
      ownedWorkspaces: {
        create: {
          name: "文字识别验证",
          projects: { create: { name: "图片文字" } },
        },
      },
    },
    include: { ownedWorkspaces: { include: { projects: true } } },
  });
  const member = await prisma.user.create({
    data: { email: `text-viewer-${crypto.randomUUID()}@example.com` },
  });
  const workspace = owner.ownedWorkspaces[0];
  const project = workspace?.projects[0];
  if (!workspace || !project) throw new Error("文字识别测试项目未创建");
  const store = new S3ThumbnailStorage();
  const key = `integration/text/${crypto.randomUUID()}.png`;
  const source = await sharp(
    Buffer.from(
      '<svg width="600" height="800"><rect width="600" height="800" fill="white"/><text x="60" y="220" font-size="40">SENZHI</text></svg>',
    ),
  )
    .png()
    .toBuffer();
  const regions = [
    { text: "SENZHI", rect: { x: 0.1, y: 0.2, width: 0.6, height: 0.1 } },
  ];
  const generateJson = vi.fn(async <T>(input: AmuxClaudeJsonRequest<T>) => {
    const image = input.images?.[0]?.url;
    expect(image?.startsWith("data:image/png;base64,")).toBe(true);
    const encoded = image?.split(",")[1];
    if (!encoded) throw new Error("识别请求缺少图片内容");
    expect(
      (await sharp(Buffer.from(encoded, "base64")).metadata())
        .width,
    ).toBe(600);
    return input.parse({ regions });
  });
  const images = new ImageWorkspaceService(
    prisma,
    new ProjectAccessPolicy(prisma),
    new S3FileStorage(),
  );
  const service = new ImageTextService(images, {
    generateJson: <T>(input: AmuxClaudeJsonRequest<T>) =>
      generateJson(input) as Promise<T>,
  });
  const consume = vi.fn(async () => ({ count: 1, retryAfterSeconds: 60 }));
  const module = await Test.createTestingModule({
    controllers: [ImageTextController],
    providers: [
      { provide: ImageTextService, useValue: service },
      RateLimitGuard,
      { provide: RATE_LIMIT_STORE, useValue: { consume } },
    ],
  }).compile();
  const app = module.createNestApplication();
  app.use(
    (
      req: { auth: unknown; headers: Record<string, string> },
      _res: unknown,
      next: () => void,
    ) => {
      req.auth = { userId: req.headers["x-test-user"] };
      next();
    },
  );
  await app.init();
  try {
    await store.put(key, source, "image/png");
    const assetId = crypto.randomUUID();
    const asset = await prisma.designAsset.create({
      data: {
        id: assetId,
        rootAssetId: assetId,
        projectId: project.id,
        operation: "IMPORTED",
        url: `s3://${key}`,
        width: 600,
        height: 800,
      },
    });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: member.id, role: "VIEWER" },
    });
    const scan = (user = owner.id) =>
      request(app.getHttpServer())
        .post(`/design-assets/${asset.id}/text-regions`)
        .set("x-test-user", user)
        .send({});
    await scan(member.id).expect(403);
    expect(generateJson).not.toHaveBeenCalled();
    const first = await scan().expect(201);
    expect(first.headers["cache-control"]).toBe("private, no-store");
    expect(first.body).toMatchObject({ regions, width: 600, height: 800 });
    expect((await scan().expect(201)).body).toEqual(first.body);
    expect(generateJson).toHaveBeenCalledOnce();
    await prisma.workspaceMember.updateMany({
      where: { workspaceId: workspace.id, userId: member.id },
      data: { role: "EDITOR" },
    });
    await scan(member.id).expect(201);
    expect(generateJson).toHaveBeenCalledTimes(2);
    await prisma.workspaceMember.deleteMany({
      where: { workspaceId: workspace.id, userId: member.id },
    });
    await scan(member.id).expect(403);
    expect(generateJson).toHaveBeenCalledTimes(2);
    consume.mockResolvedValueOnce({ count: 11, retryAfterSeconds: 42 });
    expect((await scan().expect(429)).headers["retry-after"]).toBe("42");
    await prisma.designAsset.update({
      where: { id: asset.id },
      data: { archivedAt: new Date() },
    });
    await scan().expect(404);
    expect(await store.get(key)).toEqual(source);
    expect(
      await prisma.generationTask.count({ where: { userId: owner.id } }),
    ).toBe(0);
  } finally {
    await app.close();
    await store.delete(key);
    await prisma.workspace.deleteMany({ where: { ownerId: owner.id } });
    await prisma.user.deleteMany({
      where: { id: { in: [owner.id, member.id] } },
    });
  }
}, 30_000);
