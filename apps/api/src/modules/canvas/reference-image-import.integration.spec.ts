import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@fashion/db";
import { canvasCommandSchema, type CanvasCommand } from "@fashion/shared";
import { afterAll, beforeAll, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import sharp from "sharp";
import { CanvasService } from "./canvas.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { WorkflowsService } from "../workflows/workflows.service";
import { S3FileStorage } from "../files/storage.service";
import { CanvasCommandService } from "../workflow-runtime/canvas-command.service";
import { CanvasCommandsController } from "../workflow-runtime/canvas-commands.controller";
import { RateLimitGuard } from "../../security/rate-limit.guard";
import { requireProjectFile } from "../files/project-file-access";
import { FilesController } from "../files/files.controller";
import { FilesService } from "../files/files.service";
import { createThumbnailProcessor } from "../../../../worker/src/processors/thumbnail.processor";
import { S3ThumbnailStorage } from "../../../../worker/src/storage";

const storage = new S3FileStorage(),
  access = new ProjectAccessPolicy(prisma),
  workflows = new WorkflowsService(prisma, access);
const canvas = new CanvasService(prisma, access, workflows),
  commands = new CanvasCommandService(canvas, workflows, {} as never, storage);
const enqueued: string[] = [];
const filesService = new FilesService(
  prisma,
  storage,
  {
    enqueue: async (id) => {
      enqueued.push(id);
    },
  },
  access,
);
let app: INestApplication;
beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [CanvasCommandsController, FilesController],
    providers: [
      { provide: CanvasCommandService, useValue: commands },
      { provide: FilesService, useValue: filesService },
    ],
  })
    .overrideGuard(RateLimitGuard)
    .useValue({ canActivate: () => true })
    .compile();
  app = module.createNestApplication();
  app.use(
    (req: Request & { auth?: unknown }, _res: Response, next: NextFunction) => {
      req.auth = { userId: req.headers["x-test-user"] };
      next();
    },
  );
  await app.init();
});
afterAll(async () => app?.close());
async function fixture() {
  const owner = await prisma.user.create({
    data: {
      email: `reference-import-${randomUUID()}@example.test`,
      ownedWorkspaces: {
        create: {
          name: "聊天参考验收",
          projects: { create: { name: "设计项目" } },
        },
      },
    },
    include: { ownedWorkspaces: { include: { projects: true } } },
  });
  const ws = owner.ownedWorkspaces[0],
    project = ws?.projects[0];
  if (!ws || !project) throw new Error("测试项目缺失");
  const editor = await prisma.user.create({
    data: { email: `reference-editor-${randomUUID()}@example.test` },
  });
  const viewer = await prisma.user.create({
    data: { email: `reference-viewer-${randomUUID()}@example.test` },
  });
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: editor.id, role: "EDITOR" },
      { workspaceId: ws.id, userId: viewer.id, role: "VIEWER" },
    ],
  });
  const bytes = await sharp({
    create: {
      width: 24,
      height: 32,
      channels: 4,
      background: { r: 30, g: 60, b: 90, alpha: 0.7 },
    },
  })
    .png()
    .toBuffer();
  const key = `integration/chat-reference/${randomUUID()}.png`;
  await storage.uploadBuffer(
    key,
    bytes,
    "image/png",
    createHash("sha256").update(bytes).digest("base64"),
  );
  const file = await prisma.fileAsset.create({
    data: {
      ownerId: editor.id,
      originalName: "外套原始参考.png",
      mimeType: "image/png",
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      objectKey: key,
      status: "READY",
      thumbnail256Key: key,
      thumbnail1024Key: key,
      width: 24,
      height: 32,
    },
  });
  await canvas.initialize(owner.id, project.id);
  const command: Extract<CanvasCommand, { type: "import_reference_image" }> = {
    type: "import_reference_image",
    mutationId: randomUUID(),
    fileId: file.id,
    position: { x: 200, y: 320 },
  };
  const send = (input: CanvasCommand = command, user = editor.id) =>
    request(app.getHttpServer())
      .post(`/projects/${project.id}/canvas/commands`)
      .set("x-test-user", user)
      .send(input);
  return {
    owner: owner.id,
    editor: editor.id,
    viewer: viewer.id,
    workspace: ws.id,
    project: project.id,
    file: file.id,
    key,
    bytes,
    command,
    send,
    cleanup: async () => {
      await storage.delete(key);
      await prisma.workspace.delete({ where: { id: ws.id } });
      await prisma.user.deleteMany({
        where: { id: { in: [owner.id, editor.id, viewer.id] } },
      });
    },
  };
}

it("聊天参考接入不增加摆放，读取与重新初始化不自动放回画布", async () => {
  const f = await fixture();
  try {
    const response = await f
      .send({ ...f.command, placement: "reference" })
      .expect(201);
    const nodeId = response.body.nodeId;
    expect(
      response.body.graph.nodes.find(
        (node: { id: string }) => node.id === nodeId,
      ).payload.canvasPlacement,
    ).toBe("manual");
    expect(response.body.canvas.bindings).toEqual([]);
    expect((await canvas.read(f.viewer, f.project)).bindings).toEqual([]);
    await prisma.canvasDocument.delete({ where: { projectId: f.project } });
    expect((await canvas.initialize(f.owner, f.project)).bindings).toEqual([]);
    expect(
      await requireProjectFile(prisma, access, f.viewer, f.file, f.project),
    ).toMatchObject({ id: f.file });
  } finally {
    await f.cleanup();
  }
}, 30000);

it("明确放置同一参考复用节点和已有位置，并发与重复回执不创建副本", async () => {
  const f = await fixture();
  try {
    const imported = await f
      .send({ ...f.command, placement: "reference" })
      .expect(201);
    const command: CanvasCommand = {
      type: "place_reference_image",
      mutationId: randomUUID(),
      nodeId: imported.body.nodeId,
      position: { x: 90, y: 130 },
    };
    const a = await f.send(command).expect(201);
    await Promise.all([
      f.send(command).expect(201),
      f
        .send({
          ...command,
          mutationId: randomUUID(),
          position: { x: 1000, y: 1000 },
        })
        .expect(201),
    ]);
    expect(a.body.canvas.bindings).toHaveLength(1);
    expect((await canvas.read(f.owner, f.project)).bindings).toHaveLength(1);
    expect(
      await prisma.workflowNode.count({ where: { projectId: f.project } }),
    ).toBe(1);
    expect(
      a.body.canvas.snapshot.placementHints[a.body.canvas.bindings[0].shapeId],
    ).toEqual({ x: 90, y: 130 });
    await prisma.canvasObjectBinding.updateMany({
      where: { projectId: f.project },
      data: { removedAt: new Date() },
    });
    expect(
      (await canvas.read(f.owner, f.project)).bindings.every(
        (binding) => binding.removed,
      ),
    ).toBe(true);
    const next = await f
      .send({ ...command, mutationId: randomUUID() })
      .expect(201);
    expect(
      next.body.canvas.bindings.filter(
        (binding: { removed: boolean }) => !binding.removed,
      ),
    ).toHaveLength(1);
    expect(
      next.body.canvas.bindings.filter(
        (binding: { removed: boolean }) => binding.removed,
      ),
    ).toHaveLength(1);
  } finally {
    await f.cleanup();
  }
}, 30000);

it("显式放置复核权限、来源和原文件，失败不写入摆放回执", async () => {
  const f = await fixture();
  try {
    const imported = await f
      .send({ ...f.command, placement: "reference" })
      .expect(201);
    const command: CanvasCommand = {
      type: "place_reference_image",
      mutationId: randomUUID(),
      nodeId: imported.body.nodeId,
    };
    await f.send(command, f.viewer).expect(403);
    await f.send({ ...command, nodeId: "missing" }).expect(400);
    await storage.delete(f.key);
    await f.send(command).expect(503);
    expect(
      await prisma.canvasObjectBinding.count({
        where: { projectId: f.project },
      }),
    ).toBe(0);
    await storage.uploadBuffer(
      f.key,
      f.bytes,
      "image/png",
      createHash("sha256").update(f.bytes).digest("base64"),
    );
    await prisma.project.update({
      where: { id: f.project },
      data: { archived: true },
    });
    await f.send(command).expect(403);
    await prisma.project.update({
      where: { id: f.project },
      data: { archived: false },
    });
    await f.send(command).expect(201);
  } finally {
    await f.cleanup();
  }
}, 30000);

it("项目编辑成员能接入自己新上传的图片，名称和地址均取自真实文件", async () => {
  const f = await fixture();
  try {
    const response = await f.send();
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const node = response.body.graph.nodes.find(
      (node: { id: string }) => node.id === response.body.nodeId,
    );
    expect(node).toMatchObject({
      type: "reference_image",
      title: "外套原始参考.png",
      payload: {
        fileAssetId: f.file,
        imageUrl: `/api/files/${f.file}/thumbnail/1024`,
        width: 24,
        height: 32,
        roleInferenceState: "none",
      },
    });
    expect(response.body.canvas.bindings).toHaveLength(1);
    const mutation = await prisma.workflowMutation.findFirstOrThrow({
      where: { projectId: f.project },
    });
    expect(mutation.actorId).toBe(f.editor);
    expect(
      await requireProjectFile(prisma, access, f.viewer, f.file, f.project),
    ).toMatchObject({ id: f.file });
    expect(
      await prisma.generationTask.count({ where: { projectId: f.project } }),
    ).toBe(0);
    expect(
      await prisma.agentConversation.count({ where: { projectId: f.project } }),
    ).toBe(0);
  } finally {
    await f.cleanup();
  }
}, 30000);

it("重复导入回执仅保留一份素材和摆放，异参不能复用原编号", async () => {
  const f = await fixture();
  try {
    const [a, b] = await Promise.all([
      f.send().expect(201),
      f.send().expect(201),
    ]);
    expect(a.body.nodeId).toBe(b.body.nodeId);
    expect(
      await prisma.workflowNode.count({ where: { projectId: f.project } }),
    ).toBe(1);
    expect(
      await prisma.canvasObjectBinding.count({
        where: { projectId: f.project },
      }),
    ).toBe(1);
    await f.send({ ...f.command, position: { x: 0, y: 0 } }).expect(409);
    const reused = await f
      .send({ ...f.command, mutationId: randomUUID() })
      .expect(201);
    expect(reused.body.nodeId).toBe(a.body.nodeId);
    expect(
      await prisma.workflowNode.count({ where: { projectId: f.project } }),
    ).toBe(1);
    expect(
      canvasCommandSchema.safeParse({
        ...f.command,
        imageUrl: "https://forged.test/picture",
      }).success,
    ).toBe(false);
  } finally {
    await f.cleanup();
  }
}, 30000);

it("未共享图片不能由其他成员先行引用，只读或撤销成员不能导入", async () => {
  const f = await fixture();
  try {
    await f.send(f.command, f.owner).expect(403);
    await f.send(f.command, f.viewer).expect(403);
    await prisma.workspaceMember.delete({
      where: {
        workspaceId_userId: { workspaceId: f.workspace, userId: f.editor },
      },
    });
    await f.send().expect(403);
    expect(
      await prisma.workflowNode.count({ where: { projectId: f.project } }),
    ).toBe(0);
  } finally {
    await f.cleanup();
  }
}, 30000);

it("未就绪文件、丢失原文件和归档项目拒绝导入，不留下半份记录", async () => {
  const f = await fixture();
  try {
    await prisma.fileAsset.update({
      where: { id: f.file },
      data: { status: "PROCESSING" },
    });
    await f.send().expect(400);
    await prisma.fileAsset.update({
      where: { id: f.file },
      data: { status: "READY" },
    });
    await storage.delete(f.key);
    await f.send().expect(503);
    expect(
      await prisma.canvasMutation.count({ where: { projectId: f.project } }),
    ).toBe(0);
    await storage.uploadBuffer(
      f.key,
      f.bytes,
      "image/png",
      createHash("sha256").update(f.bytes).digest("base64"),
    );
    await prisma.project.update({
      where: { id: f.project },
      data: { archived: true },
    });
    await f.send().expect(403);
  } finally {
    await f.cleanup();
  }
}, 30000);

it("实际签名直传和缩略图处理后可接入项目，去重重试保留原字节", async () => {
  const f = await fixture();
  const keys: string[] = [];
  try {
    const original = await sharp({
      create: {
        width: 37,
        height: 55,
        channels: 4,
        background: { r: 20, g: 90, b: 60, alpha: 0.8 },
      },
    })
      .png()
      .toBuffer();
    const body = {
      projectId: f.project,
      name: "聊天里的面料参考.png",
      mimeType: "image/png",
      size: original.length,
      sha256: createHash("sha256").update(original).digest("hex"),
    };
    const signed = await request(app.getHttpServer())
      .post("/files/sign-upload")
      .set("x-test-user", f.editor)
      .send(body)
      .expect(201);
    const signedBody = signed.body as {
      file: { id: string };
      upload: { url: string; headers: Record<string, string> };
    };
    const stored = await prisma.fileAsset.findUniqueOrThrow({
      where: { id: signedBody.file.id },
    });
    keys.push(stored.objectKey);
    expect(
      (
        await fetch(signedBody.upload.url, {
          method: "PUT",
          headers: signedBody.upload.headers,
          body: original,
        })
      ).ok,
    ).toBe(true);
    const completed = await request(app.getHttpServer())
      .post(`/files/${stored.id}/complete`)
      .set("x-test-user", f.editor)
      .expect(201);
    expect(completed.body.status).toBe("PROCESSING");
    expect(enqueued).toContain(stored.id);
    const processThumbnail = createThumbnailProcessor({
      database: prisma,
      storage: new S3ThumbnailStorage(),
    });
    await processThumbnail(stored.id);
    const processed = await prisma.fileAsset.findUniqueOrThrow({
      where: { id: stored.id },
    });
    for (const key of [processed.thumbnail256Key, processed.thumbnail1024Key])
      if (key) keys.push(key);
    const status = await request(app.getHttpServer())
      .get(`/files/${stored.id}`)
      .set("x-test-user", f.editor)
      .expect(200);
    expect(status.body).toMatchObject({
      status: "READY",
      width: 37,
      height: 55,
    });
    const input = { ...f.command, fileId: stored.id };
    await f.send(input).expect(201);
    const duplicate = await request(app.getHttpServer())
      .post("/files/sign-upload")
      .set("x-test-user", f.editor)
      .send(body)
      .expect(201);
    expect(duplicate.body.file.id).toBe(stored.id);
    expect(duplicate.body.upload).toBeNull();
    const thumbnail = await request(app.getHttpServer())
      .get(`/files/${stored.id}/thumbnail/1024`)
      .set("x-test-user", f.viewer)
      .expect(307);
    const thumbBytes = Buffer.from(
      await (await fetch(String(thumbnail.headers.location))).arrayBuffer(),
    );
    const metadata = await sharp(thumbBytes).metadata();
    expect(metadata).toMatchObject({ width: 37, height: 55, format: "webp" });
    expect(
      Buffer.from(
        await (
          await fetch(await storage.createDownloadUrl(stored.objectKey, 60))
        ).arrayBuffer(),
      ),
    ).toEqual(original);
    expect(
      await prisma.generationTask.count({ where: { projectId: f.project } }),
    ).toBe(0);
  } finally {
    for (const key of keys) await storage.delete(key);
    await f.cleanup();
  }
}, 30000);
