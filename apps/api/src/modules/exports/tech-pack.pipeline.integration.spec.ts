import "reflect-metadata";
import {
  DesignAssetOperation,
  Prisma,
  prisma,
  type PrismaClient,
} from "@fashion/db";
import {
  studioPresentationSchema,
  studioStyleSchema,
  studioTechPackSchema,
  type ExportJobData,
} from "@fashion/shared";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { Queue, QueueEvents, Worker } from "bullmq";
import type { NextFunction, Response } from "express";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createExportProcessor } from "../../../../worker/src/processors/export.processor";
import { S3ThumbnailStorage } from "../../../../worker/src/storage";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { S3FileStorage } from "../files/storage.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { TaskDispatchService } from "../workflow-runtime/task-dispatch.service";
import { ExportsController } from "./exports.controller";
import { ExportsService } from "./exports.service";

// The fixture supplies identity only. HTTP authorization, persistence, outbox,
// BullMQ execution, PDF rendering, and private object storage are real.
describe("技术包与展示组真实导出链路", () => {
  const suffix = randomUUID();
  const ownerId = "delivery-owner-" + suffix;
  const viewerId = "delivery-viewer-" + suffix;
  const outsiderId = "delivery-outsider-" + suffix;
  const projectId = "delivery-project-" + suffix;
  const workspaceId = "delivery-workspace-" + suffix;
  const assetId = "delivery-asset-" + suffix;
  const styleRevisionId = "delivery-style-revision-" + suffix;
  const packId = "delivery-pack-" + suffix;
  const presentationId = "delivery-presentation-" + suffix;
  const sourceKey = "tests/studio-delivery/" + suffix + "/source.svg";
  const prefix = "studio-delivery-" + suffix;
  const queueName = "isolated-export";
  const objectKeys = new Set<string>();
  let application: INestApplication | undefined;
  let storage: S3ThumbnailStorage | undefined;
  let queue: Queue<ExportJobData> | undefined;
  let events: QueueEvents | undefined;
  let worker: Worker<ExportJobData> | undefined;
  let dispatcher: TaskDispatchService | undefined;

  beforeAll(async () => {
    storage = new S3ThumbnailStorage();
    await storage.put(
      sourceKey,
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#e0d8c5"/><path d="M200 120L260 90L340 90L400 120L490 280L420 330L385 265L400 690L200 690L215 265L180 330L110 280Z" fill="#b7a078"/></svg>',
      ),
      "image/svg+xml",
    );
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: "delivery-owner-" + suffix + "@example.com" },
        { id: viewerId, email: "delivery-viewer-" + suffix + "@example.com" },
        {
          id: outsiderId,
          email: "delivery-outsider-" + suffix + "@example.com",
        },
      ],
    });
    await prisma.workspace.create({
      data: {
        id: workspaceId,
        ownerId,
        name: "Isolated delivery pipeline",
        members: { create: { userId: viewerId, role: "VIEWER" } },
        projects: { create: { id: projectId, name: "Delivery pipeline" } },
      },
    });
    await prisma.designAsset.create({
      data: {
        id: assetId,
        projectId,
        rootAssetId: assetId,
        operation: DesignAssetOperation.IMPORTED,
        url: "s3://" + sourceKey,
        width: 600,
        height: 800,
      },
    });
    await prisma.style.create({
      data: {
        projectId,
        code: "CURRENT-CODE",
        name: "Current renamed style",
        category: "外套",
        season: "FW26",
        revisions: {
          create: {
            id: styleRevisionId,
            revision: 1,
            sourceAssetId: assetId,
            createdBy: ownerId,
            payload: studioStyleSchema.parse({
              name: "原始结构风衣",
              code: "FROZEN-001",
              category: "外套",
              sourceAssetId: assetId,
            }),
          },
        },
      },
    });
    const pack = studioTechPackSchema.parse({
      name: "风衣技术包",
      styleRevisionId,
      status: "PUBLISHED",
      reviewConfirmed: true,
      views: [
        { kind: "front", assetId, reviewed: true },
        { kind: "back", assetId, reviewed: true },
      ],
      bom: [
        {
          name: "主面料",
          material: "供应商棉料",
          quantity: 2.4,
          unit: "m",
          source: "supplier",
          reviewed: true,
        },
      ],
      pom: [
        {
          name: "衣长",
          value: 110,
          unit: "cm",
          tolerance: 1,
          source: "measured",
          reviewed: true,
        },
      ],
      colors: [{ name: "沙色", hex: "#b7a078", reviewed: true }],
      constructionNotes: "按样衣实测复核。",
    });
    const presentation = studioPresentationSchema.parse({
      name: "风衣电商展示包",
      styleRevisionId,
      status: "READY",
      channel: "marketplace",
      items: [
        {
          assetId,
          kind: "front",
          label: "已核对商品外观的正面展示图",
          reviewed: true,
        },
      ],
      notes: "图片仅用于视觉展示。",
    });
    await prisma.studioDocument.createMany({
      data: [
        {
          id: packId,
          documentId: packId,
          projectId,
          ownerId,
          createdById: ownerId,
          type: "TECH_PACK",
          revision: 1,
          styleRevisionId,
          payload: pack,
        },
        {
          id: presentationId,
          documentId: presentationId,
          projectId,
          ownerId,
          createdById: ownerId,
          type: "PRESENTATION_SET",
          revision: 1,
          styleRevisionId,
          payload: presentation,
        },
      ],
    });
    const redis = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
    const connection = {
      host: redis.hostname,
      port: Number(redis.port || 6379),
      ...(redis.password ? { password: redis.password } : {}),
      ...(redis.username ? { username: redis.username } : {}),
    };
    queue = new Queue<ExportJobData>(queueName, {
      prefix,
      connection: { ...connection, maxRetriesPerRequest: 1 },
    });
    events = new QueueEvents(queueName, {
      prefix,
      connection: { ...connection, maxRetriesPerRequest: null },
    });
    const processExport = createExportProcessor({ database: prisma, storage });
    worker = new Worker<ExportJobData>(
      queueName,
      async (job) => {
        if (job.data.action !== "render")
          throw new Error("unexpected fixture job action");
        const result = await processExport(job.data.exportId);
        objectKeys.add(result.objectKey);
        return result;
      },
      {
        prefix,
        connection: { ...connection, maxRetriesPerRequest: null },
        concurrency: 1,
      },
    );
    await Promise.all([
      queue.waitUntilReady(),
      events.waitUntilReady(),
      worker.waitUntilReady(),
    ]);
    const exportsQueue = {
      enqueue: async (exportId: string) => {
        if (!queue) throw new Error("fixture queue unavailable");
        await queue.add(
          "render",
          { action: "render", exportId },
          { jobId: "render-" + exportId, attempts: 1 },
        );
      },
      state: async (exportId: string) => {
        const job = await queue?.getJob("render-" + exportId);
        return job ? job.getState() : "missing";
      },
    };
    // Scope selection to this project so the production transaction, lease,
    // dispatch and ack paths cannot claim other users' pending outbox events.
    const dispatchDatabase = {
      workflowOutbox: prisma.workflowOutbox,
      exportJob: prisma.exportJob,
      $transaction: async <T>(
        callback: (tx: Prisma.TransactionClient) => Promise<T>,
      ) =>
        prisma.$transaction(async (tx) =>
          callback({
            workflowOutbox: tx.workflowOutbox,
            $queryRaw: () =>
              tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT id FROM workflow_outbox WHERE project_id = ${projectId}
          AND event_type IN ('generation.dispatch', 'export.dispatch', 'export.cleanup')
          AND available_at <= NOW() AND (status = 'pending' OR (status = 'processing' AND lease_expires_at < NOW()))
          ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1`),
          } as unknown as Prisma.TransactionClient),
        ),
    } as unknown as PrismaClient;
    const files = new S3FileStorage();
    dispatcher = new TaskDispatchService(
      dispatchDatabase,
      {} as never,
      exportsQueue as never,
      files,
    );
    const service = new ExportsService(
      prisma,
      {
        enqueue: async () => {
          throw new Error("simulated API queue interruption");
        },
      },
      files,
      new ProjectAccessPolicy(prisma),
    );
    const module = await Test.createTestingModule({
      controllers: [ExportsController],
      providers: [{ provide: ExportsService, useValue: service }],
    }).compile();
    application = module.createNestApplication({ logger: false });
    application.use(
      (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
        const identity = req.headers["x-fixture-user"];
        if (
          typeof identity === "string" &&
          [ownerId, viewerId, outsiderId].includes(identity)
        ) {
          req.auth = {
            userId: identity,
            authUserId: identity,
            email: identity + "@example.com",
          };
        }
        next();
      },
    );
    application.setGlobalPrefix("api");
    await application.init();
  });

  afterAll(async () => {
    await application?.close();
    await dispatcher?.onModuleDestroy();
    await worker?.close();
    await events?.close();
    if (queue) {
      await queue.obliterate({ force: true });
      await queue.close();
    }
    const rows = await prisma.exportJob.findMany({
      where: { projectId },
      select: { objectKey: true },
    });
    for (const row of rows) if (row.objectKey) objectKeys.add(row.objectKey);
    const currentStorage = storage;
    if (currentStorage)
      await Promise.all(
        [...objectKeys, sourceKey].map((key) => currentStorage.delete(key)),
      );
    await prisma.studioDocument.deleteMany({ where: { projectId } });
    await prisma.style.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, viewerId, outsiderId] } },
    });
  });

  it.each(["tech_pack", "presentation_set"] as const)(
    "%s 从 HTTP 创建经 outbox 和真实 BullMQ 生成私有 PDF，并即时执行成员撤权",
    async (sourceType) => {
      if (!application || !queue || !events || !dispatcher)
        throw new Error("pipeline fixture unavailable");
      const server = application.getHttpServer() as Parameters<
        typeof request
      >[0];
      const payload = {
        sourceType,
        studioRevisionId: sourceType === "tech_pack" ? packId : presentationId,
        format: "pdf",
        quality: "standard",
      };
      const key = randomUUID();
      const created = await request(server)
        .post("/api/exports")
        .set("x-fixture-user", ownerId)
        .set("idempotency-key", key)
        .send(payload)
        .expect(202);
      const exportId = (created.body as { id: string }).id;
      expect(created.body).toMatchObject({ status: "queued" });
      const replay = await request(server)
        .post("/api/exports")
        .set("x-fixture-user", ownerId)
        .set("idempotency-key", key)
        .send(payload)
        .expect(202);
      expect((replay.body as { id: string }).id).toBe(exportId);
      expect(await queue.getJob("render-" + exportId)).toBeUndefined();
      expect(
        await prisma.workflowOutbox.count({
          where: {
            projectId,
            eventKey: "export:" + exportId + ":dispatch",
            status: "pending",
          },
        }),
      ).toBe(1);
      await dispatcher.drain();
      const job = await queue.getJob("render-" + exportId);
      if (!job) throw new Error("outbox failed to dispatch the durable export");
      await job.waitUntilFinished(events, 10_000);
      expect(
        await prisma.workflowOutbox.count({
          where: {
            projectId,
            eventKey: "export:" + exportId + ":dispatch",
            status: "completed",
          },
        }),
      ).toBe(1);
      const result = await request(server)
        .get("/api/exports/" + exportId)
        .set("x-fixture-user", viewerId)
        .expect(200);
      const body = result.body as { fileName: string; downloadUrl: string };
      expect(body).toMatchObject({
        status: "succeeded",
        fileName:
          "FROZEN-001-" +
          (sourceType === "tech_pack" ? "tech-pack" : "presentation") +
          "-r1.pdf",
      });
      expect(result.headers["cache-control"]).toBe("private, no-store");
      const redirect = await request(server)
        .get(body.downloadUrl)
        .set("x-fixture-user", viewerId)
        .expect(307);
      const signed = redirect.headers["location"] as string;
      expect(
        Number(new URL(signed).searchParams.get("X-Amz-Expires")),
      ).toBeLessThanOrEqual(60);
      const response = await fetch(signed);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(
        Buffer.from(await response.arrayBuffer())
          .subarray(0, 5)
          .toString(),
      ).toBe("%PDF-");
      const unsigned = new URL(signed);
      unsigned.search = "";
      expect((await fetch(unsigned)).status).toBe(403);
      await request(server)
        .get("/api/exports/" + exportId)
        .set("x-fixture-user", outsiderId)
        .expect(403);
      await request(server)
        .post("/api/exports")
        .set("x-fixture-user", outsiderId)
        .send(payload)
        .expect(403);
      await prisma.workspaceMember.deleteMany({
        where: { workspaceId, userId: viewerId },
      });
      await request(server)
        .get("/api/exports/" + exportId)
        .set("x-fixture-user", viewerId)
        .expect(403);
      await request(server)
        .get(body.downloadUrl)
        .set("x-fixture-user", viewerId)
        .expect(403);
      await prisma.workspaceMember.create({
        data: { workspaceId, userId: viewerId, role: "VIEWER" },
      });
      expect(
        await prisma.generationTask.count({ where: { userId: ownerId } }),
      ).toBe(0);
    },
  );
});
