import { DesignAssetOperation, prisma } from "@fashion/db";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { studioBrandSchema, studioTechPackSchema } from "@fashion/shared";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ExportsService } from "../exports/exports.service";
import { ProjectAccessPolicy } from "./project-access.policy";
import { StudioService } from "./studio.service";

describe("工作室真实持久化", () => {
  it("保持款式修订、私有品牌复用、人工发布和异步导出的完整链路", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "studio-owner-" + randomUUID() + "@example.com",
        ownedWorkspaces: {
          create: {
            name: "Studio acceptance",
            projects: { create: [{ name: "Original" }, { name: "Reuse" }] },
          },
        },
      },
      include: { ownedWorkspaces: { include: { projects: true } } },
    });
    const workspace = owner.ownedWorkspaces[0];
    const project = workspace?.projects[0];
    const second = workspace?.projects[1];
    if (!workspace || !project || !second)
      throw new Error("missing isolated project");
    const reviewer = await prisma.user.create({
      data: { email: "studio-reviewer-" + randomUUID() + "@example.com" },
    });
    const storage = {
      createDownloadUrl: vi.fn(async () => "https://private.test/signed"),
    };
    const access = new ProjectAccessPolicy(prisma);
    const studio = new StudioService(prisma, access);
    const queue = { enqueue: vi.fn(async () => undefined) };
    const exports = new ExportsService(prisma, queue, storage as never, access);
    try {
      await prisma.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: reviewer.id,
          role: "REVIEWER",
        },
      });
      const assetId = randomUUID();
      const asset = await prisma.designAsset.create({
        data: {
          id: assetId,
          projectId: project.id,
          rootAssetId: assetId,
          operation: DesignAssetOperation.IMPORTED,
          url: "s3://studio-test/source.png",
        },
      });
      const payload = {
        name: "短夹克",
        code: "J-001",
        category: "外套",
        season: "SS27",
        sourceAssetId: asset.id,
        views: [{ kind: "front", assetId: asset.id }],
        description: "原始领型",
      };
      const create = { ...payload, requestKey: randomUUID() };
      const copies = await Promise.all([
        studio.createStyle(owner.id, project.id, create),
        studio.createStyle(owner.id, project.id, create),
      ]);
      expect(copies[0]?.id).toBe(copies[1]?.id);
      expect(
        await prisma.style.count({ where: { projectId: project.id } }),
      ).toBe(1);
      const original = copies[0];
      if (!original) throw new Error("missing style");
      const updates = await Promise.allSettled([
        studio.updateStyle(owner.id, project.id, original.id, {
          ...payload,
          name: "领型A",
          expectedVersion: 1,
          requestKey: randomUUID(),
        }),
        studio.updateStyle(owner.id, project.id, original.id, {
          ...payload,
          name: "领型B",
          expectedVersion: 1,
          requestKey: randomUUID(),
        }),
      ]);
      expect(
        updates.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = updates.find((result) => result.status === "rejected");
      expect(
        rejected?.status === "rejected" &&
          rejected.reason instanceof ConflictException,
      ).toBe(true);
      const current = (await studio.summary(owner.id, project.id)).styles[0];
      if (!current) throw new Error("missing current style");
      expect(current.version).toBe(2);
      expect(current.revisions[1]?.payload.description).toBe("原始领型");
      const brand = await studio.saveDocument(owner.id, project.id, {
        type: "BRAND_PROFILE",
        requestKey: randomUUID(),
        payload: {
          name: "Private Atelier",
          silhouettes: ["短廓形"],
          referenceAssetIds: [asset.id],
        },
      });
      expect(
        (await studio.summary(reviewer.id, project.id)).brandProfiles,
      ).toEqual([]);
      expect(await studio.brandLibrary(reviewer.id, second.id)).toEqual([]);
      const library = await studio.brandLibrary(owner.id, second.id);
      expect(
        studioBrandSchema.parse(library[0]?.currentRevision.payload)
          .referenceAssetIds,
      ).toEqual([]);
      const importInput = {
        revisionId: brand.currentRevision.id,
        requestKey: randomUUID(),
      };
      const imported = await studio.importBrand(
        owner.id,
        second.id,
        importInput,
      );
      const replay = await studio.importBrand(owner.id, second.id, importInput);
      expect(imported.id).toBe(replay.id);
      expect(
        studioBrandSchema.parse(imported.currentRevision.payload),
      ).toMatchObject({
        referenceAssetIds: [],
        copiedFromRevisionId: brand.currentRevision.id,
      });
      const draft = studioTechPackSchema.parse({
        name: "夹克技术包",
        styleRevisionId: current.currentRevision.id,
        views: [
          { kind: "front", assetId: asset.id, reviewed: true },
          { kind: "back", assetId: asset.id, reviewed: true },
        ],
        bom: [
          {
            name: "主料",
            material: "棉",
            quantity: 1.8,
            unit: "m",
            source: "supplier",
            reviewed: true,
          },
        ],
        pom: [
          {
            name: "胸围",
            value: 100,
            tolerance: 1,
            unit: "cm",
            source: "measured",
            reviewed: true,
          },
        ],
        colors: [{ name: "黑色", hex: "#111111", reviewed: true }],
      });
      await expect(
        studio.saveDocument(owner.id, project.id, {
          type: "TECH_PACK",
          requestKey: randomUUID(),
          payload: { ...draft, status: "PUBLISHED" },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      const pack = await studio.saveDocument(owner.id, project.id, {
        type: "TECH_PACK",
        requestKey: randomUUID(),
        payload: draft,
      });
      const published = await studio.saveDocument(reviewer.id, project.id, {
        type: "TECH_PACK",
        documentId: pack.id,
        expectedVersion: 1,
        requestKey: randomUUID(),
        payload: { ...draft, status: "PUBLISHED", reviewConfirmed: true },
      });
      expect(
        studioTechPackSchema.parse(published.currentRevision.payload).status,
      ).toBe("PUBLISHED");
      expect(
        studioTechPackSchema.parse(published.revisions[1]?.payload).status,
      ).toBe("DRAFT");
      expect(published.currentRevision.createdById).toBe(reviewer.id);
      const exportInput = {
        sourceType: "tech_pack",
        studioRevisionId: published.currentRevision.id,
        format: "pdf",
        quality: "standard",
      } as const;
      const key = randomUUID();
      const exported = await exports.create(reviewer.id, exportInput, key);
      const exportReplay = await exports.create(reviewer.id, exportInput, key);
      expect(exported.id).toBe(exportReplay.id);
      expect(queue.enqueue).toHaveBeenCalledOnce();
      expect(
        await prisma.workflowOutbox.count({
          where: {
            projectId: project.id,
            eventKey: "export:" + exported.id + ":dispatch",
          },
        }),
      ).toBe(1);
      await prisma.workspaceMember.deleteMany({
        where: { workspaceId: workspace.id, userId: reviewer.id },
      });
      await expect(
        exports.get(reviewer.id, exported.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        exports.create(reviewer.id, exportInput, key),
      ).rejects.toBeInstanceOf(ForbiddenException);
    } finally {
      await prisma.exportJob.deleteMany({
        where: { projectId: { in: [project.id, second.id] } },
      });
      await prisma.studioDocument.deleteMany({
        where: { projectId: { in: [project.id, second.id] } },
      });
      await prisma.styleRevision.deleteMany({
        where: { style: { projectId: { in: [project.id, second.id] } } },
      });
      await prisma.style.deleteMany({
        where: { projectId: { in: [project.id, second.id] } },
      });
      await prisma.user.delete({ where: { id: owner.id } });
      await prisma.user.delete({ where: { id: reviewer.id } });
    }
  });
});
