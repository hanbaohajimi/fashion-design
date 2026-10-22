import type { AmuxClaudeJsonClient } from "@fashion/ai";
import type { PrismaClient } from "@fashion/db";
import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { emptyProjectDesignContext } from "./design-context.schemas";
import type { DesignContextService } from "./design-context.service";
import { HiddenIntentMiner } from "./hidden-intent-miner.service";

const version = (id: string, number: number, prompt: string, nodeId = "tool-a", previousVersionId: string | null = number === 1 ? null : `v${number - 1}`, origin = "user") => ({ id, nodeId, projectId: "project", version: number, graphRevision: number, kind: "tool", type: "generate", title: "方案", payload: { params: { prompt } }, inputBindings: [], previousVersionId, origin, baseline: number === 1, createdAt: new Date(number * 1000) });
function fixture() {
  const versions = [version("v1", 1, "灰色外套"), version("v2", 2, "银色窄袖口"), version("v3", 3, "银色细袖口")];
  const state = emptyProjectDesignContext();
  const contexts = {
    build: vi.fn(async () => ({ graph: { projectId: "project", revision: 3, nodes: [{ id: "tool-a" }, { id: "tool-b" }], edges: [] } })),
    get: vi.fn(async () => ({ revision: 0, state })),
    patch: vi.fn(async () => ({})), patchInTransaction: vi.fn(async () => ({})),
  };
  const database = {
    project: { findUnique: vi.fn().mockResolvedValue({ id: "project", archived: false, deletedAt: null, workspace: { ownerId: "user" } }), findFirst: vi.fn(async () => ({ id: "project" })) },
    workflowGraph: { findUnique: vi.fn(async () => ({ revision: 3 })), updateMany: vi.fn(async () => ({ count: 1 })) },
    workflowNodeVersion: { findMany: vi.fn(async () => versions) },
    workflowExecution: { findFirst: vi.fn(async () => ({ status: "succeeded", toolNodeId: "tool-a", nodeVersionId: "v3" as string | null })) },
    workflowOutbox: { findFirst: vi.fn(async () => ({ eventType: "workflow.semantic_changed", payload: { origin: "user" } })) },
    agentConversation: { findMany: vi.fn(async () => [{ id: "conversation", intentEpoch: 1 }]), updateMany: vi.fn(async () => ({ count: 1 })) },
    agentTurn: { findFirst: vi.fn(async (): Promise<{ id: string } | null> => null) },
    $transaction: async <T>(run: (transaction: unknown) => Promise<T>): Promise<T> => run(database),
  };
  const model = { generateJson: vi.fn(async () => ({ preferences: [{ text: "该分支偏好银色", evidence: [{ versionId: "v2", quote: "银色窄袖口" }, { versionId: "v3", quote: "银色细袖口" }] }] })) };
  return { versions, state, contexts, database, model, service: new HiddenIntentMiner(database as unknown as PrismaClient, contexts as unknown as DesignContextService, model as unknown as AmuxClaudeJsonClient) };
}

describe("HiddenIntentMiner", () => {
  it("独立挖掘至少两次真实参数变化，持久保存分支偏好和版本依据", async () => {
    const { service, contexts, model } = fixture();
    const result = await service.processChanges("user", "project", { eventId: "semantic-event" });
    expect(result.status).toBe("created");
    expect(result.evidenceVersionIds).toEqual(["v2", "v3"]);
    expect(contexts.patchInTransaction).toHaveBeenCalledWith("user", "project", expect.objectContaining({ baseRevision: 0, mutationId: expect.stringMatching(/^hidden-intent:/u), operations: [expect.objectContaining({ type: "upsert_item", item: expect.objectContaining({ origin: "inferred", priority: "prefer", scope: "branch", branchNodeIds: ["tool-a"], sourceVersionIds: ["v2", "v3"], sourceQuote: "银色细袖口" }) })] }), expect.any(Object), expect.any(Object));
    expect(model.generateJson).toHaveBeenCalledTimes(1);
  });

  it("失败、取消、审核失败不形成审美偏好，也不调用模型", async () => {
    for (const status of ["failed", "canceled", "moderation_failed", "running"]) {
      const { service, database, model, contexts } = fixture();
      database.workflowExecution.findFirst.mockResolvedValue({ status, toolNodeId: "tool-a", nodeVersionId: "v3" });
      expect((await service.processChanges("user", "project", { executionId: "execution" })).status).toBe("skipped");
      expect(model.generateJson).not.toHaveBeenCalled();
      expect(contexts.patchInTransaction).not.toHaveBeenCalled();
    }
  });

  it("版本引用不能伪造，兄弟分支不能混合成同一条偏好", async () => {
    const { service, versions, contexts, model } = fixture();
    model.generateJson.mockResolvedValueOnce({ preferences: [{ text: "伪造推断", evidence: [{ versionId: "v2", quote: "红色" }, { versionId: "v3", quote: "银色细袖口" }] }] });
    expect((await service.processChanges("user", "project")).status).toBe("skipped");
    versions.splice(0, versions.length, version("a1", 1, "灰色", "tool-a"), version("a2", 2, "银色", "tool-a", "a1"), version("b1", 1, "灰色", "tool-b"), version("b2", 2, "银色", "tool-b", "b1"));
    model.generateJson.mockResolvedValueOnce({ preferences: [{ text: "跨分支银色", evidence: [{ versionId: "a2", quote: "银色" }, { versionId: "b2", quote: "银色" }] }] });
    expect((await service.processChanges("user", "project")).status).toBe("skipped");
    expect(contexts.patchInTransaction).not.toHaveBeenCalled();
  });

  it("停用偏好即使换句话也不能沿用相同证据复活", async () => {
    const { service, state, contexts } = fixture();
    state.preferences.push({ id: "old-preference", kind: "preference", text: "已停用的银色推断", origin: "inferred", priority: "prefer", status: "inactive", scope: "branch", branchNodeIds: ["tool-a"], sourceMessageId: null, sourceNodeIds: ["tool-a"], sourceVersionIds: ["v2", "v3"], sourceQuote: "银色细袖口" });
    expect((await service.processChanges("user", "project")).status).toBe("skipped");
    expect(contexts.patchInTransaction).not.toHaveBeenCalled();
  });

  it("只改布局、状态或系统填充不足以挖掘；并发更正通过CAS拒绝后台结果", async () => {
    const { service, versions, model, contexts } = fixture();
    const second = versions[1];
    if (!second) throw new Error("fixture version missing");
    second.origin = "system";
    expect((await service.processChanges("user", "project")).status).toBe("skipped");
    expect(model.generateJson).not.toHaveBeenCalled();
    second.origin = "user";
    contexts.patchInTransaction.mockRejectedValueOnce(new ConflictException("设计上下文已变化"));
    expect((await service.processChanges("user", "project")).status).toBe("stale");
  });

  it("模型不可用或挖掘故障不向执行消费者抛错", async () => {
    const { service, model } = fixture();
    model.generateJson.mockRejectedValueOnce(new Error("model unavailable"));
    expect(await service.processChanges("user", "project")).toMatchObject({ status: "failed", createdPreferenceIds: [] });
  });

  it("挖掘期间用户发起新意图时丢弃旧后台结果", async () => {
    const { service, database, contexts } = fixture();
    database.agentConversation.findMany.mockResolvedValueOnce([{ id: "conversation", intentEpoch: 1 }]).mockResolvedValueOnce([{ id: "conversation", intentEpoch: 2 }]);
    expect(await service.processChanges("user", "project")).toMatchObject({ status: "stale", reason: "user_intent_changed_during_mining" });
    expect(contexts.patchInTransaction).not.toHaveBeenCalled();
  });

  it("正在运行的前台用户回合优先，推断提交也要求会话没有活跃回合", async () => {
    const { service, database, model, contexts } = fixture();
    database.agentTurn.findFirst.mockResolvedValueOnce({ id: "foreground-turn" });
    expect(await service.processChanges("user", "project")).toMatchObject({ status: "skipped", reason: "foreground_user_turn_has_priority" });
    expect(model.generateJson).not.toHaveBeenCalled();
    database.agentConversation.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await service.processChanges("user", "project")).status).toBe("stale");
    expect(contexts.patchInTransaction).not.toHaveBeenCalled();
  });

  it("执行后的连续派生分支仍能以两次真实跨节点变化挖掘，不扩散到兄弟节点", async () => {
    const { service, versions, model, contexts, database } = fixture();
    const original = version("v1", 1, "灰色", "tool-a");
    const firstFork = { ...version("fork-1", 1, "银色窄袖口", "tool-b", null, "proposal"), baseline: false, payload: { params: { prompt: "银色窄袖口" }, forkedFromNodeId: "tool-a", forkedFromNodeVersionId: "v1" } };
    const secondFork = { ...version("fork-2", 1, "银色细袖口", "tool-c", null, "proposal"), baseline: false, createdAt: new Date(3_000), payload: { params: { prompt: "银色细袖口" }, forkedFromNodeId: "tool-b", forkedFromNodeVersionId: "fork-1" } };
    versions.splice(0, versions.length, original, firstFork, secondFork);
    contexts.build.mockResolvedValue({ graph: { projectId: "project", revision: 3, nodes: [{ id: "tool-a" }, { id: "tool-b" }, { id: "tool-c" }], edges: [] } });
    database.workflowExecution.findFirst.mockResolvedValue({ status: "completed", toolNodeId: "tool-c", nodeVersionId: "fork-2" });
    model.generateJson.mockResolvedValue({ preferences: [{ text: "该派生分支倾向银色", evidence: [{ versionId: "fork-1", quote: "银色窄袖口" }, { versionId: "fork-2", quote: "银色细袖口" }] }] });
    expect(await service.processChanges("user", "project", { executionId: "execution" })).toMatchObject({ status: "created", evidenceVersionIds: ["fork-1", "fork-2"] });
    expect(contexts.patchInTransaction).toHaveBeenCalledWith("user", "project", expect.objectContaining({ operations: [expect.objectContaining({ item: expect.objectContaining({ branchNodeIds: ["tool-c"], sourceNodeIds: ["tool-b", "tool-c"] }) })] }), expect.any(Object), expect.any(Object));
  });

  it("从旧版本派生时不能借用母节点后来修改的证据", async () => {
    const { service, versions, model, contexts } = fixture();
    const original = version("v1", 1, "灰色", "tool-a");
    const laterParent = version("v2", 2, "银色窄袖口", "tool-a");
    const fork = { ...version("fork-1", 1, "银色细袖口", "tool-b", null, "proposal"), baseline: false, createdAt: new Date(3_000), payload: { params: { prompt: "银色细袖口" }, forkedFromNodeId: "tool-a", forkedFromNodeVersionId: "v1" } };
    versions.splice(0, versions.length, original, laterParent, fork);
    model.generateJson.mockResolvedValue({ preferences: [{ text: "该分支偏好银色", evidence: [{ versionId: "v2", quote: "银色窄袖口" }, { versionId: "fork-1", quote: "银色细袖口" }] }] });
    expect((await service.processChanges("user", "project")).status).toBe("skipped");
    expect(contexts.patchInTransaction).not.toHaveBeenCalled();
  });

  it("执行触发只读冻结版本的因果历史，缺失旧历史时不补造来源", async () => {
    const { service, database, model, contexts } = fixture();
    database.workflowExecution.findFirst.mockResolvedValueOnce({ status: "completed", toolNodeId: "tool-a", nodeVersionId: "v2" });
    expect(await service.processChanges("user", "project", { executionId: "older-execution" })).toMatchObject({ status: "skipped", reason: "two_semantic_changes_required" });
    database.workflowExecution.findFirst.mockResolvedValueOnce({ status: "completed", toolNodeId: "tool-a", nodeVersionId: null });
    expect(await service.processChanges("user", "project", { executionId: "legacy-execution" })).toMatchObject({ status: "skipped", reason: "execution_version_missing" });
    expect(model.generateJson).not.toHaveBeenCalled();
    expect(contexts.patchInTransaction).not.toHaveBeenCalled();
  });
});
