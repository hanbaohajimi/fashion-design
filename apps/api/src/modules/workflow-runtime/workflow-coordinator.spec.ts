import { describe, expect, it, vi } from "vitest";
import { WorkflowCoordinator } from "./workflow-coordinator";
import { parsePlannerDecision, workflowActionFingerprint, type PlannerDecision } from "./workflow-planner";

const reply = () => parsePlannerDecision({ kind: "reply", message: "根据已读取内容解释设计过程", plan: null, objectiveUpdate: null, preferences: [] });
const read = () => ({ ...reply(), kind: "read", reads: [{ type: "nodes", ids: ["brief"] }] });
function harness(responses: unknown[], declined: unknown[] = []) {
  const graph = { projectId: "project", revision: 4, layoutRevision: 0, legacyAvailable: false,
    nodes: [{ id: "brief", kind: "asset", type: "brief", title: "设计需求", payload: { text: "保留立领" }, status: "ready", x: 0, y: 0 }], edges: [] };
  const context = { nodes: graph.nodes, focusNodeIds: [], graphRevision: 4, contextRevision: 1, summaryRevision: 2,
    dialog: [{ id: "message-1", content: "旧对话的偏好" }], preferences: [{ id: "inference-1", origin: "inferred", text: "可能喜欢银色" }], trajectory: "过去的设计轨迹" };
  const database = { $transaction: vi.fn(async () => undefined), workflowNodeVersion: { findMany: vi.fn(async () => []) },
    workflowAttempt: { groupBy: vi.fn(async () => []) }, workflowProposal: { findMany: vi.fn(async () => declined) }, project: { findFirst: vi.fn(async () => ({ id: "project" })) } };
  const contexts = { build: vi.fn(async () => ({ graph, context })), get: vi.fn(async () => ({ revision: 1, state: { preferences: [] } })) };
  const visual = { enrich: vi.fn(async () => ({ images: [], imageBindings: [], index: [], coverage: { total: 0, ready: 0, pending: 0, failed: 0, attachedNodeIds: [], unreadNodeIds: [] } })) };
  const generateJson = vi.fn(async (request: { parse: (value: unknown) => PlannerDecision; prompt: string }) => {
    const value = responses.shift() ?? reply();
    if (value instanceof Error) throw value;
    return request.parse(value);
  });
  const coordinator = new WorkflowCoordinator(database as never, {} as never, contexts as never, visual as never, { generateJson } as never);
  return { coordinator, generateJson };
}

describe("Fig8 bounded coordinator", () => {
  const input = { userId: "user", projectId: "project", request: "理解完整设计过程", referencedNodeIds: [] };
  it("feeds a skipped identical action back for one repair instead of failing only during commit", async () => {
    const decision = parsePlannerDecision({ kind: "propose", message: "整理目标", action: { type: "create_tool", toolKey: "analyze_brief", toolVersion: "1", title: "整理设计目标", parameters: { prompt: "保留立领" },
      inputs: [{ nodeId: "brief", port: "goal" }], newObjective: null, rationale: "根据设计目标" } });
    if (!decision.action) throw new Error("Expected test action");
    const h = harness([decision, decision], [{ actionFingerprint: workflowActionFingerprint(decision.action), evidence: { action: decision.action }, rejectionReason: null }]);
    const result = await h.coordinator.run(input);
    expect(result.decision).toMatchObject({ kind: "clarify", action: null });
    expect(h.generateJson).toHaveBeenCalledTimes(2);
    expect(JSON.parse(h.generateJson.mock.calls[1]?.[0].prompt ?? "{}").validationError).toContain("已被设计师跳过");
  });
  it("allows one format repair plus three reads and a final decision within five calls", async () => {
    const h = harness([{ kind: "invalid" }, read(), read(), read(), reply()]);
    const result = await h.coordinator.run(input);
    expect(result).toMatchObject({ calls: 5, readRounds: 3, decision: { kind: "reply" } });
    expect(result.readResults).toHaveLength(3);
    const last = JSON.parse(h.generateJson.mock.calls[4]?.[0].prompt ?? "{}");
    expect(last.budget).toMatchObject({ remainingCalls: 0, remainingReadRounds: 0 });
    expect(last.readResults).toHaveLength(3);
  });
  it("stops repeated read requests after three rounds and one bounded repair", async () => {
    const h = harness(Array.from({ length: 8 }, read));
    const result = await h.coordinator.run(input);
    expect(result).toMatchObject({ calls: 5, readRounds: 3, decision: { kind: "clarify", action: null } });
    expect(h.generateJson).toHaveBeenCalledTimes(5);
  });
  it("never retries a transport failure as if it were a malformed tool call", async () => {
    const h = harness([new Error("ECONNREFUSED")]);
    await expect(h.coordinator.run(input)).rejects.toThrow("ECONNREFUSED");
    expect(h.generateJson).toHaveBeenCalledOnce();
  });
  it("reserves a model call before transport failure so a retried turn cannot reset its budget", async () => {
    const h = harness([new Error("ECONNREFUSED")]);
    const reserved: unknown[] = [];
    await expect(h.coordinator.run({ ...input, initialBudget: { modelCalls: 2, readRounds: 1, repairUsed: true },
      reserveBudget: async (budget) => { reserved.push({ ...budget }); } })).rejects.toThrow("ECONNREFUSED");
    expect(reserved).toEqual([{ modelCalls: 3, readRounds: 1, repairUsed: true }]);
    expect(h.generateJson).toHaveBeenCalledOnce();
  });
  it("uses only the remaining call on a retry and refuses any model call once the turn budget is exhausted", async () => {
    const h = harness([reply()]);
    const reserveBudget = vi.fn(async () => undefined);
    const result = await h.coordinator.run({ ...input, initialBudget: { modelCalls: 4, readRounds: 3, repairUsed: true }, reserveBudget });
    expect(result).toMatchObject({ calls: 5, readRounds: 3, repairUsed: true });
    expect(h.generateJson).toHaveBeenCalledOnce();
    expect(reserveBudget).toHaveBeenCalledWith({ modelCalls: 5, readRounds: 3, repairUsed: true });
    h.generateJson.mockClear();
    await expect(h.coordinator.run({ ...input, initialBudget: { modelCalls: 5, readRounds: 3, repairUsed: true } })).rejects.toThrow("预算");
    expect(h.generateJson).not.toHaveBeenCalled();
  });
  it("cannot gain another schema repair by retrying the same turn", async () => {
    const h = harness([{ kind: "invalid" }, reply()]);
    await expect(h.coordinator.run({ ...input, initialBudget: { modelCalls: 2, readRounds: 0, repairUsed: true } })).rejects.toThrow();
    expect(h.generateJson).toHaveBeenCalledOnce();
  });
  it("rejects foreign project reads and gives the planner one constrained correction", async () => {
    const h = harness([{ ...read(), reads: [{ type: "nodes", ids: ["foreign"] }] }, reply()]);
    const result = await h.coordinator.run(input);
    expect(result.readResults).toHaveLength(0);
    expect(h.generateJson).toHaveBeenCalledTimes(2);
    expect(JSON.parse(h.generateJson.mock.calls[1]?.[0].prompt ?? "{}").validationError).toContain("当前项目");
  });
  it("applies ablation gates to the initial context, previous plan and later reads", async () => {
    const h = harness([{ ...read(), reads: [{ type: "dialog", ids: ["message-1"] }] }, reply()]);
    const result = await h.coordinator.run({ ...input, previousPlan: { goal: "旧对话派生的目标" }, readPolicy: { trajectory: false, dialog: false, hiddenIntent: false } });
    const first = JSON.parse(h.generateJson.mock.calls[0]?.[0].prompt ?? "{}");
    expect(first.context).toMatchObject({ dialog: [], trajectory: null, preferences: [] });
    expect(first.previousPlan).toBeNull();
    expect(result.readResults).toEqual([expect.objectContaining({ type: "dialog", unavailable: true })]);
  });
});
