import { describe, expect, it } from "vitest";
import { prisma } from "@fashion/db";
import { BillingService } from "@fashion/billing";
import {
  createAiRuntimeFromEnv,
  createAmuxClaudeClientFromEnv,
} from "@fashion/ai";
import { Queue, QueueEvents, Worker } from "bullmq";
import sharp from "sharp";
import { S3ThumbnailStorage } from "../storage";
import { AmuxClaudeContentModerationService } from "../content-moderation.service";
import { createGenerationProcessor } from "./generation.processor";
import type { GenerationJobData } from "@fashion/shared";
import { lookup } from "node:dns/promises";

describe.skipIf(process.env.IMAGE_WORKSPACE_LIVE !== "1")(
  "真实透明背景编辑",
  () => {
    it("真实模型经队列、审核、私有存储生成透明新版本，仅计费一次", async () => {
      const user = await prisma.user.create({
        data: {
          email: `image-live-${crypto.randomUUID()}@example.com`,
          generationLimit: 10,
          ownedWorkspaces: {
            create: {
              name: "图片链路验证",
              projects: { create: { name: "透明编辑验证" } },
            },
          },
        },
        include: { ownedWorkspaces: { include: { projects: true } } },
      });
      const project = user.ownedWorkspaces[0]?.projects[0];
      if (!project) throw new Error("项目缺失");
      const url = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
      const connection = {
        host: url.hostname,
        port: Number(url.port || 6379),
        password: url.password || undefined,
        username: url.username || undefined,
      };
      const name = `image-live-test-${crypto.randomUUID()}`;
      const queue = new Queue<GenerationJobData>(name, { connection });
      const events = new QueueEvents(name, { connection });
      const storage = new S3ThumbnailStorage();
      const processor = createGenerationProcessor({
        ai: createAiRuntimeFromEnv(),
        billing: new BillingService(prisma),
        database: prisma,
        storage,
        moderator: new AmuxClaudeContentModerationService(
          createAmuxClaudeClientFromEnv(),
        ),
        resolveHostname: async (hostname) => {
          const addresses = (
            await lookup(hostname, { all: true, verbatim: true })
          ).map((entry) => entry.address);
          console.info("生成结果 DNS（不含路径或令牌）", hostname, addresses);
          return addresses;
        },
      });
      const worker = new Worker<GenerationJobData>(
        name,
        (job, _token, signal) => processor(job, signal),
        { connection, lockDuration: 60000 },
      );
      const assetId = crypto.randomUUID();
      const sourceKey = `integration/${assetId}.png`;
      const keys = [sourceKey];
      try {
        await events.waitUntilReady();
        const source = await sharp(
          Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024"><rect width="768" height="1024" fill="#bcb5ab"/><path d="M270 180L384 120 498 180 610 390 500 440 495 850 273 850 268 440 158 390Z" fill="#193b59"/><path d="M340 145L384 300 428 145M384 300V850" stroke="#e3dfd4" stroke-width="8" fill="none"/></svg>',
          ),
        )
          .png()
          .toBuffer();
        await storage.put(sourceKey, source, "image/png");
        await prisma.designAsset.create({
          data: {
            id: assetId,
            projectId: project.id,
            rootAssetId: assetId,
            operation: "GENERATED",
            url: `s3://${sourceKey}`,
            width: 768,
            height: 1024,
          },
        });
        const task = await prisma.generationTask.create({
          data: {
            userId: user.id,
            projectId: project.id,
            parentAssetId: assetId,
            taskType: "i2i",
            input: {
              taskType: "i2i",
              prompt:
                "Remove the solid gray background completely. Keep the navy coat illustration unchanged. Output a transparent PNG with only the coat visible.",
              referenceImageUrl: await storage.downloadUrl(sourceKey),
              width: 768,
              height: 1024,
              quality: "low",
              outputFormat: "png",
              background: "transparent",
              imageEdit: { intent: "remove_background" },
            },
          },
        });
        const job = await queue.add(
          "generate",
          { taskId: task.id, userId: user.id },
          { jobId: task.id, attempts: 1 },
        );
        await job.waitUntilFinished(events, 240000);
        const finished = await prisma.generationTask.findUniqueOrThrow({
          where: { id: task.id },
        });
        expect(finished.status).toBe("SUCCEEDED");
        const asset = await prisma.designAsset.findFirstOrThrow({
          where: { generationTaskId: task.id },
        });
        keys.push(asset.url.slice(5), asset.thumbnailUrl?.slice(5) ?? "");
        expect(asset).toMatchObject({
          operation: "REMOVE_BACKGROUND",
          parentAssetId: assetId,
        });
        const metadata = await sharp(
          await storage.get(asset.url.slice(5)),
        ).metadata();
        expect(metadata.hasAlpha).toBe(true);
        await processor(job);
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
            .generationCount,
        ).toBe(1);
      } finally {
        await worker.close();
        await events.close();
        await queue.obliterate({ force: true });
        await queue.close();
        await Promise.all(
          keys.filter(Boolean).map((key) => storage.delete(key)),
        );
        await prisma.workspace.deleteMany({ where: { ownerId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    }, 300000);
  },
);
