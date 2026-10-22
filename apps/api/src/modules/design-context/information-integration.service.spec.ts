import type { PrismaClient } from "@fashion/db";
import { describe, expect, it, vi } from "vitest";
import type { DesignContextService } from "./design-context.service";
import { InformationIntegrationService } from "./information-integration.service";
import { projectVersionEpisodes, type NodeVersionFact } from "./information-integration.projector";

function fixture() {
  const graph = { projectId: "project", revision: 2, nodes: [{ id: "tool-a" }, { id: "missing-history" }], edges: [] };
  const context = { projectId: "project", initialObjective: "通勤外套", currentObjective: "轻量通勤外套", objectiveOrigin: "explicit", currentTask: "检查袖口", focusNodeIds: ["tool-a"], referencedNodeIds: [], requirements: [], preferences: [], scopedMemory: [], ambiguities: [], nodes: [], edges: [], trajectory: {}, attempts: [], decisions: [], dialog: [], dialogSummary: { semanticMemory: { rejectedUnderstandings: [] } }, coverage: {} };
  const built = { graph, context } as unknown as Awaited<ReturnType<DesignContextService["build"]>>;
  const versions: NodeVersionFact[] = [{ id: "v1", projectId: "project", nodeId: "tool-a", version: 1, graphRevision: 1, kind: "tool", type: "generate", title: "方案", payload: { params: { prompt: "灰色" }, url: "https://private.example/secret" }, inputBindings: [], previousVersionId: null, origin: "baseline", baseline: true, createdAt: new Date(1) }, { id: "v2", projectId: "project", nodeId: "tool-a", version: 2, graphRevision: 2, kind: "tool", type: "generate", title: "方案", payload: { params: { prompt: "银色" } }, inputBindings: [], previousVersionId: "v1", origin: "user", baseline: false, createdAt: new Date(2) }];
  const database = {
    project: { findUnique: vi.fn().mockResolvedValue({ id: "project", archived: false, deletedAt: null, workspace: { ownerId: "user" } }), findFirst: vi.fn(async () => ({ id: "project" })) }, agentConversation: { findFirst: vi.fn(async () => ({ id: "conversation" })) },
    workflowNodeVersion: { findMany: vi.fn<(query?: unknown) => Promise<NodeVersionFact[]>>().mockResolvedValue(versions), count: vi.fn(async () => 2) },
    workflowMutation: { findMany: vi.fn(async () => [{ id: "m1", mutationId: "mutation", origin: "user", baseRevision: 1, resultRevision: 2, beforeSnapshot: { nodes: [{ id: "tool-a" }], edges: [] }, afterSnapshot: { nodes: [{ id: "tool-a" }], edges: [] }, createdAt: new Date(2) }]), count: vi.fn(async () => 1) },
    workflowProposal: { findMany: vi.fn(async () => [{ id: "p1", status: "rejected", rejectionReason: null, actionFingerprint: "action-1", createdAt: new Date(1), updatedAt: new Date(2) }]) },
    workflowExecution: { findMany: vi.fn(async () => [{ id: "e1", toolNodeId: "tool-a", nodeVersionId: "v2", conversationId: "conversation", status: "failed", expectedAttempts: 2, requestSnapshot: { privateUrl: "https://private.example" }, completedAt: new Date(3), createdAt: new Date(2) }]) },
    projectDesignContextRevision: { findMany: vi.fn(async () => [{ revision: 1, state: { currentObjective: "轻量通勤外套", objectiveSourceQuote: "轻量化" }, sourceMessageId: "u1", createdAt: new Date(2) }]) },
  };
  const contexts = { build: vi.fn(async () => built) };
  return { built, database, contexts, versions, service: new InformationIntegrationService(database as unknown as PrismaClient, contexts as unknown as DesignContextService) };
}

describe("InformationIntegrationService", () => {
  it("六类上下文保留项目目标、独立当前步骤、版本事实及最新人工决定", async () => {
    const { service, built, contexts } = fixture();
    const result = await service.integrate("user", "project", { built, conversationId: "conversation", currentStep: { currentStepGoal: "调整袖口" }, tools: [{ key: "edit_design" }] });
    expect(contexts.build).not.toHaveBeenCalled();
    expect(Object.keys(result.slots)).toEqual(["initialGoal", "currentStepGoal", "designTrajectory", "dialogue", "implicitIntent", "toolInformation"]);
    expect(result.slots.initialGoal).toMatchObject({ currentObjective: "轻量通勤外套" });
    expect(result.slots.currentStepGoal).toMatchObject({ currentTask: "检查袖口", plan: { currentStepGoal: "调整袖口" } });
    expect(result.context.versionHistory).toContainEqual(expect.objectContaining({ nodeVersionId: "v2", previousVersionId: "v1", changes: [expect.objectContaining({ beforeVersionId: "v1" })] }));
    expect(result.slots.dialogue.proposalDecisions).toMatchObject([{ status: "rejected", rejectionReason: null, preferenceEvidence: false }]);
    expect(result.context.executions).toMatchObject([{ classification: "technical_outcome" }]);
    expect(result.coverage.versionHistory.missingHistoryNodeIds).toEqual(["missing-history"]);
    expect(result.coverage.visual).toMatchObject({ status: "not_loaded" });
    expect(JSON.stringify(result)).not.toContain("private.example");
  });

  it("即使传入旧快照也验证项目和会话归属", async () => {
    const { service, built, database } = fixture();
    database.agentConversation.findFirst.mockResolvedValueOnce(null as unknown as { id: string });
    await expect(service.integrate("user", "project", { built, conversationId: "foreign" })).rejects.toThrow("会话不存在");
    database.project.findUnique.mockResolvedValueOnce(null as unknown as { id: string });
    await expect(service.integrate("user", "project", { built })).rejects.toThrow("项目不存在");
    expect(database.workflowNodeVersion.findMany).not.toHaveBeenCalled();
  });

  it("历史详情预算优先保留最近修改，不能因为按时间正序打包而只留下旧版本", async () => {
    const { service, built, database, versions } = fixture();
    const sample = versions[0];
    if (!sample) throw new Error("Missing fixture version");
    const history = Array.from({ length: 60 }, (_, index) => ({ ...sample, id: `history-${index + 1}`, nodeId: `node-${index + 1}`, version: 1, graphRevision: index + 1, createdAt: new Date(index + 1), payload: { params: { prompt: `第${index + 1}次修改${"详情".repeat(1800)}` } } }));
    database.workflowNodeVersion.findMany.mockResolvedValue(history.slice().reverse());
    database.workflowNodeVersion.count.mockResolvedValue(60);
    const result = await service.integrate("user", "project", { built: { graph: { ...built.graph, revision: 60 }, context: { ...built.context, focusNodeIds: [] } } });
    expect(result.context.versionHistory.some((episode) => episode.nodeVersionId === "history-60")).toBe(true);
    expect(result.context.versionHistory.some((episode) => episode.nodeVersionId === "history-1")).toBe(false);
    expect(result.coverage.versionHistory.omitted).toBe(60 - result.context.versionHistory.length);
  });

  it("旧焦点节点的当前版本在近期200条之外也会单独读取，预算中优先保留焦点与最新变更", async () => {
    const { service, built, database, versions } = fixture();
    const sample = versions[0];
    if (!sample) throw new Error("Missing fixture version");
    const oldFocus = { ...sample, id: "focused-old", nodeId: "tool-a", graphRevision: 1, payload: { params: { prompt: "焦点分支真实旧修改" } } };
    const recent = Array.from({ length: 201 }, (_, index) => ({ ...sample, id: `recent-${index}`, nodeId: `other-${index}`, graphRevision: 1000 - index, createdAt: new Date(1000 - index), payload: { params: { prompt: "近期其他分支详情".repeat(350) } } }));
    database.workflowNodeVersion.findMany.mockImplementation(async (query) => {
      const options = query as { distinct?: string[]; select?: unknown; where?: { nodeId?: unknown } };
      if (options.distinct && options.select) return [oldFocus, ...recent];
      if (options.where?.nodeId) return [oldFocus];
      return recent;
    });
    database.workflowNodeVersion.count.mockResolvedValue(202);
    const result = await service.integrate("user", "project", { built: { ...built, graph: { ...built.graph, revision: 1000 } } });
    expect(result.context.versionHistory.some((episode) => episode.nodeVersionId === "focused-old")).toBe(true);
    expect(result.context.versionHistory.some((episode) => episode.nodeVersionId === "recent-0")).toBe(true);
    expect(database.workflowNodeVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ nodeId: { in: ["tool-a"] } }) }));
  });

  it("超大最新版本保留带明确缺失标记的版本元数据，不能让小旧版本取代整个新版本", async () => {
    const { service, built, database, versions } = fixture();
    const sample = versions[0];
    if (!sample) throw new Error("Missing fixture version");
    const huge = { ...sample, id: "huge-latest", nodeId: "tool-a", version: 2, graphRevision: 2, previousVersionId: "v1", baseline: false, origin: "user", createdAt: new Date(2), inputBindings: Array.from({ length: 32 }, (_, i) => ({ sourceNodeId: `input-${i}-${"n".repeat(110)}`, sourceNodeVersionId: `version-${i}-${"v".repeat(110)}`, sourcePort: "p".repeat(80), targetPort: "t".repeat(80) })), payload: { params: { prompt: "新要求".repeat(1300), negativePrompt: "避免内容".repeat(1000), referenceInputs: Array.from({ length: 16 }, (_, i) => ({ nodeId: `reference-${i}-${"r".repeat(110)}`, role: "detail_ref", weight: 0.7 })) } } };
    database.workflowNodeVersion.findMany.mockResolvedValue([huge, sample]);
    const result = await service.integrate("user", "project", { built });
    const latest = result.context.versionHistory.find((episode) => episode.nodeVersionId === "huge-latest");
    expect(latest).toMatchObject({ detailsIncluded: false, hasSemanticChange: true });
    expect(result.coverage.versionHistory.metadataOnlyVersions).toBeGreaterThan(0);
    expect(JSON.stringify(result.context.versionHistory).length).toBeLessThanOrEqual(48_000);
  });

  it("窗口中未加载到执行或决定时保留未知语义，并区分版本确实缺失与详情被预算省略", async () => {
    const { service, built } = fixture();
    const result = await service.integrate("user", "project", { built });
    const episode = result.context.versionHistory.find((item) => item.nodeVersionId === "v2");
    expect(episode).toMatchObject({ historyCoverage: { absenceClaimAllowed: false, attempts: { included: 0, complete: false }, decisions: { included: 0, complete: false } } });
    expect(result.coverage.versionHistory.missingHistoryNodeIds).toEqual(["missing-history"]);
    expect(result.coverage.versionHistory.omittedVersionIds).toEqual([]);
  });

  it("直接版本编号与冻结快照冲突的尝试不能同时归入两个历史版本", () => {
    const { versions } = fixture();
    const episodes = projectVersionEpisodes(versions, [{ id: "conflicting-attempt", toolNodeId: "tool-a", status: "completed", nodeVersionId: "v2", requestSnapshot: { nodeVersionId: "v1" } }], []);
    expect(episodes.flatMap((episode) => episode.attempts)).toEqual([]);
    expect(episodes.every((episode) => episode.historyCoverage.attempts.conflictingLoaded === 1)).toBe(true);
  });

  it("未记录版本归属的旧尝试与缺失输入记录保持未知，不被描述为未执行或无输入", () => {
    const { versions } = fixture();
    const episodes = projectVersionEpisodes(versions.map((version) => ({ ...version, inputBindings: null })), [{ id: "legacy-attempt", toolNodeId: "tool-a", status: "completed" }], []);
    expect(episodes.every((episode) => episode.attempts.length === 0 && episode.historyCoverage.attempts.unversionedLoaded === 1)).toBe(true);
    expect(episodes.every((episode) => episode.historyCoverage.absenceClaimAllowed === false && episode.historyCoverage.inputs.total === null)).toBe(true);
    expect(episodes.every((episode) => episode.description.includes("输入记录未提供"))).toBe(true);
    const second = versions[1];
    if (!second) throw new Error("Missing fixture version");
    const known = projectVersionEpisodes(versions, [{ id: "known-attempt", toolNodeId: "tool-a", status: "completed", nodeVersionId: second.id }], []);
    expect(known.flatMap((episode) => episode.attempts)).toEqual([{ id: "known-attempt", status: "completed" }]);
  });
});
