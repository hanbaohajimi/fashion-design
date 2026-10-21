import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import {
  studioDocumentInputSchema,
  studioPublishIssues,
  studioTechPackSchema,
  type StudioStyleInput,
} from "@fashion/shared";
import { describe, expect, it, vi } from "vitest";
import {
  ProjectAccessPolicy,
  studioCapabilities,
} from "./project-access.policy";
import { StudioService } from "./studio.service";

const payload: StudioStyleInput = {
  name: "短夹克",
  code: "J001",
  category: "外套",
  season: "SS27",
  description: "轻量短夹克",
  sourceAssetId: "asset-a",
  views: [
    { kind: "front", assetId: "asset-a", label: "正面", reviewed: false },
  ],
  status: "DESIGNING",
  changeNote: "初版",
};
function fixture() {
  const now = new Date("2026-10-21T00:00:00.000Z");
  const style = {
    id: "style-a",
    projectId: "project-a",
    name: payload.name,
    code: payload.code,
    category: payload.category,
    season: payload.season,
    status: payload.status,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const revisions: {
    id: string;
    styleId: string;
    revision: number;
    sourceAssetId: string;
    createdBy: string;
    payload: unknown;
    createdAt: Date;
  }[] = [];
  const mutations = new Map<string, { fingerprint: string; result: object }>();
  const database = {
    $transaction: vi.fn(),
    style: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(style),
      findFirst: vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ ...style, revisions: [...revisions].reverse() }),
        ),
      updateMany: vi
        .fn()
        .mockImplementation(
          ({
            where,
            data,
          }: {
            where: { version: number };
            data: { version: { increment: number } };
          }) => {
            if (where.version !== style.version)
              return Promise.resolve({ count: 0 });
            style.version += data.version.increment;
            return Promise.resolve({ count: 1 });
          },
        ),
    },
    styleRevision: {
      create: vi
        .fn()
        .mockImplementation(
          ({ data }: { data: (typeof revisions)[number] }) => {
            const row = {
              ...data,
              id: "revision-" + (revisions.length + 1),
              createdAt: now,
            };
            revisions.push(row);
            return Promise.resolve(row);
          },
        ),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    studioMutation: {
      findUnique: vi
        .fn()
        .mockImplementation(
          ({
            where,
          }: {
            where: { projectId_userId_requestKey: { requestKey: string } };
          }) =>
            Promise.resolve(
              mutations.get(where.projectId_userId_requestKey.requestKey) ??
                null,
            ),
        ),
      create: vi
        .fn()
        .mockImplementation(
          ({
            data,
          }: {
            data: { requestKey: string; fingerprint: string; result: object };
          }) => {
            mutations.set(data.requestKey, data);
            return Promise.resolve(data);
          },
        ),
    },
    studioDocument: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    workspaceMember: { findMany: vi.fn().mockResolvedValue([]) },
    collection: { findMany: vi.fn().mockResolvedValue([]) },
    designAsset: {
      count: vi
        .fn()
        .mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve(where.id.in.filter((id) => id === "asset-a").length),
        ),
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: "asset-a", url: "s3://assets/a.png", thumbnailUrl: null },
        ]),
    },
  };
  database.$transaction.mockImplementation(
    (action: (db: typeof database) => Promise<unknown>) => action(database),
  );
  const access = {
    require: vi.fn().mockResolvedValue({
      projectId: "project-a",
      workspaceId: "ws-a",
      ownerId: "owner-a",
      role: "OWNER",
      capabilities: studioCapabilities("OWNER"),
    }),
  };
  const service = new StudioService(database as never, access as never);
  return { service, database, access, revisions, style };
}

describe("studio immutable revisions and mutation safety", () => {
  it("saves stable style identity and creates a new immutable revision", async () => {
    const { service, revisions } = fixture();
    const first = await service.createStyle("owner-a", "project-a", {
      ...payload,
      requestKey: "create-key-1",
    });
    const next = await service.updateStyle("owner-a", "project-a", first.id, {
      ...payload,
      description: "更新领型",
      expectedVersion: 1,
      requestKey: "update-key-1",
    });
    expect(first.id).toBe(next.id);
    expect(next.version).toBe(2);
    expect(next.currentRevision.payload.description).toBe("更新领型");
    expect(revisions[0]?.payload).toMatchObject({ description: "轻量短夹克" });
    expect(next.revisions.map((row) => row.revision)).toEqual([2, 1]);
  });
  it("replays a retried mutation without creating duplicate styles or revisions", async () => {
    const { service, database, revisions } = fixture();
    const input = { ...payload, requestKey: "create-key-1" };
    const a = await service.createStyle("owner-a", "project-a", input);
    const b = await service.createStyle("owner-a", "project-a", input);
    expect(a.id).toBe(b.id);
    expect(database.style.create).toHaveBeenCalledTimes(1);
    expect(revisions).toHaveLength(1);
  });
  it("rejects reusing the request key for changed inputs", async () => {
    const { service } = fixture();
    await service.createStyle("owner-a", "project-a", {
      ...payload,
      requestKey: "create-key-1",
    });
    await expect(
      service.createStyle("owner-a", "project-a", {
        ...payload,
        name: "不同设计",
        requestKey: "create-key-1",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it("rejects a stale expectedVersion before appending another revision", async () => {
    const { service, revisions } = fixture();
    await service.createStyle("owner-a", "project-a", {
      ...payload,
      requestKey: "create-key-1",
    });
    await service.updateStyle("owner-a", "project-a", "style-a", {
      ...payload,
      expectedVersion: 1,
      requestKey: "update-key-1",
    });
    await expect(
      service.updateStyle("owner-a", "project-a", "style-a", {
        ...payload,
        expectedVersion: 1,
        requestKey: "update-key-2",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(revisions).toHaveLength(2);
  });
  it("rejects cross-project source assets before creating data", async () => {
    const { service, database } = fixture();
    await expect(
      service.createStyle("owner-a", "project-a", {
        ...payload,
        sourceAssetId: "foreign-asset",
        requestKey: "create-key-1",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(database.style.create).not.toHaveBeenCalled();
  });
  it("cannot approve a style by changing the metadata status", async () => {
    const { service } = fixture();
    await expect(
      service.createStyle("owner-a", "project-a", {
        ...payload,
        status: "APPROVED",
        requestKey: "create-key-1",
      }),
    ).rejects.toThrow("评审");
  });
  it("validates the role again inside each mutation transaction", async () => {
    const { service, access, database } = fixture();
    access.require.mockRejectedValue(new ForbiddenException());
    await expect(
      service.createStyle("viewer", "project-a", {
        ...payload,
        requestKey: "create-key-1",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.style.create).not.toHaveBeenCalled();
  });
});

describe("studio image references", () => {
  it("keeps private and external image references usable after opening a long editing session", async () => {
    const { service, database } = fixture();
    database.designAsset.findMany.mockResolvedValue([
      {
        id: "private/image",
        url: "s3://assets/private.png",
        thumbnailUrl: "s3://assets/thumb.png",
      },
      {
        id: "external image",
        url: "https://assets.example/look.png",
        thumbnailUrl: null,
      },
    ]);
    const first = await service.summary("owner-a", "project-a");
    const later = await service.summary("owner-a", "project-a");
    expect(first.assets).toEqual([
      {
        id: "private/image",
        url: "/api/design-assets/private%2Fimage/content",
        thumbnailUrl: "/api/design-assets/private%2Fimage/thumbnail",
      },
      {
        id: "external image",
        url: "/api/design-assets/external%20image/content",
        thumbnailUrl: null,
      },
    ]);
    expect(later.assets).toEqual(first.assets);
  });
  it("uses the same authenticated image references in immutable style revision views", async () => {
    const { service } = fixture();
    const style = await service.createStyle("owner-a", "project-a", {
      ...payload,
      requestKey: "image-style-key",
    });
    expect(style.currentRevision.views[0]?.url).toBe(
      "/api/design-assets/asset-a/content",
    );
  });
  it("denies a revoked member before returning any image references", async () => {
    const { service, database, access } = fixture();
    access.require.mockRejectedValue(new ForbiddenException());
    await expect(
      service.summary("former-member", "project-a"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.designAsset.findMany).not.toHaveBeenCalled();
  });
});

describe("technical specs and sample feedback validation", () => {
  it("keeps unknown measurements nullable and blocks publishing unreviewed drafts", () => {
    const draft = studioTechPackSchema.parse({
      name: "夹克",
      styleRevisionId: "revision-1",
      pom: [{ name: "胸围" }],
      bom: [{ name: "主料", unit: "m" }],
    });
    expect(draft.pom[0]?.value).toBeNull();
    expect(studioPublishIssues(draft)).toContain("POM 需要已复核的尺寸和公差");
    expect(studioPublishIssues(draft)).toContain("请确认人工复核");
  });
  it("requires reviewed, sourced BOM and POM plus reviewed front and back views", () => {
    const ready = studioTechPackSchema.parse({
      name: "夹克",
      styleRevisionId: "revision-1",
      reviewConfirmed: true,
      views: [
        { kind: "front", assetId: "asset-a", reviewed: true },
        { kind: "back", assetId: "asset-b", reviewed: true },
      ],
      bom: [
        {
          name: "主料",
          material: "棉",
          quantity: 1.8,
          unit: "m",
          reviewed: true,
          source: "supplier",
        },
      ],
      pom: [
        {
          name: "胸围",
          value: 100,
          tolerance: 1,
          reviewed: true,
          source: "measured",
        },
      ],
      colors: [{ name: "黑", hex: "#111111", reviewed: true }],
    });
    expect(studioPublishIssues(ready)).toEqual([]);
    const first = ready.pom[0];
    if (!first) throw new Error("missing fixture measurement");
    first.source = "ai";
    expect(studioPublishIssues(ready)).not.toEqual([]);
  });
  it("rejects sample problems anchored to an image outside the round", () => {
    expect(
      studioDocumentInputSchema.safeParse({
        type: "SAMPLE_ROUND",
        requestKey: "sample-key-1",
        payload: {
          name: "首轮",
          techPackRevisionId: "pack-1",
          round: 1,
          photoAssetIds: ["photo-a"],
          issues: [
            {
              id: "issue-1",
              assetId: "photo-b",
              x: 0.3,
              y: 0.4,
              category: "FIT",
              text: "领口过大",
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
  it("requires resolution evidence before a sample issue is fixed or verified", () => {
    expect(
      studioDocumentInputSchema.safeParse({
        type: "SAMPLE_ROUND",
        requestKey: "sample-key-1",
        payload: {
          name: "首轮",
          techPackRevisionId: "pack-1",
          round: 1,
          photoAssetIds: ["photo-a"],
          issues: [
            {
              id: "issue-1",
              assetId: "photo-a",
              x: 0.3,
              y: 0.4,
              category: "FIT",
              text: "领口过大",
              status: "VERIFIED",
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
  it("requires CAS version for updates and rejects arbitrary JSON fields", () => {
    expect(
      studioDocumentInputSchema.safeParse({
        type: "BRAND_PROFILE",
        requestKey: "brand-key-1",
        documentId: "brand-a",
        payload: { name: "Atelier" },
      }).success,
    ).toBe(false);
    expect(
      studioDocumentInputSchema.safeParse({
        type: "BRAND_PROFILE",
        requestKey: "brand-key-1",
        payload: { name: "Atelier", injectedPermission: "OWNER" },
      }).success,
    ).toBe(false);
  });
});

describe("workspace roles", () => {
  it("lets members read while reserving edits and approvals for explicit roles", async () => {
    const database = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          id: "project-a",
          wsId: "ws-a",
          deletedAt: null,
          workspace: { ownerId: "owner-a" },
        }),
      },
      workspaceMember: {
        findUnique: vi.fn().mockResolvedValue({ role: "VIEWER" }),
      },
    };
    const policy = new ProjectAccessPolicy(database as never);
    await expect(
      policy.require("viewer-a", "project-a", "read"),
    ).resolves.toMatchObject({ role: "VIEWER" });
    await expect(
      policy.require("viewer-a", "project-a", "edit"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    database.workspaceMember.findUnique.mockResolvedValue({ role: "EDITOR" });
    await expect(
      policy.require("editor-a", "project-a", "edit"),
    ).resolves.toMatchObject({ role: "EDITOR" });
    await expect(
      policy.require("editor-a", "project-a", "review"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("revokes access immediately when the member is removed", async () => {
    const database = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          id: "project-a",
          wsId: "ws-a",
          deletedAt: null,
          workspace: { ownerId: "owner-a" },
        }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    await expect(
      new ProjectAccessPolicy(database as never).require(
        "removed-user",
        "project-a",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("reviewer scope and retained sample verification", () => {
  const pack = studioTechPackSchema.parse({
    name: "技术包",
    styleRevisionId: "style-rev",
    views: [
      { kind: "front", assetId: "asset-a", reviewed: true },
      { kind: "back", assetId: "asset-a", reviewed: true },
    ],
    bom: [
      {
        name: "主料",
        material: "棉",
        quantity: 2,
        unit: "m",
        reviewed: true,
        source: "supplier",
      },
    ],
    pom: [
      {
        name: "胸围",
        value: 100,
        tolerance: 1,
        reviewed: true,
        source: "measured",
      },
    ],
    colors: [{ name: "黑色", hex: "#111111", reviewed: true }],
  });
  function setup(
    role: "OWNER" | "EDITOR" | "REVIEWER",
    kind: "TECH_PACK" | "SAMPLE_ROUND",
    payloadValue: unknown,
  ) {
    const f = fixture();
    const previous = {
      id: "document-rev-1",
      documentId: "document-a",
      projectId: "project-a",
      type: kind,
      revision: 1,
      payload: payloadValue,
      ownerId: "owner-a",
      createdById: "owner-a",
      createdAt: new Date(),
    };
    f.access.require.mockImplementation(
      (_user: string, _project: string, action: string) => {
        const capabilities = studioCapabilities(role);
        if (
          (action === "review" && !capabilities.review) ||
          (action === "edit" && !capabilities.edit)
        )
          return Promise.reject(new ForbiddenException());
        return Promise.resolve({
          projectId: "project-a",
          workspaceId: "ws-a",
          ownerId: "owner-a",
          role,
          capabilities,
        });
      },
    );
    f.database.styleRevision.findFirst.mockResolvedValue({
      id: "style-rev",
      payload,
    });
    f.database.studioDocument.findFirst.mockImplementation(
      ({ where }: { where: { id?: string; documentId?: string } }) =>
        Promise.resolve(
          where.id
            ? { ...previous, type: "TECH_PACK", payload: pack }
            : previous,
        ),
    );
    f.database.studioDocument.create.mockImplementation(
      ({ data }: { data: typeof previous }) => {
        const row = { ...data, id: "document-rev-2", createdAt: new Date() };
        f.database.studioDocument.findMany.mockResolvedValue([row, previous]);
        return Promise.resolve(row);
      },
    );
    return f;
  }
  it("allows a reviewer to publish existing verified content without editing specifications", async () => {
    const f = setup("REVIEWER", "TECH_PACK", pack);
    const result = await f.service.saveDocument("reviewer-a", "project-a", {
      requestKey: "review-pack-1",
      documentId: "document-a",
      expectedVersion: 1,
      type: "TECH_PACK",
      payload: { ...pack, status: "PUBLISHED", reviewConfirmed: true },
    });
    expect(result.version).toBe(2);
    expect(result.currentRevision.payload).toMatchObject({
      status: "PUBLISHED",
    });
    expect(f.database.studioDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ createdById: "reviewer-a" }),
      }),
    );
  });
  it("refuses a reviewer publishing modified engineering values", async () => {
    const f = setup("REVIEWER", "TECH_PACK", pack);
    await expect(
      f.service.saveDocument("reviewer-a", "project-a", {
        requestKey: "review-pack-2",
        documentId: "document-a",
        expectedVersion: 1,
        type: "TECH_PACK",
        payload: {
          ...pack,
          status: "PUBLISHED",
          reviewConfirmed: true,
          constructionNotes: "偷偷更换工艺",
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.database.studioDocument.create).not.toHaveBeenCalled();
  });
  const sample = {
    name: "第一轮样衣",
    techPackRevisionId: "pack-rev-1",
    round: 1,
    photoAssetIds: ["asset-a"],
    notes: "",
    issues: [
      {
        id: "issue-1",
        assetId: "asset-a",
        x: 0.2,
        y: 0.3,
        category: "FIT",
        text: "领口偏大",
        status: "VERIFIED",
        resolution: "已对照测量复核",
      },
      {
        id: "issue-2",
        assetId: "asset-a",
        x: 0.4,
        y: 0.5,
        category: "TRIM",
        text: "扣子偏色",
        status: "OPEN",
        resolution: "",
      },
    ],
  };
  it("lets editors update another problem while retaining verified evidence", async () => {
    const f = setup("EDITOR", "SAMPLE_ROUND", sample);
    const result = await f.service.saveDocument("editor-a", "project-a", {
      requestKey: "sample-update-1",
      documentId: "document-a",
      expectedVersion: 1,
      type: "SAMPLE_ROUND",
      payload: {
        ...sample,
        issues: sample.issues.map((issue) =>
          issue.id === "issue-2"
            ? { ...issue, status: "FIXED", resolution: "更换指定扣子" }
            : issue,
        ),
      },
    });
    expect(result.version).toBe(2);
    expect(
      f.access.require.mock.calls.some((call) => call[2] === "review"),
    ).toBe(false);
  });
  it("does not let editors remove or rewrite verified evidence", async () => {
    const f = setup("EDITOR", "SAMPLE_ROUND", sample);
    await expect(
      f.service.saveDocument("editor-a", "project-a", {
        requestKey: "sample-update-2",
        documentId: "document-a",
        expectedVersion: 1,
        type: "SAMPLE_ROUND",
        payload: {
          ...sample,
          issues: sample.issues.filter((issue) => issue.id !== "issue-1"),
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("allows a reviewer to verify a fixed problem while freezing other fields", async () => {
    const fixed = {
      ...sample,
      issues: sample.issues.map((issue) =>
        issue.id === "issue-2"
          ? { ...issue, status: "FIXED", resolution: "已更换扣子" }
          : issue,
      ),
    };
    const f = setup("REVIEWER", "SAMPLE_ROUND", fixed);
    const result = await f.service.saveDocument("reviewer-a", "project-a", {
      requestKey: "sample-verify-1",
      documentId: "document-a",
      expectedVersion: 1,
      type: "SAMPLE_ROUND",
      payload: {
        ...fixed,
        issues: fixed.issues.map((issue) => ({ ...issue, status: "VERIFIED" })),
      },
    });
    expect(result.version).toBe(2);
  });
});
