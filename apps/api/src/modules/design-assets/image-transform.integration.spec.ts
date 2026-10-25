import { prisma } from "@fashion/db";
import { describe, expect, it } from "vitest";
import { Queue, QueueEvents, Worker } from "bullmq";
import sharp from "sharp";
import { S3ThumbnailStorage } from "../../../../worker/src/storage";
import { createImageTransformProcessor } from "../../../../worker/src/processors/image-transform.processor";
import { WorkflowRuntimeService } from "../workflow-runtime/workflow-runtime.service";
import type { ImageTransformQueue } from "../workflow-runtime/image-transform-queue.service";
import { WorkflowsService } from "../workflows/workflows.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import type { ImageTransformJob } from "@fashion/shared";

describe("图片尺寸变换真实队列", () => {
  it("经 Redis、Sharp、MinIO 保存新版本并保持幂等及免费", async () => {
    const user = await prisma.user.create({
      data: {
        email: `transform-${crypto.randomUUID()}@example.com`,
        ownedWorkspaces: {
          create: { name: "变换验证", projects: { create: { name: "变换" } } },
        },
      },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });
    const project = user.ownedWorkspaces[0]?.projects[0];
    if (!project) throw new Error("项目缺失");
    const redis = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:16379");
    const connection = {
      host: redis.hostname,
      port: Number(redis.port || 6379),
      password: redis.password || undefined,
      username: redis.username || undefined,
    };
    const queueName = `image-transform-test-${crypto.randomUUID()}`;
    const queue = new Queue<ImageTransformJob>(queueName, { connection });
    const events = new QueueEvents(queueName, { connection });
    const storage = new S3ThumbnailStorage();
    const worker = new Worker<ImageTransformJob>(
      queueName,
      createImageTransformProcessor(prisma, storage),
      { connection },
    );
    const workflows = new WorkflowsService(prisma);
    const jobs: string[] = [];
    const dispatch = {
      enqueue: async (attemptId: string) => {
        await queue.add(
          "transform",
          { attemptId },
          { jobId: attemptId, attempts: 1 },
        );
        jobs.push(attemptId);
      },
    } as ImageTransformQueue;
    const runtime = new WorkflowRuntimeService(
      prisma,
      workflows,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      new ProjectAccessPolicy(prisma),
      dispatch,
    );
    const id = crypto.randomUUID();
    const toolId = crypto.randomUUID();
    const sourceKey = `integration/${id}.png`;
    const keys = [sourceKey];
    try {
      await events.waitUntilReady();
      await storage.put(
        sourceKey,
        await sharp({
          create: { width: 100, height: 120, channels: 4, background: "red" },
        })
          .png()
          .toBuffer(),
        "image/png",
      );
      await prisma.designAsset.create({
        data: {
          id,
          projectId: project.id,
          rootAssetId: id,
          operation: "GENERATED",
          url: `s3://${sourceKey}`,
          width: 100,
          height: 120,
        },
      });
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
              title: "原图",
              payload: { assetId: id },
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
              type: "transform_image",
              title: "裁剪",
              payload: {
                toolKey: "transform_image",
                toolVersion: "1",
                params: {
                  width: 32,
                  height: 40,
                  crop: { left: 10, top: 20, width: 50, height: 60 },
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
      const attemptId = jobs[0];
      if (!attemptId) throw new Error("任务未入队");
      const job = await queue.getJob(attemptId);
      if (!job) throw new Error("队列任务缺失");
      await job.waitUntilFinished(events, 15000);
      const graph = await runtime.sync(user.id, project.id);
      const output = graph.nodes.find(
        (n) => (n.payload as { attemptId?: string }).attemptId === attemptId,
      );
      expect(output).toBeDefined();
      const asset = await prisma.designAsset.findUniqueOrThrow({
        where: { id: `transform-${attemptId}` },
      });
      keys.push(asset.url.slice(5), asset.thumbnailUrl?.slice(5) ?? "");
      expect(asset).toMatchObject({
        operation: "TRANSFORM",
        parentAssetId: id,
        width: 32,
        height: 40,
      });
      expect(
        await sharp(await storage.get(asset.url.slice(5))).metadata(),
      ).toMatchObject({ width: 32, height: 40 });
      await runtime.execute(user.id, project.id, toolId, { mutationId });
      expect(
        await prisma.designAsset.count({ where: { parentAssetId: id } }),
      ).toBe(1);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
          .generationCount,
      ).toBe(0);
      await prisma.imageTransformResult.deleteMany({ where: { attemptId } });
    } finally {
      await worker.close();
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
      await Promise.all(keys.filter(Boolean).map((key) => storage.delete(key)));
      await prisma.workspace.deleteMany({ where: { ownerId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }, 30000);
});
