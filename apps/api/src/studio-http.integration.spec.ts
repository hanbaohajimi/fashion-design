import "reflect-metadata";
import { prisma } from "@fashion/db";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { AppModule } from "./app.module";
import { AI_PROVIDERS, AMUX_CLAUDE_CLIENT } from "./modules/ai/ai.tokens";
import { AuthService } from "./modules/auth/auth.service";
import { ExperimentsService } from "./modules/experiments/experiments.service";
import { UploadsCleanupService } from "./modules/files/uploads-cleanup.service";

describe("design studio actual AppModule HTTP", () => {
  it("boots actual dependencies and preserves authentication, revision, draft and role contracts without model calls", async () => {
    const owner = await prisma.user.create({
      data: {
        email: `studio-http-owner-${randomUUID()}@example.com`,
        ownedWorkspaces: {
          create: {
            name: "HTTP test",
            projects: { create: { name: "HTTP studio" } },
          },
        },
      },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });
    const workspace = owner.ownedWorkspaces[0];
    const project = workspace?.projects[0];
    if (!workspace || !project) throw new Error("Missing project fixture");
    const viewer = await prisma.user.create({
      data: { email: `studio-http-viewer-${randomUUID()}@example.com` },
    });
    let app: INestApplication | undefined;
    const model = {
      generateJson: vi
        .fn()
        .mockRejectedValue(
          new Error("Model calls are forbidden in this HTTP smoke test"),
        ),
    };
    const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
    try {
      await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: viewer.id, role: "VIEWER" },
      });
      const assetId = randomUUID();
      await prisma.designAsset.create({
        data: {
          id: assetId,
          rootAssetId: assetId,
          projectId: project.id,
          operation: "IMPORTED",
          url: "s3://tests/studio-http/source.png",
        },
      });
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(AuthService)
        .useValue({
          authenticate: async (token: string) => {
            const user = token === "owner-test" ? owner : viewer;
            return { userId: user.id, authUserId: user.id, email: user.email };
          },
        })
        .overrideProvider(AI_PROVIDERS)
        .useValue([])
        .overrideProvider(AMUX_CLAUDE_CLIENT)
        .useValue(model)
        .compile();
      // Keep the real providers and DI graph; suppress background work outside this fixture.
      vi.spyOn(
        module.get(ExperimentsService),
        "onModuleInit",
      ).mockImplementation(() => undefined);
      vi.spyOn(
        module.get(UploadsCleanupService),
        "onModuleInit",
      ).mockImplementation(() => undefined);
      app = module.createNestApplication();
      app.use(cookieParser());
      await app.init();
      const server = app.getHttpServer();
      const url = `/projects/${project.id}/studio`;
      await request(server).get("/health").expect(200);
      await request(server).get("/health/ready").expect(200);
      await request(server).get(url).expect(401);
      const initial = await request(server)
        .get(url)
        .set("Cookie", "fashion_access_token=owner-test")
        .expect(200);
      expect(initial.body).toMatchObject({
        role: "OWNER",
        capabilities: { edit: true, review: true, manageMembers: true },
        styles: [],
        techPacks: [],
      });
      await request(server)
        .post(url + "/styles")
        .set("Cookie", "fashion_access_token=owner-test")
        .set("Origin", origin)
        .send({})
        .expect(400);
      const styleInput = {
        name: "HTTP 大衣",
        code: "HTTP-01",
        category: "外套",
        sourceAssetId: assetId,
        requestKey: randomUUID(),
      };
      const created = await request(server)
        .post(url + "/styles")
        .set("Cookie", "fashion_access_token=owner-test")
        .set("Origin", origin)
        .send(styleInput)
        .expect(201);
      const replay = await request(server)
        .post(url + "/styles")
        .set("Cookie", "fashion_access_token=owner-test")
        .set("Origin", origin)
        .send(styleInput)
        .expect(201);
      expect(replay.body.id).toBe(created.body.id);
      expect(
        await prisma.style.count({ where: { projectId: project.id } }),
      ).toBe(1);
      expect(created.body.currentRevision).toMatchObject({ revision: 1 });
      const updated = await request(server)
        .patch(url + "/styles/" + created.body.id)
        .set("Cookie", "fashion_access_token=owner-test")
        .set("Origin", origin)
        .send({
          ...styleInput,
          name: "复核后的大衣",
          expectedVersion: 1,
          requestKey: randomUUID(),
        })
        .expect(200);
      expect(updated.body.version).toBe(2);
      await request(server)
        .patch(url + "/styles/" + created.body.id)
        .set("Cookie", "fashion_access_token=owner-test")
        .set("Origin", origin)
        .send({
          ...styleInput,
          name: "旧客户端更改",
          expectedVersion: 1,
          requestKey: randomUUID(),
        })
        .expect(409);
      const draft = await request(server)
        .post(url + "/documents")
        .set("Cookie", "fashion_access_token=owner-test")
        .set("Origin", origin)
        .send({
          type: "TECH_PACK",
          requestKey: randomUUID(),
          payload: {
            name: "HTTP 技术包",
            styleRevisionId: updated.body.currentRevision.id,
          },
        })
        .expect(201);
      expect(draft.body.currentRevision.payload.status).toBe("DRAFT");
      await request(server)
        .post(url + "/documents")
        .set("Cookie", "fashion_access_token=owner-test")
        .set("Origin", origin)
        .send({
          type: "TECH_PACK",
          documentId: draft.body.id,
          expectedVersion: 1,
          requestKey: randomUUID(),
          payload: {
            ...draft.body.currentRevision.payload,
            status: "PUBLISHED",
          },
        })
        .expect(400);
      const experimentsUrl = `/projects/${project.id}/experiments`;
      const batch = await request(server)
        .post(experimentsUrl)
        .set("Cookie", "fashion_access_token=owner-test")
        .set("Origin", origin)
        .set("Idempotency-Key", randomUUID())
        .send({
          sourceAssetId: assetId,
          mode: "color",
          prompt: "仅改变服装配色",
          preserve: "保留版型、轮廓与细节",
          colors: [
            { name: "藏青", hex: "#18283B" },
            { name: "米色", hex: "#CFC4AA" },
          ],
        })
        .expect(201);
      expect(batch.body.items).toHaveLength(2);
      expect(
        batch.body.items.every(
          (item: { status: string }) => item.status === "draft",
        ),
      ).toBe(true);
      await request(server)
        .post(experimentsUrl + "/" + batch.body.id + "/actions")
        .set("Cookie", "fashion_access_token=owner-test")
        .set("Origin", origin)
        .send({
          action: "cancel",
          itemIds: batch.body.items.map((item: { id: string }) => item.id),
        })
        .expect(202);
      const view = await request(server)
        .get(url)
        .set("Cookie", "fashion_access_token=viewer-test")
        .expect(200);
      expect(view.body).toMatchObject({
        role: "VIEWER",
        capabilities: { edit: false, review: false, manageMembers: false },
      });
      await request(server)
        .post(url + "/styles")
        .set("Cookie", "fashion_access_token=viewer-test")
        .set("Origin", origin)
        .send({ ...styleInput, code: "HTTP-02", requestKey: randomUUID() })
        .expect(403);
      await request(server)
        .get(experimentsUrl + "/capabilities")
        .set("Cookie", "fashion_access_token=viewer-test")
        .expect(200);
      const exported = await prisma.exportJob.create({
        data: {
          userId: owner.id,
          projectId: project.id,
          designAssetId: assetId,
          format: "PNG",
          quality: "STANDARD",
          watermark: false,
          status: "SUCCEEDED",
          objectKey: "tests/studio-http/export.png",
          fileName: "大衣.png",
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      const exportUrl = "/exports/" + exported.id;
      await request(server)
        .get(exportUrl + "/content")
        .expect(401);
      const exportStatus = await request(server)
        .get(exportUrl)
        .set("Cookie", "fashion_access_token=viewer-test")
        .expect(200);
      expect(exportStatus.body.downloadUrl).toBe(
        "/api/exports/" + exported.id + "/content",
      );
      const redirected = await request(server)
        .get(exportUrl + "/content")
        .set("Cookie", "fashion_access_token=viewer-test")
        .expect(307);
      expect(redirected.headers["cache-control"]).toBe("private, no-store");
      const location = redirected.headers.location;
      if (!location) throw new Error("导出响应缺少短期下载地址");
      expect(new URL(location).searchParams.get("X-Amz-Expires")).toBe("60");
      await prisma.workspaceMember.delete({
        where: {
          workspaceId_userId: { workspaceId: workspace.id, userId: viewer.id },
        },
      });
      await request(server)
        .get(exportUrl + "/content")
        .set("Cookie", "fashion_access_token=viewer-test")
        .expect(403);
      await prisma.exportJob.update({
        where: { id: exported.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      await request(server)
        .get(exportUrl + "/content")
        .set("Cookie", "fashion_access_token=owner-test")
        .expect(410);
      expect(
        await prisma.generationTask.count({ where: { projectId: project.id } }),
      ).toBe(0);
      expect(model.generateJson).not.toHaveBeenCalled();
    } finally {
      await app?.close();
      await prisma.auditLog.deleteMany({
        where: { userId: { in: [owner.id, viewer.id] } },
      });
      await prisma.exportJob.deleteMany({ where: { projectId: project.id } });
      await prisma.studioDocument.deleteMany({
        where: { projectId: project.id },
      });
      await prisma.styleRevision.deleteMany({
        where: { style: { projectId: project.id } },
      });
      await prisma.project.delete({ where: { id: project.id } });
      await prisma.user.delete({ where: { id: owner.id } });
      await prisma.user.delete({ where: { id: viewer.id } });
    }
  }, 60_000);
});
