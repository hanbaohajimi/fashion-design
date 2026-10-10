import { DesignAssetOperation, Prisma } from "@fashion/db";
import { describe, expect, it, vi } from "vitest";
import { DesignAssetsService } from "./design-assets.service";

const createdAt = new Date("2026-10-10T01:00:00Z");
function asset(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    projectId: "project-a",
    rootAssetId: "root",
    parentAssetId: null,
    restoredFromAssetId: null,
    generationTaskId: null,
    sourceFileId: null,
    operation: DesignAssetOperation.GENERATED,
    url: `https://example.test/${id}.png`,
    thumbnailUrl: null,
    width: 1024,
    height: 1024,
    seed: null,
    archivedAt: null,
    createdAt,
    project: { workspace: { ownerId: "user-a" } },
    designStep: null,
    generationTask: null,
    decisions: [],
    ...overrides,
  };
}
function harness(records: ReturnType<typeof asset>[]) {
  const database = {
    designAsset: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          records.find((item) => item.id === where.id) ?? null,
      ),
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; projectId: string } }) =>
          records.find(
            (item) =>
              item.id === where.id && item.projectId === where.projectId,
          ) ?? null,
      ),
    },
    designAssetDecision: {
      findUniqueOrThrow: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  return {
    database,
    service: new DesignAssetsService(database as never, {} as never),
  };
}

describe("Design asset provenance", () => {
  it("replays a concurrent duplicate after a database unique constraint conflict", async () => {
    const { service, database } = harness([asset("current")]);
    database.designAssetDecision.upsert.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "7.9.1",
      }),
    );
    database.designAssetDecision.findUniqueOrThrow.mockResolvedValue({
      id: "decision-existing",
      assetId: "current",
      userId: "user-a",
      kind: "selected",
      reason: "保留",
      createdAt,
    });
    await expect(
      service.decide("user-a", "current", {
        kind: "selected",
        reason: "保留",
        clientRequestId: "same-request",
      }),
    ).resolves.toMatchObject({ id: "decision-existing" });
    expect(database.designAssetDecision.findUniqueOrThrow).toHaveBeenCalledWith(
      {
        where: {
          assetId_clientRequestId: {
            assetId: "current",
            clientRequestId: "same-request",
          },
        },
      },
    );
  });
  it("uses frozen multi-source inputs and includes both source branches", async () => {
    const snapshot = {
      version: 1,
      sources: [
        {
          elementId: "ref-1",
          assetId: "reference",
          title: "原参考衣",
          role: "garment_ref",
        },
        {
          elementId: "note-1",
          title: "设计便签",
          role: "note",
          text: "保留宽松袖型",
        },
      ],
      constraints: {
        palette: ["#112233"],
        notes: ["保留宽松袖型"],
        avoidLabels: [],
        fabricTerms: [],
      },
      parameters: { prompt: "修改袖口", width: 1024, height: 1024 },
    };
    const current = asset("current", {
      parentAssetId: "root",
      generationTaskId: "task-a",
      generationTask: {
        id: "task-a",
        status: "SUCCEEDED",
        generatedAssets: [],
        designStep: {
          id: "step-a",
          tool: "i2i",
          actor: "agent",
          intent: "修改袖口",
          inputSnapshot: snapshot,
          createdAt,
        },
      },
    });
    const { service, database } = harness([
      asset("root"),
      asset("reference"),
      current,
    ]);
    const path = await service.path("user-a", "current");
    expect(path.steps.map((step) => step.outputs[0]?.id)).toEqual(
      expect.arrayContaining(["root", "reference", "current"]),
    );
    expect(path.steps.find((step) => step.id === "step-a")).toMatchObject({
      actor: "agent",
      snapshotAvailable: true,
      sources: snapshot.sources,
      constraints: snapshot.constraints,
    });
    expect(database.designAsset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "reference", projectId: "project-a" },
      }),
    );
  });

  it("does not follow a forged reference into another project", async () => {
    const current = asset("current", { parentAssetId: "outside" });
    const { service } = harness([
      current,
      asset("outside", { projectId: "other-project" }),
    ]);
    const path = await service.path("user-a", "current");
    expect(path.steps).toHaveLength(1);
    expect(path.incomplete).toBe(true);
  });

  it("orders dependencies before outputs even when timestamps are identical", async () => {
    const { service } = harness([
      asset("a-child", { parentAssetId: "z-parent" }),
      asset("z-parent"),
    ]);
    const path = await service.path("user-a", "a-child");
    expect(path.steps.map((step) => step.outputs[0]?.id)).toEqual([
      "z-parent",
      "a-child",
    ]);
    expect(path.steps.every((step) => !step.snapshotAvailable)).toBe(true);
  });

  it("stops cyclic legacy paths and flags incomplete provenance", async () => {
    const { service } = harness([
      asset("a", { parentAssetId: "b" }),
      asset("b", { parentAssetId: "a" }),
    ]);
    const path = await service.path("user-a", "a");
    expect(path.steps).toHaveLength(2);
    expect(path.incomplete).toBe(true);
  });

  it("bounds very long provenance paths", async () => {
    const records = Array.from({ length: 102 }, (_, index) =>
      asset(`asset-${index}`, {
        parentAssetId: index < 101 ? `asset-${index + 1}` : null,
      }),
    );
    const { service, database } = harness(records);
    const path = await service.path("user-a", "asset-0");
    expect(path.steps).toHaveLength(100);
    expect(database.designAsset.findFirst).toHaveBeenCalledTimes(100);
    expect(path.incomplete).toBe(true);
  });

  it("does not expose assets in a deleted project", async () => {
    const { service } = harness([
      asset("current", {
        project: { deletedAt: createdAt, workspace: { ownerId: "user-a" } },
      }),
    ]);
    await expect(service.path("user-a", "current")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("rejects reusing a decision request for a different choice", async () => {
    const { service, database } = harness([asset("current")]);
    database.designAssetDecision.upsert.mockResolvedValue({
      id: "decision-a",
      userId: "user-a",
      assetId: "current",
      kind: "selected",
      reason: "",
      createdAt,
    });
    await expect(
      service.decide("user-a", "current", {
        kind: "rejected",
        reason: "",
        clientRequestId: "decision-a",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects reading provenance or recording decisions for another owner", async () => {
    const { service, database } = harness([asset("current")]);
    await expect(service.path("outsider", "current")).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      service.decide("outsider", "current", {
        kind: "selected",
        reason: "面料表现更好",
        clientRequestId: "decision-a",
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(database.designAssetDecision.upsert).not.toHaveBeenCalled();
  });

  it("persists an explicit decision idempotently without changing placement disposition", async () => {
    const { service, database } = harness([asset("current")]);
    database.designAssetDecision.upsert.mockResolvedValue({
      id: "decision-a",
      userId: "user-a",
      assetId: "current",
      kind: "selected",
      reason: "面料表现更好",
      createdAt,
    });
    const result = await service.decide("user-a", "current", {
      kind: "selected",
      reason: "面料表现更好",
      clientRequestId: "decision-a",
    });
    expect(result.kind).toBe("selected");
    expect(database.designAssetDecision.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assetId_clientRequestId: {
            assetId: "current",
            clientRequestId: "decision-a",
          },
        },
        update: {},
        create: expect.objectContaining({
          assetId: "current",
          userId: "user-a",
          kind: "selected",
        }),
      }),
    );
  });
});
