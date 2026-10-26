import "reflect-metadata";
import { prisma } from "@fashion/db";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { RunwayRunView, RunwayShowView } from "@fashion/shared";
import type { NextFunction, Response } from "express";
import { randomUUID } from "node:crypto";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { RunwayController } from "./runway.controller";
import { RunwayService } from "./runway.service";
import { RunwayStorage } from "./runway-storage.service";

// Identity alone is a fixture. HTTP, authorization policy, database, Python command
// execution, persistent checkpoints, FFmpeg and private MinIO are real.
describe.skipIf(process.env.RUNWAY_PIPELINE_INTEGRATION !== "1")("服装秀 HTTP 与 Python 真实链路", () => {
  const suffix = randomUUID();
  const ownerId = `runway-owner-${suffix}`;
  const viewerId = `runway-viewer-${suffix}`;
  const outsiderId = `runway-outsider-${suffix}`;
  const projectId = `runway-project-${suffix}`;
  const workspaceId = `runway-workspace-${suffix}`;
  const sourceKey = `runway-integration/${suffix}/中文面料.png`;
  const base = `/projects/${projectId}/runway`;
  let app: INestApplication;
  const storage = new RunwayStorage();
  const bucket = process.env.S3_BUCKET || "fashion-assets";
  const s3 = new S3Client({ ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}), region: process.env.S3_REGION || "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID || "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "" } });
  let assetId: string;
  const http = () => request(app.getHttpServer());
  const getRun = async (id: string): Promise<RunwayRunView> => (await http().get(`${base}/runs/${id}`).expect(200)).body as RunwayRunView;
  const wait = async (id: string): Promise<RunwayRunView> => {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const run = await getRun(id);
      if (!["QUEUED", "RUNNING"].includes(run.status)) return run;
      await new Promise((done) => setTimeout(done, 250));
    }
    throw new Error(`服装秀运行超时：${JSON.stringify(await getRun(id))}`);
  };
  const finish = async (id: string) => {
    for (let transition = 0; transition < 20; transition++) {
      const run = await wait(id);
      if (run.status === "SUCCEEDED") return run;
      expect(run.status, JSON.stringify(run.state)).toBe("WAITING_INPUT");
      const pending = run.pendingInput;
      if (!pending) throw new Error("等待状态缺少待确认记录");
      const stages = run.state.mediaByStage as Record<string, unknown>;
      const currentIds = (kind: string) => Array.isArray(stages[kind]) ? stages[kind].filter((id): id is string => typeof id === "string") : [];
      const modelIds = currentIds("model");
      const clothIds = currentIds("cloth");
      await http().post(`${base}/runs/${id}/actions`).send({
        kind: pending.kind === "pair" ? "pair" : "confirm", requestKey: randomUUID(), expectedVersion: run.version,
        interruptId: pending.interruptId,
        ...(pending.kind === "pair" ? { pairings: Array.from({ length: run.inputSnapshot.modelCount }, (_, index) => ({ modelMediaId: modelIds[index % modelIds.length], clothMediaId: clothIds[index % clothIds.length] })) } : {}),
      }).expect(201);
    }
    throw new Error("服装秀超过预期阶段数");
  };

  beforeAll(async () => {
    await prisma.user.createMany({ data: [
      { id: ownerId, email: `${ownerId}@example.com` }, { id: viewerId, email: `${viewerId}@example.com` },
      { id: outsiderId, email: `${outsiderId}@example.com` },
    ] });
    await prisma.workspace.create({ data: { id: workspaceId, name: "Runway isolated pipeline", ownerId,
      members: { create: { userId: viewerId, role: "VIEWER" } }, projects: { create: { id: projectId, name: "Runway acceptance" } } } });
    const body = await sharp({ create: { width: 384, height: 512, channels: 3, background: "#709580" } }).png().toBuffer();
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: sourceKey, Body: body, ContentType: "image/png" }));
    assetId = randomUUID();
    await prisma.designAsset.create({ data: { id: assetId, projectId, rootAssetId: assetId, operation: "IMPORTED", url: `s3://${sourceKey}`, width: 384, height: 512 } });
    const service = new RunwayService(prisma, new ProjectAccessPolicy(prisma), storage);
    const module = await Test.createTestingModule({ controllers: [RunwayController], providers: [
      { provide: RunwayService, useValue: service }, { provide: RunwayStorage, useValue: storage },
    ] }).compile();
    app = module.createNestApplication();
    app.use((req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
      const userId = String(req.headers["x-runway-test-user"] ?? ownerId);
      req.auth = { userId, authUserId: userId, email: `${userId}@example.com` };
      next();
    });
    await app.init();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    const media = await prisma.runwayMedia.findMany({ where: { projectId }, select: { objectKey: true } });
    for (const item of media) await storage.delete(item.objectKey);
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: sourceKey }));
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, viewerId, outsiderId] } } });
    s3.destroy();
  }, 30_000);

  it("复用项目图片，人工修改和配对，输出可拖动私有成片并从历史分支重跑", async () => {
    const originalQuota = await prisma.user.findUniqueOrThrow({ where: { id: ownerId }, select: { generationCount: true } });
    const createBody = { title: "中文服装秀", requestKey: randomUUID(), draft: { prompt: "自然光秀场，保留衣服轮廓和面料，两位模特依次走秀", modelCount: 2, withMusic: true, inputs: [{ kind: "cloth", sourceType: "asset", sourceId: assetId }] } };
    const created = (await http().post(`${base}/shows`).send(createBody).expect(201)).body as RunwayShowView;
    const duplicate = (await http().post(`${base}/shows`).send(createBody).expect(201)).body as RunwayShowView;
    expect(duplicate.id).toBe(created.id);
    await http().post(`${base}/shows`).set("x-runway-test-user", viewerId).send({ ...createBody, requestKey: randomUUID() }).expect(403);
    await http().get(`${base}/shows`).set("x-runway-test-user", outsiderId).expect(403);
    const startBody = { requestKey: randomUUID(), expectedVersion: created.version };
    const started = (await http().post(`${base}/shows/${created.id}/runs`).send(startBody).expect(201)).body as RunwayRunView;
    expect(((await http().post(`${base}/shows/${created.id}/runs`).send(startBody).expect(201)).body as RunwayRunView).id).toBe(started.id);
    let pending = await wait(started.id);
    expect(pending.status, JSON.stringify(pending.state)).toBe("WAITING_INPUT");
    // The first confirm checkpoint exposes editable generated model/clothing images.
    if (pending.pendingInput?.kind === "confirm" && pending.pendingInput.mediaIds?.length) {
      await http().post(`${base}/runs/${pending.id}/actions`).send({ kind: "edit", requestKey: randomUUID(), expectedVersion: pending.version,
        interruptId: pending.pendingInput.interruptId, mediaId: pending.pendingInput.mediaIds[0], instruction: "保持轮廓，将局部配色改为深绿" }).expect(201);
      pending = await wait(started.id);
      expect(pending.status, JSON.stringify(pending.state)).toBe("WAITING_INPUT");
    }
    await http().post(`${base}/runs/${started.id}/actions`).send({ kind: "confirm", requestKey: randomUUID(), expectedVersion: 0, interruptId: "expired" }).expect(400);
    const complete = await finish(started.id);
    const final = complete.media.find((media) => media.kind === "final_video");
    if (!final) throw new Error("已完成运行缺少配乐成片");
    expect(final.durationMs).toBeGreaterThan(0);
    expect(final.mimeType).toBe("video/mp4");
    const contentPath = `${base}/media/${final.id}/content`;
    const range = await http().get(contentPath).set("Range", "bytes=0-63").expect(206);
    expect(range.headers["content-range"]).toMatch(/^bytes 0-63\//u);
    expect(range.headers["content-length"]).toBe("64");
    await http().get(contentPath).set("Range", "bytes=999999999999-").expect(416);
    await http().get(contentPath).set("x-runway-test-user", outsiderId).expect(403);
    await http().get(contentPath).set("x-runway-test-user", viewerId).set("Range", "bytes=0-15").expect(206);
    const selectedStoryboard = complete.media.find((media) => media.kind === "storyboard");
    if (!selectedStoryboard) throw new Error("已完成运行缺少分镜");
    const fork = (await http().post(`${base}/runs/${complete.id}/forks`).send({ requestKey: randomUUID(), expectedVersion: complete.version, stage: "storyboard", mediaId: selectedStoryboard.id }).expect(201)).body as RunwayRunView;
    expect(fork.parentRunId).toBe(complete.id);
    const forkComplete = await finish(fork.id);
    expect(forkComplete.status).toBe("SUCCEEDED");
    expect(await prisma.runwayStepAttempt.count({ where: { runId: fork.id, stage: "video" } })).toBe(1);
    expect(forkComplete.media.filter((media) => media.kind === "video" && typeof media.source.parentMediaId === "string")).toHaveLength(1);
    expect((await getRun(complete.id)).media.some((media) => media.id === final.id)).toBe(true);
    const latest = await prisma.user.findUniqueOrThrow({ where: { id: ownerId }, select: { generationCount: true } });
    expect(latest.generationCount).toBe(originalQuota.generationCount);
  }, 240_000);
});
