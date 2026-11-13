import { describe, expect, it, vi } from "vitest";

import { StudioSharesService } from "./studio-shares.service";

const stylePayload = {
  name: "轻量通勤外套",
  code: "AW26-017",
  category: "外套",
  season: "AW26",
  description: "",
  sourceAssetId: "asset-front",
  views: [
    { kind: "front", assetId: "asset-front", label: "正面", reviewed: true },
  ],
  status: "REVIEW",
  changeNote: "",
};

function harness() {
  const database = {
    studioShareLink: { findFirst: vi.fn() },
    styleRevision: { findUnique: vi.fn() },
    studioDocument: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    designAsset: { findMany: vi.fn() },
  } as never;
  const access = { require: vi.fn() } as never;
  const storage = { createDownloadUrl: vi.fn() } as never;
  return {
    database,
    service: new StudioSharesService(database, access, storage),
    storage,
  } as unknown as {
    database: {
      studioShareLink: { findFirst: ReturnType<typeof vi.fn> };
      studioDocument: { create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
      designAsset: { findMany: ReturnType<typeof vi.fn> };
    };
    service: StudioSharesService;
    storage: { createDownloadUrl: ReturnType<typeof vi.fn> };
  };
}

describe("studio review shares", () => {
  it("returns only the exact style revision and its review decisions", async () => {
    const { database, service, storage } = harness();
    database.studioShareLink.findFirst.mockResolvedValue({
      projectId: "project-1",
      targetType: "STYLE",
      expiresAt: new Date("2026-11-18T00:00:00.000Z"),
      project: { id: "project-1", name: "秋冬通勤服装设计" },
      styleRevision: {
        id: "style-r3",
        revision: 3,
        payload: stylePayload,
        style: { code: "AW26-017" },
      },
      studioDocument: null,
    });
    database.designAsset.findMany.mockResolvedValue([
      { id: "asset-front", url: "s3://originals/front.png", thumbnailUrl: "s3://thumbs/front.png", width: 600, height: 800 },
    ]);
    database.studioDocument.findMany.mockResolvedValue([
      {
        createdAt: new Date("2026-11-11T08:00:00.000Z"),
        payload: {
          name: "修订评审",
          targetType: "STYLE",
          targetRevisionId: "style-r3",
          decision: "APPROVED",
          text: "廓形已确认",
        },
      },
    ]);
    storage.createDownloadUrl.mockImplementation(async (key: string) => `https://cdn.test/${key}`);

    const result = await service.publicView("a".repeat(43));

    expect(result.title).toBe("轻量通勤外套");
    expect(result.revision).toBe(3);
    expect(result.views[0]?.url).toBe("https://cdn.test/originals/front.png");
    expect(result.reviews[0]?.decision).toBe("APPROVED");
  });

  it("rejects malformed public tokens before touching the database", async () => {
    const { database, service } = harness();
    await expect(service.publicView("short")).rejects.toThrow("分享不存在或已失效");
    expect(database.studioShareLink.findFirst).not.toHaveBeenCalled();
  });

  it("writes a public approval back to the exact shared revision", async () => {
    const { database, service } = harness();
    database.studioShareLink.findFirst.mockResolvedValue({
      ownerId: "owner-1",
      projectId: "project-1",
      styleRevisionId: "style-r3",
      studioDocumentId: null,
      targetType: "STYLE",
    });
    database.studioDocument.create.mockResolvedValue({ id: "review-1" });

    await service.addPublicReview("b".repeat(43), {
      decision: "CHANGES_REQUESTED",
      reviewerName: "客户评审",
      text: "请再确认袖口结构",
    }, "review-request-1");

    expect(database.studioDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: "owner-1",
          projectId: "project-1",
          type: "REVIEW",
          payload: expect.objectContaining({
            decision: "CHANGES_REQUESTED",
            targetRevisionId: "style-r3",
            targetType: "STYLE",
            text: "请再确认袖口结构",
          }),
        }),
      }),
    );
  });

  it("writes a public comment as a comment document without changing approval state", async () => {
    const { database, service } = harness();
    database.studioShareLink.findFirst.mockResolvedValue({
      ownerId: "owner-1",
      projectId: "project-1",
      styleRevisionId: "style-r3",
      studioDocumentId: null,
      targetType: "STYLE",
    });
    database.studioDocument.findUnique.mockResolvedValue(null);
    database.studioDocument.create.mockResolvedValue({ id: "comment-1" });

    await service.addPublicReview("c".repeat(43), {
      kind: "comment",
      reviewerName: "客户评审",
      text: "补充确认袖口结构和面料观感",
    }, "comment-request-1");

    expect(database.studioDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "COMMENT",
          payload: expect.objectContaining({
            targetRevisionId: "style-r3",
            targetType: "STYLE",
            text: "补充确认袖口结构和面料观感",
          }),
        }),
      }),
    );
  });
});

