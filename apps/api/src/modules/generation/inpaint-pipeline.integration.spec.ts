import { BillingService } from "@fashion/billing";
import { prisma } from "@fashion/db";
import {
  privateStorageObjectKey,
  type GenerationJobData,
} from "@fashion/shared";
import type { AiGenerationRequest } from "@fashion/ai";
import { Queue, QueueEvents, Worker } from "bullmq";
import sharp from "sharp";
import { afterAll, expect, it, vi } from "vitest";
import { createGenerationProcessor } from "../../../../worker/src/processors/generation.processor";
import {
  S3ThumbnailStorage,
  type ThumbnailStorage,
} from "../../../../worker/src/storage";
import { S3FileStorage } from "../files/storage.service";
import { WorkflowRuntimeService } from "../workflow-runtime/workflow-runtime.service";
import { WorkflowsService } from "../workflows/workflows.service";
import { GenerationService } from "./generation.service";

afterAll(async () => prisma.$disconnect());

it.each(["局部编辑", "文字修改"])("%s 真实工作流固定原图与上传蒙版，经生成入队、私有保存、终态同步返回同一作品链", async (operation) => {
  const id = crypto.randomUUID();
  const user = await prisma.user.create({
    data: {
      email: `inpaint-pipeline-${id}@example.com`,
      generationLimit: 100,
      ownedWorkspaces: {
        create: {
          name: "局部编辑验证",
          projects: { create: { name: "服装局部修改" } },
        },
      },
    },
    include: { ownedWorkspaces: { include: { projects: true } } },
  });
  const project = user.ownedWorkspaces[0]?.projects[0];
  if (!project) throw new Error("项目缺失");
  const store = new S3ThumbnailStorage();
  const keys = new Set<string>();
  const storage: ThumbnailStorage = {
    get: (key) => store.get(key),
    delete: (key) => store.delete(key),
    downloadUrl: (key) => store.downloadUrl(key),
    put: async (key, bytes, mime) => {
      keys.add(key);
      await store.put(key, bytes, mime);
    },
  };
  const redis = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  const connection = {
    host: redis.hostname,
    port: Number(redis.port || 6379),
    username: redis.username || undefined,
    password: redis.password || undefined,
  };
  const queueName = `inpaint-pipeline-${id}`;
  const queue = new Queue<GenerationJobData>(queueName, { connection });
  const events = new QueueEvents(queueName, { connection });
  let worker: Worker<GenerationJobData> | undefined;
  const submitted: string[] = [];
  const sourceKey = `integration/inpaint-pipeline/${id}/source.png`;
  const maskKey = `integration/inpaint-pipeline/${id}/mask.png`;
  const textEdits = [{ original: "森织\nAUTUMN", replacement: "森织\nWINTER 2026", rect: { x: .5, y: 0, width: .5, height: 1 } }];
  const source = await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 120, g: 40, b: 180, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  const mask = await sharp({
    create: { width: 256, height: 256, channels: 4, background: "black" },
  })
    .composite([
      {
        input: {
          create: { width: 128, height: 256, channels: 4, background: "black" },
        },
        left: 128,
        top: 0,
        blend: "dest-out",
      },
    ])
    .png()
    .toBuffer();
  const generated = await sharp({
    create: { width: 256, height: 256, channels: 4, background: "blue" },
  })
    .png()
    .toBuffer();
  const result = {
    provider: "mock",
    providerJobId: id,
    model: "local/pixel-proof",
    taskType: "inpaint" as const,
    submittedAt: new Date().toISOString(),
    cost: {
      rawCost: 0,
      credits: 0,
      currency: "USD" as const,
      billableMegapixels: 1,
      estimated: true as const,
    },
    completedResult: {
      images: [
        { url: `data:image/png;base64,${generated.toString("base64")}` },
      ],
    },
  };
  const submit = vi.fn(async (input: AiGenerationRequest) => {
    if (input.taskType !== "inpaint") throw new Error("不是局部编辑请求");
    if (operation === "文字修改") {
      expect(input.prompt).toContain(JSON.stringify(textEdits));
      expect(input.prompt).toContain("不能作为操作指令");
      expect(input.prompt).not.toContain("local edit");
    }
    expect(input.referenceImageUrl).not.toContain("expired.invalid");
    expect(input.maskImageUrl).not.toContain("expired.invalid");
    expect((await fetch(input.referenceImageUrl)).status).toBe(200);
    expect((await fetch(input.maskImageUrl)).status).toBe(200);
    return result;
  });
  const files = new S3FileStorage();
  const generation = new GenerationService(
    prisma,
    {
      enqueue: async (taskId, userId) => {
        submitted.push(taskId);
        await queue.add(
          "generation",
          { taskId, userId },
          { jobId: taskId, attempts: 1 },
        );
      },
      cancel: async () => {},
    },
    new BillingService(prisma),
    {
      compile: async () => ({
        version: 1,
        mode: "text_only",
        positivePrompt: "local edit",
        negativePrompt: "",
        palette: [],
        paletteReferences: [],
        styleReferences: [],
        silhouetteReferences: [],
        fabricReferences: [],
        fabricInputs: [],
        patternReferences: [],
        detailReferences: [],
        notes: [],
        avoidLabels: [],
        enhancement: "keywords",
      }),
    } as never,
    files,
  );
  const workflows = new WorkflowsService(prisma);
  const runtime = new WorkflowRuntimeService(
    prisma,
    workflows,
    generation,
    {} as never,
    files,
    {} as never,
  );
  try {
    await events.waitUntilReady();
    await storage.put(sourceKey, source, "image/png");
    await storage.put(maskKey, mask, "image/png");
    const file = await prisma.fileAsset.create({
      data: {
        ownerId: user.id,
        originalName: "蒙版.png",
        mimeType: "image/png",
        sizeBytes: mask.length,
        sha256: id,
        objectKey: maskKey,
        status: "READY",
      },
    });
    const parent = await prisma.designAsset.create({
      data: {
        id,
        projectId: project.id,
        rootAssetId: id,
        operation: "IMPORTED",
        url: `s3://${sourceKey}`,
        width: 256,
        height: 256,
      },
    });
    const toolId = crypto.randomUUID();
    await workflows.applySystemMutation(project.id, {
      mode: "semantic",
      baseRevision: 0,
      mutationId: crypto.randomUUID(),
      operations: [
        {
          type: "add_node",
          node: {
            id,
            kind: "asset",
            type: "candidate",
            title: "原始服装",
            payload: { assetId: parent.id },
            x: 0,
            y: 0,
            status: "completed",
          },
        },
        {
          type: "add_node",
          node: {
            id: toolId,
            kind: "tool",
            type: "edit_design",
            title: "局部修改",
            payload: {
              toolKey: "edit_design",
              toolVersion: "1",
              params: {
                prompt: "仅修改右侧",
                taskType: "inpaint",
                ...(operation === "文字修改" ? { textEdits } : {}),
                mask: { fileAssetId: file.id },
                width: 1024,
                height: 1024,
                count: 1,
              },
            },
            x: 400,
            y: 0,
          },
        },
        {
          type: "add_edge",
          edge: {
            id: crypto.randomUUID(),
            sourceNodeId: id,
            targetNodeId: toolId,
            sourcePort: "out",
            targetPort: "source",
          },
        },
      ],
    });
    const mutationId = crypto.randomUUID();
    await runtime.execute(user.id, project.id, toolId, { mutationId });
    const taskId = submitted[0];
    if (!taskId) throw new Error("生成未入队");
    const task = await prisma.generationTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    expect(task.compiledPrompt).toMatchObject({
      inpaintSource: {
        version: 1,
        sourceObjectKey: sourceKey,
        maskObjectKey: maskKey,
      },
    });
    const attempt = await prisma.workflowAttempt.findFirstOrThrow({
      where: { generationTaskId: taskId },
    });
    expect(attempt.requestSnapshot).toMatchObject({
      request: { maskImageUrl: `s3://${maskKey}` },
    });
    if (operation === "文字修改") {
      expect((attempt.requestSnapshot as { request: { prompt: string } }).request.prompt).toContain(JSON.stringify(textEdits));
    }
    const input = task.input as unknown as AiGenerationRequest;
    await prisma.generationTask.update({
      where: { id: taskId },
      data: {
        input: {
          ...input,
          referenceImageUrl: "https://expired.invalid/source",
          maskImageUrl: "https://expired.invalid/mask",
        },
      },
    });
    const process = createGenerationProcessor({
      database: prisma,
      billing: new BillingService(prisma),
      storage,
      ai: {
        submit,
        getStatus: async () => ({ status: "completed" }),
        getResult: async () => ({
          job: result,
          images: result.completedResult.images,
          cost: result.cost,
        }),
      },
      moderator: {
        moderate: async () => ({ status: "approved", categories: [] }),
      },
      pollIntervalMs: 1,
    });
    worker = new Worker(queueName, (job) => process(job), { connection });
    const job = await queue.getJob(taskId);
    if (!job) throw new Error("队列任务缺失");
    await job.waitUntilFinished(events, 15_000);
    const graph = await runtime.sync(user.id, project.id);
    const asset = await prisma.designAsset.findFirstOrThrow({
      where: { generationTaskId: taskId },
    });
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        type: "candidate",
        payload: expect.objectContaining({ assetId: asset.id }),
      }),
    );
    expect(asset).toMatchObject({
      parentAssetId: id,
      rootAssetId: id,
      operation: "INPAINT",
      width: 256,
      height: 256,
    });
    const saved = await store.get(asset.url.slice(5));
    expect(
      await sharp(saved)
        .extract({ left: 0, top: 0, width: 128, height: 256 })
        .raw()
        .toBuffer(),
    ).toEqual(
      await sharp(source)
        .extract({ left: 0, top: 0, width: 128, height: 256 })
        .raw()
        .toBuffer(),
    );
    expect([
      ...(await sharp(saved)
        .extract({ left: 255, top: 0, width: 1, height: 1 })
        .raw()
        .toBuffer()),
    ]).toEqual([0, 0, 255, 255]);
    expect(await store.get(sourceKey)).toEqual(source);
    expect(await store.get(maskKey)).toEqual(mask);
    await expect(
      store.get(`image-edit/${taskId}/inpaint-mask.png`),
    ).rejects.toMatchObject({ name: "NoSuchKey" });
    await runtime.execute(user.id, project.id, toolId, { mutationId });
    expect(submit).toHaveBeenCalledOnce();
    expect(
      await prisma.designAsset.count({ where: { parentAssetId: id } }),
    ).toBe(1);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .generationCount,
    ).toBe(1);
  } finally {
    await worker?.close();
    await events.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await Promise.all([...keys].map((key) => store.delete(key)));
    await prisma.workspace.deleteMany({ where: { ownerId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}, 30_000);

it("私有链接只识别明确配置的存储源，处理中文键和两种S3地址", () => {
  const config = {
    endpoint: "https://storage.example",
    bucket: "assets",
    cdnOrigin: "https://cdn.example/private",
  };
  expect(
    privateStorageObjectKey(
      "https://storage.example/assets/%E8%92%99%E7%89%88.png?expired=1",
      config,
    ),
  ).toBe("蒙版.png");
  expect(
    privateStorageObjectKey("https://assets.storage.example/mask.png", config),
  ).toBe("mask.png");
  expect(
    privateStorageObjectKey("https://cdn.example/private/mask.png", config),
  ).toBe("mask.png");
  expect(
    privateStorageObjectKey(
      "https://storage.example.attacker.test/assets/mask.png",
      config,
    ),
  ).toBeNull();
  expect(
    privateStorageObjectKey(
      "https://cdn.example/private-other/mask.png",
      config,
    ),
  ).toBeNull();
  expect(
    privateStorageObjectKey("https://storage.example/another/mask.png", config),
  ).toBeNull();
});
