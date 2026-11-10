import {
  AiRuntimeService,
  AmuxAdapter,
  AmuxHttpError,
  createReferenceImageLoader,
  type AiGenerationRequest,
} from "@fashion/ai";
import { BillingService } from "@fashion/billing";
import { prisma } from "@fashion/db";
import type { GenerationJobData } from "@fashion/shared";
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
import type { WorkflowSemanticPatchInput } from "../workflows/workflows.schemas";
import { GenerationService } from "./generation.service";
import { captureGenerationImageSources } from "./generation-image-sources";
import { ProjectAccessPolicy } from "../studio/project-access.policy";

afterAll(async () => prisma.$disconnect());

it("真实文件权限只冻结本人、当前项目共享或公开素材，不接受他人的私有地址", async () => {
  const id = crypto.randomUUID();
  const owner = await prisma.user.create({
    data: {
      email: `reference-owner-${id}@example.com`,
      ownedWorkspaces: {
        create: {
          name: "图片权限",
          projects: { create: { name: "引用范围" } },
        },
      },
    },
    include: { ownedWorkspaces: { include: { projects: true } } },
  });
  const outsider = await prisma.user.create({
    data: { email: `reference-other-${id}@example.com` },
  });
  const project = owner.ownedWorkspaces[0]?.projects[0];
  if (!project) throw new Error("权限项目缺失");
  const access = new ProjectAccessPolicy(prisma);
  const key = `integration/reference-access/${id}/original.png`;
  const thumbnail = `integration/reference-access/${id}/thumbnail.png`;
  const file = await prisma.fileAsset.create({
    data: {
      ownerId: outsider.id,
      originalName: "参考图片",
      mimeType: "image/png",
      sizeBytes: 1,
      sha256: id,
      objectKey: key,
      thumbnail1024Key: thumbnail,
      status: "READY",
    },
  });
  const request: AiGenerationRequest = {
    taskType: "t2i",
    prompt: "仅检查输入权限",
    width: 1024,
    height: 1024,
    referenceImageUrl: `s3://${thumbnail}`,
  };
  const capture = () =>
    captureGenerationImageSources(
      prisma,
      access,
      owner.id,
      project.id,
      request,
    );
  try {
    await expect(capture()).rejects.toMatchObject({ status: 403 });
    const publicFabric = await prisma.fabric.create({
      data: { scope: "PRESET", mainFileId: file.id, tags: ["woven"] },
    });
    expect(await capture()).toEqual({
      version: 1,
      entries: [{ url: request.referenceImageUrl, objectKey: thumbnail }],
    });
    await prisma.fabric.delete({ where: { id: publicFabric.id } });
    await expect(capture()).rejects.toMatchObject({ status: 403 });
    const sharedAssetId = crypto.randomUUID();
    await prisma.designAsset.create({
      data: {
        id: sharedAssetId,
        projectId: project.id,
        sourceFileId: file.id,
        rootAssetId: sharedAssetId,
        operation: "IMPORTED",
        url: `s3://${key}`,
      },
    });
    expect(await capture()).toMatchObject({
      entries: [{ objectKey: thumbnail }],
    });
    await prisma.designAsset.update({
      where: { id: sharedAssetId },
      data: { archivedAt: new Date() },
    });
    await expect(capture()).rejects.toMatchObject({ status: 403 });
    await prisma.fileAsset.update({
      where: { id: file.id },
      data: { ownerId: owner.id },
    });
    expect(await capture()).toMatchObject({
      entries: [{ objectKey: thumbnail }],
    });
  } finally {
    await prisma.fabric.deleteMany({ where: { mainFileId: file.id } });
    await prisma.workspace.deleteMany({ where: { ownerId: owner.id } });
    await prisma.fileAsset.delete({ where: { id: file.id } });
    await prisma.user.deleteMany({
      where: { id: { in: [owner.id, outsider.id] } },
    });
  }
});

it.each([
  "create",
  "edit",
  "feedback",
  "missing-reference",
  "expired-create",
  "expired-edit",
  "expired-feedback",
  "retry-feedback",
  "outpaint",
  "expired-outpaint",
  "retry-outpaint",
] as const)(
  "%s：真实工作流、队列、私有文件和Amux组装保持完整图片与产物关联",
  async (mode) => {
    const id = crypto.randomUUID();
    const user = await prisma.user.create({
      data: {
        email: `generation-references-${id}@example.com`,
        generationLimit: 100,
        ownedWorkspaces: {
          create: {
            name: "参考链路验证",
            projects: { create: { name: "多图服装设计" } },
          },
        },
      },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });
    const project = user.ownedWorkspaces[0]?.projects[0];
    if (!project) throw new Error("验证项目缺失");
    const store = new S3ThumbnailStorage();
    const keys = new Set<string>();
    const written = new Map<string, Buffer>();
    const storage: ThumbnailStorage = {
      get: (key) => store.get(key),
      delete: (key) => store.delete(key),
      downloadUrl: (key) => store.downloadUrl(key),
      put: async (key, bytes, mime) => {
        keys.add(key);
        written.set(key, bytes);
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
    const queueName = `generation-references-${id}`;
    const queue = new Queue<GenerationJobData>(queueName, { connection });
    const events = new QueueEvents(queueName, { connection });
    let worker: Worker<GenerationJobData> | undefined;
    const submitted: string[] = [];
    const files = new S3FileStorage();
    const expired = mode.startsWith("expired-");
    const feedback = mode.endsWith("feedback");
    const outpaint = mode.endsWith("outpaint");
    const frame = { width: 1024, height: 1024, left: 128, top: 256 };
    const retrying = mode.startsWith("retry-");
    if (expired) {
      const sign = files.createDownloadUrl.bind(files);
      vi.spyOn(files, "createDownloadUrl").mockImplementation(
        async (...args) => {
          const url = new URL(await sign(...args));
          url.searchParams.set("X-Amz-Date", "20200101T000000Z");
          return url.href;
        },
      );
    }
    const generation = new GenerationService(
      prisma,
      {
        enqueue: async (taskId, userId) => {
          submitted.push(taskId);
          await queue.add(
            "generation",
            { taskId, userId },
            { jobId: taskId, attempts: retrying ? 2 : 1 },
          );
        },
        cancel: async () => {},
      },
      new BillingService(prisma),
      {
        compile: async (
          _userId: string,
          _projectId: string,
          prompt: string,
        ) => ({
          version: 1,
          mode: "text_only",
          positivePrompt: prompt,
          negativePrompt: "",
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
    const sourceId = crypto.randomUUID();
    const fabricId = crypto.randomUUID();
    const detailId = crypto.randomUUID();
    const toolId = crypto.randomUUID();
    const constraintId = crypto.randomUUID();
    const withSource = mode.endsWith("edit") || feedback || outpaint;
    const sourceKey = `integration/generation-references/${id}/source.png`;
    const fabricKey = `integration/generation-references/${id}/fabric.png`;
    const detailKey = `integration/generation-references/${id}/detail.png`;
    const makeImage = (background: string) =>
      sharp({ create: { width: 256, height: 256, channels: 4, background } })
        .png()
        .toBuffer();
    const [source, fabric, detail, output] = await Promise.all([
      makeImage(outpaint ? "rgba(210, 201, 181, 0.5)" : "#d2c9b5"),
      makeImage("#297746"),
      makeImage("#315b98"),
      makeImage("#db9464"),
    ]);
    const edit = vi
      .fn<(form: FormData) => Promise<unknown>>()
      .mockResolvedValue({ data: [{ b64_json: output.toString("base64") }] });
    const generate = vi.fn(async () => {
      throw new Error("有参考时不能走纯文字生成");
    });
    if (retrying)
      edit.mockImplementationOnce(async () => {
        await prisma.designAsset.update({
          where: { id: sourceId },
          data: { url: "https://replaced.invalid/other-image.png" },
        });
        throw new AmuxHttpError(503, {
          error: "controlled first-attempt interruption",
        });
      });
    try {
      await events.waitUntilReady();
      for (const [assetId, key, bytes] of [
        [sourceId, sourceKey, source],
        [fabricId, fabricKey, fabric],
        [detailId, detailKey, detail],
      ] as const) {
        await storage.put(key, bytes, "image/png");
        await prisma.designAsset.create({
          data: {
            id: assetId,
            projectId: project.id,
            rootAssetId: assetId,
            operation: "IMPORTED",
            url: `s3://${key}`,
            width: 256,
            height: 256,
          },
        });
      }
      if (feedback)
        await prisma.imageAssetFeedback.create({
          data: {
            assetId: sourceId,
            revision: 1,
            data: {
              annotations: [],
              comments: [
                {
                  id: "collar",
                  text: "缩小这里的领口",
                  point: { x: 0.5, y: 0.25 },
                  annotationIds: [],
                },
              ],
            },
          },
        });
      const operations: WorkflowSemanticPatchInput["operations"] = [
        {
          type: "add_node",
          node: {
            id: constraintId,
            kind: "asset",
            type: "constraint",
            title: "设计要求",
            payload: { text: "自然的服装设计" },
            x: 0,
            y: 0,
            status: "completed",
          },
        },
        // Deliberately put references before the source in graph order.
        {
          type: "add_node",
          node: {
            id: fabricId,
            kind: "asset",
            type: "candidate",
            title: "面料参考",
            payload: { assetId: fabricId },
            x: 0,
            y: 200,
            status: "completed",
          },
        },
        {
          type: "add_node",
          node: {
            id: detailId,
            kind: "asset",
            type: "candidate",
            title: "领口参考",
            payload: { assetId: detailId },
            x: 0,
            y: 400,
            status: "completed",
          },
        },
        ...(withSource
          ? [
              {
                type: "add_node" as const,
                node: {
                  id: sourceId,
                  kind: "asset" as const,
                  type: "candidate" as const,
                  title: "编辑原图",
                  payload: { assetId: sourceId },
                  x: 0,
                  y: 600,
                  status: "completed" as const,
                },
              },
            ]
          : []),
        {
          type: "add_node",
          node: {
            id: toolId,
            kind: "tool",
            type: withSource ? "edit_design" : "generate_design",
            title: "参考生成",
            x: 400,
            y: 200,
            payload: {
              toolKey: withSource ? "edit_design" : "generate_design",
              toolVersion: "1",
              params: {
                prompt: withSource
                  ? "保持原图版型，只调整面料和领口"
                  : "结合参考设计一件新的外套",
                width: 1024,
                height: 1024,
                count: 1,
                referenceInputs: [
                  { nodeId: detailId, role: "detail_ref", weight: 0.5 },
                  { nodeId: fabricId, role: "fabric_texture", weight: 0.7 },
                ],
                ...(feedback
                  ? {
                      intent: "feedback",
                      feedbackRevision: 1,
                      commentIds: ["collar"],
                    }
                  : {}),
                ...(outpaint ? { intent: "outpaint", outpaint: frame } : {}),
              },
            },
          },
        },
        {
          type: "add_edge",
          edge: {
            id: crypto.randomUUID(),
            sourceNodeId: constraintId,
            targetNodeId: toolId,
            sourcePort: "out",
            targetPort: "constraint",
          },
        },
        {
          type: "add_edge",
          edge: {
            id: crypto.randomUUID(),
            sourceNodeId: detailId,
            targetNodeId: toolId,
            sourcePort: "out",
            targetPort: "reference",
          },
        },
        {
          type: "add_edge",
          edge: {
            id: crypto.randomUUID(),
            sourceNodeId: fabricId,
            targetNodeId: toolId,
            sourcePort: "out",
            targetPort: "reference",
          },
        },
        ...(withSource
          ? [
              {
                type: "add_edge" as const,
                edge: {
                  id: crypto.randomUUID(),
                  sourceNodeId: sourceId,
                  targetNodeId: toolId,
                  sourcePort: "out" as const,
                  targetPort: "source" as const,
                },
              },
            ]
          : []),
      ];
      await workflows.applySystemMutation(project.id, {
        mode: "semantic",
        baseRevision: 0,
        mutationId: crypto.randomUUID(),
        operations,
      });
      const mutationId = crypto.randomUUID();
      await runtime.execute(user.id, project.id, toolId, { mutationId });
      const taskId = submitted[0];
      if (!taskId) throw new Error("任务未入队");
      expect(submitted).toHaveLength(1);
      const task = await prisma.generationTask.findUniqueOrThrow({
        where: { id: taskId },
      });
      const request = task.input as unknown as AiGenerationRequest;
      if (expired && "referenceImages" in request) {
        const url = request.referenceImages?.[0]?.url;
        if (!url) throw new Error("过期参考缺失");
        const response = await fetch(url);
        await response.body?.cancel();
        expect(response.status).toBe(403);
        vi.mocked(files.createDownloadUrl).mockRestore();
      }
      expect(request.taskType).toBe(withSource ? "i2i" : "t2i");
      expect(request).toMatchObject({
        referenceImages: [
          { order: 0, role: "fabric_texture", weight: 0.7 },
          { order: 1, role: "detail_ref", weight: 0.5 },
        ],
      });
      const attempt = await prisma.workflowAttempt.findFirstOrThrow({
        where: { generationTaskId: taskId },
      });
      expect(attempt.requestSnapshot).toMatchObject({
        inputNodeIds: expect.arrayContaining([
          constraintId,
          fabricId,
          detailId,
        ]),
        inputSnapshot: expect.arrayContaining([
          {
            id: fabricId,
            nodeVersionId: expect.any(String),
            type: "candidate",
            title: "面料参考",
            payload: { assetId: fabricId },
          },
        ]),
        request: {
          referenceImages: [
            { role: "fabric_texture", weight: 0.7 },
            { role: "detail_ref", weight: 0.5 },
          ],
        },
      });
      const signed = await files.createDownloadUrl(fabricKey, 3600);
      const adapter = new AmuxAdapter(
        {
          apiKey: () => "local-controlled-transport",
          baseUrl: "https://unused.invalid",
          imageModel: "controlled-reference-test",
          quality: "high",
          imageCostUsd: 0,
          editCostUsd: 0,
          creditsPerUsd: 100,
        },
        { edit, generate },
        createReferenceImageLoader({
          allowedOrigins: [new URL(signed).origin],
        }),
      );
      const ai = new AiRuntimeService([adapter], {
        primaryProvider: "amux",
        timeoutMs: 10_000,
        retryBaseMs: 1,
        maxRetries: 0,
      });
      if (mode === "missing-reference") await store.delete(fabricKey);
      const process = createGenerationProcessor({
        database: prisma,
        billing: new BillingService(prisma),
        storage,
        ai,
        moderator: {
          moderate: async () => ({ status: "approved", categories: [] }),
        },
        pollIntervalMs: 1,
      });
      worker = new Worker(queueName, (job) => process(job), {
        connection,
        concurrency: 1,
      });
      const job = await queue.getJob(taskId);
      if (!job) throw new Error("队列任务缺失");
      if (mode === "missing-reference")
        await job.waitUntilFinished(events, 15_000).catch(() => undefined);
      else await job.waitUntilFinished(events, 15_000);
      const graph = await runtime.sync(user.id, project.id);
      expect(generate).not.toHaveBeenCalled();
      const finished = await prisma.generationTask.findUniqueOrThrow({
        where: { id: taskId },
      });
      const settled = await prisma.workflowAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      if (mode === "missing-reference") {
        expect(edit).not.toHaveBeenCalled();
        expect(finished).toMatchObject({
          status: "FAILED",
          errorCode: "INVALID_RESPONSE",
        });
        expect(settled.status).toBe("failed");
        expect(
          await prisma.designAsset.count({
            where: { generationTaskId: taskId },
          }),
        ).toBe(0);
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
            .generationCount,
        ).toBe(0);
        return;
      }
      expect(edit).toHaveBeenCalledTimes(retrying ? 2 : 1);
      const form = edit.mock.calls[0]?.[0];
      if (!form) throw new Error("未提交图片请求");
      const images = form.getAll("image") as File[];
      const annotation = written.get(`image-edit/${taskId}/annotations.png`);
      if (feedback && !annotation) throw new Error("未生成编号图");
      const expanded = written.get(`image-edit/${taskId}/input.png`);
      if (outpaint && !expanded) throw new Error("未生成扩展画面");
      const expectedBytes = [
        ...(withSource ? [outpaint ? expanded : source] : []),
        ...(annotation ? [annotation] : []),
        fabric,
        detail,
      ];
      expect(
        await Promise.all(
          images.map(async (image) => Buffer.from(await image.arrayBuffer())),
        ),
      ).toEqual(expectedBytes);
      if (retrying) {
        const retryForm = edit.mock.calls[1]?.[0];
        expect(
          await Promise.all(
            (retryForm?.getAll("image") as File[]).map(async (image) =>
              Buffer.from(await image.arrayBuffer()),
            ),
          ),
        ).toEqual(expectedBytes);
        expect(finished.attemptCount).toBe(2);
      }
      const offset = feedback ? 2 : withSource ? 1 : 0;
      expect(form.get("prompt")).toContain(
        `fabric texture and material behavior; influence 70%; image ${offset + 1}`,
      );
      expect(form.get("prompt")).toContain(
        `garment construction detail only; influence 50%; image ${offset + 2}`,
      );
      if (outpaint) {
        expect(form.get("prompt")).toContain("Edit only the masked area");
        const mask = form.get("mask") as File;
        expect(Buffer.from(await mask.arrayBuffer())).toEqual(written.get(`image-edit/${taskId}/mask.png`));
        expect(await sharp(Buffer.from(await mask.arrayBuffer())).metadata()).toMatchObject({ width: frame.width, height: frame.height });
        const alpha = await sharp(Buffer.from(await mask.arrayBuffer())).extractChannel("alpha").raw().toBuffer();
        expect(alpha[0]).toBe(0);
        expect(alpha[frame.top * frame.width + frame.left]).toBe(255);
        await expect(store.get(`image-edit/${taskId}/mask.png`)).rejects.toMatchObject({ name: "NoSuchKey" });
        await expect(store.get(`image-edit/${taskId}/input.png`)).rejects.toMatchObject({ name: "NoSuchKey" });
      } else if (withSource)
        expect(form.get("prompt")).toContain("Image 1 is the source to edit");
      else expect(form.get("prompt")).not.toContain("Preserve its identity");
      if (feedback) {
        expect(expectedBytes[1]).not.toEqual(source);
        expect(form.get("prompt")).toContain("意见 1，标记 1");
        await expect(
          store.get(`image-edit/${taskId}/annotations.png`),
        ).rejects.toMatchObject({ name: "NoSuchKey" });
      }
      expect(finished.status).toBe("SUCCEEDED");
      expect(settled.status).toBe("completed");
      const asset = await prisma.designAsset.findFirstOrThrow({
        where: { generationTaskId: taskId },
      });
      expect(asset).toMatchObject({
        parentAssetId: withSource ? sourceId : null,
        rootAssetId: withSource ? sourceId : asset.id,
      });
      const saved = await store.get(asset.url.slice(5));
      if (outpaint) {
        expect(asset).toMatchObject({ width: frame.width, height: frame.height });
        expect(await sharp(saved).extract({ left: frame.left, top: frame.top, width: 256, height: 256 }).ensureAlpha().raw().toBuffer()).toEqual(await sharp(source).ensureAlpha().raw().toBuffer());
        expect(await sharp(saved).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer()).toEqual(await sharp(output).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer());
      } else expect(saved).toEqual(output);
      expect(graph.nodes).toContainEqual(
        expect.objectContaining({
          type: "candidate",
          payload: expect.objectContaining({ assetId: asset.id }),
        }),
      );
      if (!attempt.executionId) throw new Error("执行记录缺失");
      expect(
        await prisma.workflowExecution.findUniqueOrThrow({
          where: { id: attempt.executionId },
        }),
      ).toMatchObject({ status: "completed" });
      await runtime.execute(user.id, project.id, toolId, { mutationId });
      await runtime.sync(user.id, project.id);
      expect(edit).toHaveBeenCalledTimes(retrying ? 2 : 1);
      expect(
        await prisma.designAsset.count({ where: { generationTaskId: taskId } }),
      ).toBe(1);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
          .generationCount,
      ).toBe(1);
      expect(await store.get(sourceKey)).toEqual(source);
      expect(await store.get(fabricKey)).toEqual(fabric);
      expect(await store.get(detailKey)).toEqual(detail);
    } finally {
      await worker?.close();
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
      await Promise.all([...keys].map((key) => store.delete(key)));
      await prisma.workspace.deleteMany({ where: { ownerId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  },
  30_000,
);
