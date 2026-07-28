import {
  AccountPlan,
  DesignAssetOperation,
  ExportFormat,
  ExportQuality,
  ExportStatus,
  SimilarityAnalysisStatus,
  prisma,
} from "@fashion/db";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cleanupExport,
  createExportProcessor,
} from "./export.processor";
import { S3ThumbnailStorage } from "../storage";

describe("真实对象存储导出流水线", () => {
  const suffix = randomUUID();
  const userId = `export-user-${suffix}`;
  const projectId = `export-project-${suffix}`;
  const assetId = `export-asset-${suffix}`;
  const collectionId = `export-collection-${suffix}`;
  const sourceKey = `thumbnails/export-tests/${suffix}/source.png`;
  let storage: S3ThumbnailStorage;

  beforeAll(async () => {
    process.env.S3_ENDPOINT ??= "http://127.0.0.1:9000";
    process.env.S3_REGION ??= "us-east-1";
    process.env.S3_BUCKET ??= "fashion-assets";
    process.env.S3_ACCESS_KEY_ID ??= "fashion_minio";
    process.env.S3_SECRET_ACCESS_KEY ??= "fashion_minio_dev_secret";
    process.env.S3_FORCE_PATH_STYLE ??= "true";
    storage = new S3ThumbnailStorage();

    const source = await sharp({
      create: {
        background: "#c8bca8",
        channels: 3,
        height: 1_800,
        width: 2_400,
      },
    })
      .png()
      .toBuffer();
    await storage.put(sourceKey, source, "image/png");

    await prisma.user.create({
      data: {
        email: `export-${suffix}@example.com`,
        id: userId,
        plan: AccountPlan.FREE,
        ownedWorkspaces: {
          create: {
            name: "Export Test",
            projects: {
              create: {
                id: projectId,
                name: "Export Project",
                designAssets: {
                  create: {
                    id: assetId,
                    operation: DesignAssetOperation.GENERATED,
                    rootAssetId: assetId,
                    url: `http://127.0.0.1:9000/fashion-assets/${sourceKey}`,
                    width: 2_400,
                    height: 1_800,
                  },
                },
              },
            },
          },
        },
      },
    });
    await prisma.collection.create({
      data: {
        dna: {
          create: {
            fabrics: ["wool"],
            moodWords: ["quiet"],
            palette: [
              { hex: "#24313A", name: "Ink" },
              { hex: "#D8C9B4", name: "Sand" },
            ],
            referenceFileIds: [],
            silhouettes: ["cocoon"],
          },
        },
        heroAssetId: assetId,
        id: collectionId,
        looks: {
          create: {
            analysisStatus: SimilarityAnalysisStatus.READY,
            designAssetId: assetId,
            isHero: true,
            ordinal: 1,
          },
        },
        name: "Quiet Structure",
        projectId,
      },
    });
  });

  afterAll(async () => {
    const jobs = await prisma.exportJob.findMany({
      where: { userId },
      select: { objectKey: true },
    });
    await Promise.all(
      jobs.flatMap((job) =>
        job.objectKey ? [storage.delete(job.objectKey)] : [],
      ),
    );
    await storage.delete(sourceKey);
    await prisma.user.delete({ where: { id: userId } });
  });

  it("在真实 S3 兼容存储中生成 PNG、JPG、PDF 并可重新读取", async () => {
    const processExport = createExportProcessor({
      database: prisma,
      storage,
    });
    const requests = [
      {
        designAssetId: assetId,
        format: ExportFormat.PNG,
        maxEdge: 1_600,
        quality: ExportQuality.STANDARD,
        watermark: true,
      },
      {
        designAssetId: assetId,
        format: ExportFormat.JPG,
        maxEdge: null,
        quality: ExportQuality.HIGH,
        watermark: false,
      },
      {
        collectionId,
        format: ExportFormat.PDF,
        maxEdge: 1_600,
        quality: ExportQuality.STANDARD,
        watermark: true,
      },
    ] as const;
    const created = await Promise.all(
      requests.map((request) =>
        prisma.exportJob.create({
          data: {
            ...request,
            projectId,
            status: ExportStatus.QUEUED,
            userId,
          },
        }),
      ),
    );

    const results = [];
    for (const exportJob of created) {
      results.push(await processExport(exportJob.id));
    }
    const [png, jpg, pdf] = await Promise.all(
      results.map((result) => storage.get(result.objectKey)),
    );
    if (!png || !jpg || !pdf) {
      throw new Error("三种导出格式未全部生成");
    }

    expect(await sharp(png).metadata()).toMatchObject({
      format: "png",
      width: 1_600,
    });
    expect(await sharp(jpg).metadata()).toMatchObject({
      format: "jpeg",
      width: 2_400,
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    for (const [index, exportJob] of created.entries()) {
      await cleanupExport(
        prisma,
        storage,
        exportJob.id,
        results[index]?.objectKey,
        new Date(Date.now() + 25 * 60 * 60 * 1_000),
      );
    }
    expect(
      await prisma.exportJob.count({
        where: { id: { in: created.map((job) => job.id) }, objectKey: null },
      }),
    ).toBe(3);
  });
});
