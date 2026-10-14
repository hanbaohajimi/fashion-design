import {
  DesignAssetOperation,
  FileStatus,
  GenerationTaskStatus,
  prisma,
} from "@fashion/db";
import { HttpStatus } from "@nestjs/common";
import { afterAll, describe, expect, it, vi } from "vitest";
import { BillingService } from "../billing/billing.service";
import { ContextCompilerService } from "../generation/compiler/context-compiler.service";
import { GenerationService } from "../generation/generation.service";
import { WorkflowsService } from "../workflows/workflows.service";

import { DesignAssetsService } from "./design-assets.service";

const service = new DesignAssetsService(prisma, {
  createDownloadUrl: async (objectKey: string) =>
    `https://signed.test/${objectKey}`,
} as never);

describe("DesignAssetsService lineage integration", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("已否决产物仍保留原执行快照和会话关联，即使节点已开始下一次尝试", async () => {
    const fixture = await createImportFixture();
    try {
      const conversation = await prisma.agentConversation.create({
        data: {
          projectId: fixture.projectId,
          createdById: fixture.userId,
          title: "可回溯的节点重试",
        },
      });
      const task = await prisma.generationTask.create({
        data: {
          userId: fixture.userId,
          projectId: fixture.projectId,
          status: GenerationTaskStatus.SUCCEEDED,
          taskType: "t2i",
          input: { prompt: "初次设计" },
          designStep: {
            create: {
              projectId: fixture.projectId,
              actor: "agent",
              tool: "t2i",
              intent: "初次设计",
              inputSnapshot: {
                version: 1,
                sources: [],
                constraints: {
                  palette: [],
                  notes: ["原始衣领要求"],
                  avoidLabels: [],
                  fabricTerms: [],
                },
                parameters: { prompt: "初次设计" },
              },
            },
          },
        },
      });
      const run = await prisma.agentRun.create({
        data: {
          userId: fixture.userId,
          projectId: fixture.projectId,
          conversationId: conversation.id,
          clientRequestId: crypto.randomUUID(),
          intent: "调整衣领",
          contextSnapshot: {},
          status: "running",
          steps: {
            create: {
              key: "draft",
              ordinal: 0,
              tool: "generate_design",
              title: "衣领方案",
              instruction: "调整衣领",
              prompt: "重新设计更窄的衣领",
              negativePrompt: "",
              status: "running",
              attempt: 2,
              attempts: {
                create: {
                  ordinal: 1,
                  executionKey: crypto.randomUUID(),
                  requestSnapshot: { prompt: "初次设计" },
                  status: "rejected",
                  error: "衣领过宽",
                  leaseToken: crypto.randomUUID(),
                  leaseExpiresAt: new Date(),
                  generationTaskId: task.id,
                },
              },
            },
          },
        },
      });
      const asset = await prisma.designAsset.create({
        data: {
          projectId: fixture.projectId,
          rootAssetId: crypto.randomUUID(),
          generationTaskId: task.id,
          operation: DesignAssetOperation.GENERATED,
          url: "s3://generated/old-attempt.png",
          decisions: {
            create: {
              userId: fixture.userId,
              kind: "rejected",
              reason: "衣领过宽",
              clientRequestId: `${run.id}:attempt-1:reject`,
            },
          },
        },
      });
      const path = await service.path(fixture.userId, asset.id);
      expect(path.steps.at(-1)).toMatchObject({
        conversationId: conversation.id,
        parameters: { prompt: "初次设计" },
        constraints: { notes: ["原始衣领要求"] },
        outputs: [
          { id: asset.id, url: `/api/design-assets/${asset.id}/content` },
        ],
      });
      expect(path.decisions).toEqual([
        expect.objectContaining({ kind: "rejected", reason: "衣领过宽" }),
      ]);
      expect(JSON.stringify(path)).not.toContain("重新设计更窄的衣领");
      expect(JSON.stringify(path)).not.toContain("s3://");
    } finally {
      await prisma.user.delete({ where: { id: fixture.userId } });
    }
  });

  it("Agent 编辑任务与步骤一起写入，白板修改和请求重放不覆盖原快照", async () => {
    const fixture = await createImportFixture();
    try {
      const root = await service.importFile(
        fixture.userId,
        fixture.projectId,
        fixture.fileId,
      );
      const note = await prisma.boardElement.create({
        data: {
          projectId: fixture.projectId,
          shapeId: "shape:note",
          shapeType: "fashion-note",
          role: "note",
          record: { props: { text: "保留袖口" } },
        },
      });
      const storage = {
        createDownloadUrl: async (key: string) => `https://signed.test/${key}`,
      };
      const model = { analyzeImage: vi.fn(), enhancePrompt: vi.fn() };
      const generation = new GenerationService(
        prisma,
        { enqueue: vi.fn(), cancel: vi.fn() },
        new BillingService(prisma),
        new ContextCompilerService(prisma, model, storage),
        storage as never,
      );
      const request = {
        taskType: "i2i" as const,
        parentAssetId: root.id,
        projectId: fixture.projectId,
        prompt: "revised coat",
        referenceImageUrl: "https://cdn.test/placeholder.png",
        width: 1024,
        height: 1024,
        shapeIds: [note.shapeId],
      };
      const first = await generation.createFromAgent(
        fixture.userId,
        request,
        "agent-replay",
        "调整衣领，保留袖口",
      );
      await prisma.boardElement.update({
        where: { id: note.id },
        data: { record: { props: { text: "新便签内容" } } },
      });
      const replay = await generation.createFromAgent(
        fixture.userId,
        request,
        "agent-replay",
        "调整衣领，保留袖口",
      );
      expect(replay.taskId).toBe(first.taskId);
      expect(model.enhancePrompt).not.toHaveBeenCalled();
      await expect(
        prisma.designStep.count({ where: { generationTaskId: first.taskId } }),
      ).resolves.toBe(1);
      await prisma.generationTask.update({
        where: { id: first.taskId },
        data: { status: GenerationTaskStatus.SUCCEEDED },
      });
      const output = await prisma.designAsset.create({
        data: {
          projectId: fixture.projectId,
          parentAssetId: root.id,
          rootAssetId: root.id,
          generationTaskId: first.taskId,
          operation: DesignAssetOperation.VARIATION,
          url: "https://cdn.test/output.png",
        },
      });
      const path = await service.path(fixture.userId, output.id);
      expect(path.steps.at(-1)).toMatchObject({
        actor: "agent",
        tool: "i2i",
        intent: "调整衣领，保留袖口",
        constraints: { notes: ["保留袖口"] },
        sources: expect.arrayContaining([
          expect.objectContaining({ elementId: note.id, text: "保留袖口" }),
          expect.objectContaining({ assetId: root.id, role: "edit_source" }),
        ]),
      });
      expect(JSON.stringify(path.steps.at(-1))).not.toContain(
        "https://signed.test",
      );
    } finally {
      await prisma.user.delete({ where: { id: fixture.userId } });
    }
  });

  it("分页显示完整血缘，恢复会创建新版本且可再次反向恢复", async () => {
    const fixture = await createFixture();
    try {
      const firstPage = await service.versions(
        fixture.userId,
        fixture.currentId,
        undefined,
        2,
      );
      expect(firstPage.items.map((item) => item.id)).toEqual([
        fixture.currentId,
        fixture.middleId,
      ]);
      expect(firstPage.nextCursor).toBe(fixture.middleId);

      const secondPage = await service.versions(
        fixture.userId,
        fixture.currentId,
        firstPage.nextCursor ?? undefined,
        2,
      );
      expect(secondPage.items.map((item) => item.id)).toEqual([fixture.rootId]);
      expect(secondPage.nextCursor).toBeNull();

      const restoredRoot = await service.restore(
        fixture.userId,
        fixture.rootId,
        fixture.currentId,
      );
      expect(restoredRoot).toMatchObject({
        operation: "restore",
        parentAssetId: fixture.currentId,
        restoredFromAssetId: fixture.rootId,
        url: "https://cdn.test/root.png",
      });

      const restoredCurrent = await service.restore(
        fixture.userId,
        fixture.currentId,
        restoredRoot.id,
      );
      expect(restoredCurrent).toMatchObject({
        operation: "restore",
        parentAssetId: restoredRoot.id,
        restoredFromAssetId: fixture.currentId,
        url: "https://cdn.test/current.png",
      });
      await expect(
        prisma.designAsset.findUniqueOrThrow({
          where: { id: restoredRoot.id },
        }),
      ).resolves.toMatchObject({ archivedAt: null });
      const path = await service.path(fixture.userId, restoredCurrent.id);
      expect(path.steps).toHaveLength(5);
      expect(path.steps.at(-1)).toMatchObject({
        tool: "restore",
        snapshotAvailable: true,
        sources: expect.arrayContaining([
          expect.objectContaining({
            assetId: restoredRoot.id,
            role: "edit_source",
          }),
          expect.objectContaining({
            assetId: fixture.currentId,
            role: "restore_source",
          }),
        ]),
      });
      expect(path.incomplete).toBe(false);
    } finally {
      await prisma.user.delete({ where: { id: fixture.userId } });
    }
  });

  it("版本恢复请求重放只创建一个资产，异参复用请求号会冲突", async () => {
    const fixture = await createFixture();
    try {
      const requestId = crypto.randomUUID();
      const [first, replay] = await Promise.all([
        service.restore(fixture.userId, fixture.rootId, fixture.currentId, requestId),
        service.restore(fixture.userId, fixture.rootId, fixture.currentId, requestId),
      ]);
      expect(replay.id).toBe(first.id);
      await expect(service.restore(fixture.userId, fixture.middleId, fixture.currentId, requestId)).rejects.toMatchObject({ status: 409 });
      expect(await prisma.designAsset.count({ where: { id: first.id } })).toBe(1);
    } finally {
      await prisma.user.delete({ where: { id: fixture.userId } });
    }
  });

  it("用户不能读取其他用户的资产时间线", async () => {
    const fixture = await createFixture();
    const outsider = await prisma.user.create({
      data: { email: `lineage-outsider-${crypto.randomUUID()}@example.com` },
    });
    try {
      await expect(
        service.versions(outsider.id, fixture.currentId, undefined, 10),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    } finally {
      await prisma.user.delete({ where: { id: outsider.id } });
      await prisma.user.delete({ where: { id: fixture.userId } });
    }
  });

  it("将已就绪的上传文件幂等导入为系列可用的根资产", async () => {
    const fixture = await createImportFixture();
    try {
      const first = await service.importFile(
        fixture.userId,
        fixture.projectId,
        fixture.fileId,
      );
      const second = await service.importFile(
        fixture.userId,
        fixture.projectId,
        fixture.fileId,
      );

      expect(second.id).toBe(first.id);
      expect(first).toMatchObject({
        height: 1536,
        operation: "imported",
        parentAssetId: null,
        projectId: fixture.projectId,
        thumbnailUrl: `/api/design-assets/${first.id}/thumbnail`,
        url: `/api/design-assets/${first.id}/content`,
        width: 1024,
      });
      await expect(
        prisma.designAsset.findUniqueOrThrow({ where: { id: first.id } }),
      ).resolves.toMatchObject({
        rootAssetId: first.id,
        sourceFileId: fixture.fileId,
      });
      await expect(
        prisma.designAsset.count({
          where: {
            projectId: fixture.projectId,
            sourceFileId: fixture.fileId,
          },
        }),
      ).resolves.toBe(1);
      const path = await service.path(fixture.userId, first.id);
      expect(path.steps[0]).toMatchObject({
        tool: "imported",
        snapshotAvailable: true,
        sources: [
          expect.objectContaining({
            fileAssetId: fixture.fileId,
            title: "系列核心.png",
          }),
        ],
      });
      await expect(
        prisma.designStep.count({ where: { outputAssetId: first.id } }),
      ).resolves.toBe(1);
    } finally {
      await prisma.user.delete({ where: { id: fixture.userId } });
    }
  });

  it("旧资产作为新图候选引用后仍能读取原始导入路径", async () => {
    const fixture = await createImportFixture();
    try {
      const imported = await service.importFile(fixture.userId, fixture.projectId, fixture.fileId);
      const workflows = new WorkflowsService(prisma);
      await workflows.patch(fixture.userId, fixture.projectId, {
        mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: 0,
        operations: [{ type: "add_node", node: {
          id: crypto.randomUUID(), kind: "asset", type: "candidate", title: "旧候选引用",
          payload: { assetId: imported.id }, x: 100, y: 100,
        } }],
      });
      const path = await service.path(fixture.userId, imported.id);
      expect(path.steps.some((step) => step.tool === "imported")).toBe(true);
    } finally {
      await prisma.user.delete({ where: { id: fixture.userId } });
    }
  });

  it("从旧资产继续设计时不会把缺失的根路径标成完整", async () => {
    const fixture = await createImportFixture();
    try {
      const imported = await service.importFile(fixture.userId, fixture.projectId, fixture.fileId);
      const restored = await service.restore(fixture.userId, imported.id, imported.id);
      const workflows = new WorkflowsService(prisma);
      const sourceNodeId = crypto.randomUUID();
      const toolNodeId = crypto.randomUUID();
      const outputNodeId = crypto.randomUUID();
      await workflows.applySystemMutation(fixture.projectId, {
        mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: 0,
        operations: [
          { type: "add_node", node: { id: sourceNodeId, kind: "asset", type: "candidate", title: "历史导入资产", payload: { assetId: imported.id }, x: 100, y: 100 } },
          { type: "add_node", node: { id: toolNodeId, kind: "tool", type: "restore_version", title: "从旧资产继续", payload: { toolKey: "restore_version", toolVersion: "1", params: {} }, x: 440, y: 100, status: "completed" } },
          { type: "add_node", node: { id: outputNodeId, kind: "asset", type: "candidate", title: "恢复结果", payload: { assetId: restored.id }, x: 780, y: 100, status: "completed" } },
          { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId, targetNodeId: toolNodeId, sourcePort: "out", targetPort: "source" } },
          { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: toolNodeId, targetNodeId: outputNodeId, sourcePort: "out", targetPort: "source" } },
        ],
      });
      const path = await service.path(fixture.userId, restored.id);
      expect(path.steps.some((step) => step.tool === "imported") || path.incomplete).toBe(true);
    } finally {
      await prisma.user.delete({ where: { id: fixture.userId } });
    }
  });

  it("明确选择幂等追加，刷新路径可读到选择历史", async () => {
    const fixture = await createFixture();
    try {
      const input = {
        kind: "selected" as const,
        reason: "面料更合适",
        clientRequestId: crypto.randomUUID(),
      };
      const [first, replay] = await Promise.all([
        service.decide(fixture.userId, fixture.currentId, input),
        service.decide(fixture.userId, fixture.currentId, input),
      ]);
      expect(replay.id).toBe(first.id);
      await service.decide(fixture.userId, fixture.currentId, {
        kind: "compare",
        reason: "继续比较袖型",
        clientRequestId: crypto.randomUUID(),
      });
      const path = await service.path(fixture.userId, fixture.currentId);
      expect(path.decisions).toHaveLength(2);
      expect(path.decisions[0]).toMatchObject({
        kind: "compare",
        reason: "继续比较袖型",
      });
      await expect(
        prisma.designAsset.findUniqueOrThrow({
          where: { id: fixture.currentId },
        }),
      ).resolves.toMatchObject({ operation: DesignAssetOperation.INPAINT });
    } finally {
      await prisma.user.delete({ where: { id: fixture.userId } });
    }
  });
});

async function createImportFixture(): Promise<{
  readonly fileId: string;
  readonly projectId: string;
  readonly userId: string;
}> {
  const user = await prisma.user.create({
    data: {
      email: `asset-import-${crypto.randomUUID()}@example.com`,
      ownedWorkspaces: {
        create: {
          name: "Asset import workspace",
          projects: { create: { name: "Asset import project" } },
        },
      },
    },
    include: {
      ownedWorkspaces: { include: { projects: true } },
    },
  });
  const projectId = user.ownedWorkspaces[0]?.projects[0]?.id;
  if (!projectId) throw new Error("测试项目创建失败");
  const file = await prisma.fileAsset.create({
    data: {
      height: 1536,
      mimeType: "image/png",
      objectKey: `originals/${user.id}/${crypto.randomUUID()}/source`,
      originalName: "系列核心.png",
      ownerId: user.id,
      sha256: crypto.randomUUID().replaceAll("-", "").padEnd(64, "0"),
      sizeBytes: 1024,
      status: FileStatus.READY,
      thumbnail1024Key: `thumbnails/${user.id}/hero-1024.webp`,
      thumbnail256Key: `thumbnails/${user.id}/hero-256.webp`,
      width: 1024,
    },
  });
  return { fileId: file.id, projectId, userId: user.id };
}

async function createFixture(): Promise<{
  readonly currentId: string;
  readonly middleId: string;
  readonly rootId: string;
  readonly userId: string;
}> {
  const user = await prisma.user.create({
    data: {
      email: `lineage-${crypto.randomUUID()}@example.com`,
      ownedWorkspaces: {
        create: {
          name: "Lineage workspace",
          projects: { create: { name: "Lineage project" } },
        },
      },
    },
    include: {
      ownedWorkspaces: { include: { projects: true } },
    },
  });
  const projectId = user.ownedWorkspaces[0]?.projects[0]?.id;
  if (!projectId) throw new Error("测试项目创建失败");
  const rootId = crypto.randomUUID();
  const middleId = crypto.randomUUID();
  const currentId = crypto.randomUUID();
  await prisma.designAsset.createMany({
    data: [
      {
        createdAt: new Date("2026-07-27T01:00:00.000Z"),
        id: rootId,
        operation: DesignAssetOperation.GENERATED,
        projectId,
        rootAssetId: rootId,
        url: "https://cdn.test/root.png",
      },
      {
        createdAt: new Date("2026-07-27T02:00:00.000Z"),
        id: middleId,
        operation: DesignAssetOperation.VARIATION,
        parentAssetId: rootId,
        projectId,
        rootAssetId: rootId,
        url: "https://cdn.test/middle.png",
      },
      {
        createdAt: new Date("2026-07-27T03:00:00.000Z"),
        id: currentId,
        operation: DesignAssetOperation.INPAINT,
        parentAssetId: middleId,
        projectId,
        rootAssetId: rootId,
        url: "https://cdn.test/current.png",
      },
    ],
  });
  return { currentId, middleId, rootId, userId: user.id };
}
