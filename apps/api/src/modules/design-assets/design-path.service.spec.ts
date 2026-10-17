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

function workflowHarness(options: { missingVersion?: boolean; missingAttempt?: boolean; missingProducer?: boolean } = {}) {
  const current = asset("current", { generationTaskId: "task-current" });
  const sibling = asset("sibling", { generationTaskId: "task-sibling" });
  const { database } = harness([current, sibling]);
  const binding = { sourceNodeId: "brief", sourceNodeVersionId: "brief-v1", sourcePort: "out", targetPort: "goal" };
  const versions: {
    id: string; nodeId: string; projectId: string; kind: string; type: string; title: string; version: number; graphRevision: number;
    baseline: boolean; origin?: string; payload: Record<string, unknown>;
    inputBindings: { sourceNodeId: string; sourceNodeVersionId: string; sourcePort: string; targetPort: string }[]; createdAt: Date;
  }[] = [
    { id: "candidate-v1", nodeId: "candidate", projectId: "project-a", kind: "asset", type: "candidate", title: "旧候选", version: 1, graphRevision: 3, baseline: false,
      payload: { assetId: "current", attemptId: "attempt-current" }, inputBindings: [{ sourceNodeId: "tool", sourceNodeVersionId: "tool-v1", sourcePort: "out", targetPort: "source" }], createdAt },
    { id: "tool-v1", nodeId: "tool", projectId: "project-a", kind: "tool", type: "generate_design", title: "原始生成", version: 1, graphRevision: 2, baseline: options.missingAttempt ?? false, origin: "proposal",
      payload: { params: { prompt: "旧卡片描述", count: 2 } }, inputBindings: [binding], createdAt },
    { id: "brief-v1", nodeId: "brief", projectId: "project-a", kind: "asset", type: "brief", title: "原始要求", version: 1, graphRevision: 1, baseline: false,
      payload: { text: "保留藏蓝色" }, inputBindings: [], createdAt },
  ];
  const snapshot = { params: { prompt: "保留廓形", count: 2, width: 1024 }, toolVersion: "1", graphRevision: 2,
    inputSnapshot: [{ id: "brief", nodeVersionId: "brief-v1", type: "brief", title: "原始要求", payload: { text: "保留藏蓝色" } }], inputBindings: [binding],
    request: { prompt: "保留廓形\n保留藏蓝色", width: 1024, referenceImageUrl: "https://private.test/image?token=secret" } };
  const attempts = ["current", "sibling"].map((name, index) => ({ id: `attempt-${name}`, projectId: "project-a", toolNodeId: "tool", nodeVersionId: "tool-v1",
    executionId: "execution-original", generationTaskId: `task-${name}`, ordinal: index + 1, status: "completed", requestSnapshot: snapshot, createdAt }));
  const workflowNode = { findFirst: vi.fn(async () => ({ id: "candidate", payload: { assetId: "current" } })), findMany: vi.fn(async () => [
    { id: "tool", kind: "tool", type: "generate_design", title: "当前卡片", payload: { params: { prompt: "当前已改成银色", width: 2048 } }, status: "completed", createdAt },
    { id: "candidate", kind: "asset", type: "candidate", title: "当前候选", payload: { assetId: "current" }, createdAt },
  ]) };
  const workflowEdge = { findMany: vi.fn(async () => [{ sourceNodeId: "tool", targetNodeId: "candidate", targetPort: "source" }]) };
  const workflowNodeVersion = { findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    if (where.id) return options.missingVersion && where.id === "brief-v1" || options.missingProducer && where.id === "tool-v1" ? null : versions.find((version) => version.id === where.id) ?? null;
    return versions[0];
  }) };
  const workflowAttempt = { findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => options.missingAttempt ? [] : attempts.filter((attempt) =>
    ["id", "executionId", "nodeVersionId", "generationTaskId"].every((key) => {
      const expected = where[key];
      return !expected || (typeof expected === "object" ? (expected as { in: string[] }).in.includes(attempt[key as keyof typeof attempt] as string) : attempt[key as keyof typeof attempt] === expected);
    }))) };
  const workflowExecution = { findFirst: vi.fn(async () => ({ id: "execution-original", projectId: "project-a", conversationId: "original-conversation", status: "completed" })) };
  const extended = { ...database, workflowNode, workflowEdge, workflowNodeVersion, workflowAttempt, workflowExecution,
    designAsset: { ...database.designAsset, findMany: vi.fn(async () => [current, sibling]) } };
  return { service: new DesignAssetsService(extended as never, {} as never), database: extended, snapshot, versions, attempts };
}

describe("Frozen workflow provenance", () => {
  it("uses the producing version and frozen request after current canvas inputs and parameters change", async () => {
    const { service, database } = workflowHarness();
    const path = await service.path("user-a", "current");
    expect(path.steps.find((item) => item.tool === "generate_design")).toMatchObject({
      actor: "agent", snapshotAvailable: true, conversationId: "original-conversation",
      parameters: { prompt: "保留廓形\n保留藏蓝色", count: 2, width: 1024 },
      sources: [{ elementId: "brief", title: "原始要求", role: "goal", text: "保留藏蓝色" }],
    });
    expect(JSON.stringify(path)).not.toContain("当前已改成银色");
    expect(JSON.stringify(path)).not.toContain("private.test");
    expect(database.workflowNode.findMany).not.toHaveBeenCalled();
    expect(database.workflowEdge.findMany).not.toHaveBeenCalled();
    expect(path.incomplete).toBe(false);
  });

  it("groups sibling candidates by their actual execution and originating conversation", async () => {
    const { service, database } = workflowHarness();
    const path = await service.path("user-a", "current");
    expect(path.steps).toHaveLength(1);
    expect(path.steps[0]?.outputs.map((output) => output.id)).toEqual(["current", "sibling"]);
    expect(database.workflowAttempt.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ projectId: "project-a", executionId: "execution-original" }),
    }));
  });

  it("marks missing immutable ancestors instead of substituting the current canvas", async () => {
    const { service, database } = workflowHarness({ missingVersion: true });
    const path = await service.path("user-a", "current");
    expect(path.incomplete).toBe(true);
    expect(path.steps[0]?.sources[0]?.text).toBe("保留藏蓝色");
    expect(database.workflowNode.findMany).not.toHaveBeenCalled();
  });

  it("does not claim a complete execution snapshot when only baseline node history remains", async () => {
    const { service } = workflowHarness({ missingAttempt: true });
    const path = await service.path("user-a", "current");
    expect(path.incomplete).toBe(true);
    expect(path.steps[0]?.snapshotAvailable).toBe(false);
  });

  it("retains known missing workflow provenance while falling back to legacy asset history", async () => {
    const { service } = workflowHarness({ missingProducer: true });
    const path = await service.path("user-a", "current");
    expect(path.incomplete).toBe(true);
    expect(path.steps[0]?.outputs[0]?.id).toBe("current");
    expect(path.steps[0]?.snapshotAvailable).toBe(false);
  });

  it("does not label an empty input snapshot complete when immutable bindings require a source", async () => {
    const { service, snapshot } = workflowHarness();
    snapshot.inputSnapshot = [];
    const path = await service.path("user-a", "current");
    expect(path.incomplete).toBe(true);
    expect(path.steps[0]).toMatchObject({ snapshotAvailable: false, sources: [{ text: "保留藏蓝色", role: "goal" }] });
  });

  it("does not substitute a different execution when the output attempt hint conflicts with its actual task", async () => {
    const { service, versions, attempts } = workflowHarness();
    const candidate = versions[0], sibling = attempts[1];
    if (!candidate || !sibling) throw new Error("fixture missing");
    candidate.payload = { assetId: "current", attemptId: "attempt-sibling" };
    sibling.executionId = "another-execution";
    const path = await service.path("user-a", "current");
    expect(path.incomplete).toBe(true);
    expect(path.steps[0]?.snapshotAvailable).toBe(false);
    expect(JSON.stringify(path)).not.toContain("another-execution");
  });

  it("orders analysis before generation through text-only immutable nodes with identical timestamps", async () => {
    const { service, versions, attempts, snapshot } = workflowHarness();
    const constraint = versions[2];
    const tool = versions[1];
    const original = attempts[0];
    if (!constraint || !tool || !original) throw new Error("fixture missing");
    constraint.type = "constraint";
    constraint.payload = { text: "保留藏蓝色", attemptId: "analysis-attempt" };
    constraint.inputBindings = [{ sourceNodeId: "analyzer", sourceNodeVersionId: "analyzer-v1", sourcePort: "out", targetPort: "source" }];
    versions.push({ ...tool, id: "analyzer-v1", nodeId: "analyzer", type: "analyze_brief", title: "分析需求", graphRevision: 0, inputBindings: [] });
    attempts.push({ ...original, id: "analysis-attempt", toolNodeId: "analyzer", nodeVersionId: "analyzer-v1", executionId: "z-analysis",
      generationTaskId: "", requestSnapshot: { ...snapshot, inputSnapshot: [], inputBindings: [], request: { ...snapshot.request, prompt: "分析需求" } } });
    const path = await service.path("user-a", "current");
    expect(path.steps.map((step) => step.tool)).toEqual(["analyze_brief", "generate_design"]);
    expect(path.incomplete).toBe(false);
  });

  it("shares the asset and step budget across multiple legacy source branches", async () => {
    const { service, database, versions, snapshot } = workflowHarness();
    const template = versions[0];
    const tool = versions[1];
    if (!template || !tool) throw new Error("fixture missing");
    const records = ["a", "b"].flatMap((branch) => Array.from({ length: 90 }, (_, index) =>
      asset(`${branch}-${index}`, { parentAssetId: index < 89 ? `${branch}-${index + 1}` : null })));
    database.designAsset.findFirst.mockImplementation(async ({ where }) => records.find((record) => record.id === where.id && record.projectId === where.projectId) ?? null);
    for (const branch of ["a", "b"]) {
      const nodeId = `ref-${branch}`, versionId = `${nodeId}-v1`;
      versions.push({ ...template, id: versionId, nodeId, type: "reference_image", payload: { assetId: `${branch}-0`, attemptId: "" }, inputBindings: [] });
      const binding = { sourceNodeId: nodeId, sourceNodeVersionId: versionId, sourcePort: "out", targetPort: "reference" };
      tool.inputBindings.push(binding);
      snapshot.inputBindings.push(binding);
      const payload = { text: "原始参考", assetId: `${branch}-0` };
      snapshot.inputSnapshot.push({ id: nodeId, nodeVersionId: versionId, type: "reference_image", title: "参考", payload });
    }
    const path = await service.path("user-a", "current");
    expect(path.incomplete).toBe(true);
    expect(path.steps.length).toBeLessThanOrEqual(100);
    expect(database.designAsset.findFirst.mock.calls.length).toBeLessThanOrEqual(100);
  });
});

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
        agentRunAttempt: {
          step: { run: { conversationId: "conversation-plan" } },
        },
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
      conversationId: "conversation-plan",
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
