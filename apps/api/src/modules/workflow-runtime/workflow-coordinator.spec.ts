import { describe, expect, it, vi } from "vitest";
import { assistantShapeStamp, emptyCanvasCreationDraft, type AssistantCanvasObservation } from "@fashion/shared";
import { WorkflowCoordinator } from "./workflow-coordinator";
import { parsePlannerDecision, workflowActionFingerprint, type PlannerDecision } from "./workflow-planner";
import type { VisualContextResult } from "../design-context/visual-context.service";

const reply = () => parsePlannerDecision({ kind: "reply", message: "根据已读取内容解释设计过程", plan: null, objectiveUpdate: null, preferences: [] });
const read = () => ({ ...reply(), kind: "read", reads: [{ type: "nodes", ids: ["brief"] }] });
function harness(responses: unknown[], declined: unknown[] = [], integrated = false) {
  const focused = { id: "target", projectId: "project", revision: 4, title: "当前创作", module: "image", draft: { ...emptyCanvasCreationDraft(), prompt: "最新要求", inputs: [{ id: "input-1", nodeId: "brief" }] }, currentResultNodeId: null, removedAt: null };
  const graph = { projectId: "project", revision: 4, layoutRevision: 0, legacyAvailable: false,
    nodes: [{ id: "brief", kind: "asset", type: "brief", title: "设计需求", payload: { text: "保留立领" }, status: "ready", x: 0, y: 0 }], edges: [] };
  const context = { nodes: graph.nodes, focusNodeIds: [], graphRevision: 4, contextRevision: 1, summaryRevision: 2,
    dialog: [{ id: "message-1", content: "旧对话的偏好" }], preferences: [{ id: "inference-1", origin: "inferred", text: "可能喜欢银色" }], trajectory: "过去的设计轨迹" };
  const database = { canvasCreation: { findFirst: vi.fn(async (): Promise<typeof focused | null> => null), findMany: vi.fn(async (): Promise<{ id: string; currentResultNodeId: string | null }[]> => []) }, $queryRaw: vi.fn(async () => []), $transaction: vi.fn(async () => undefined), workflowNodeVersion: { findMany: vi.fn(async () => []) },
    workflowAttempt: { groupBy: vi.fn(async () => []) }, workflowProposal: { findMany: vi.fn(async () => declined) }, project: { findUnique: vi.fn(async () => ({ id: "project", wsId: "workspace", deletedAt: null, workspace: { ownerId: "user" } })), findFirst: vi.fn(async () => ({ id: "project" })) } };
  const contexts = { build: vi.fn(async () => ({ graph, context })), get: vi.fn(async () => ({ revision: 1, state: { preferences: [] } })) };
  const visual = { enrich: vi.fn(async (): Promise<VisualContextResult> => ({ images: [], imageBindings: [], index: [], coverage: { total: 0, ready: 0, pending: 0, failed: 0, attachedNodeIds: [], unreadNodeIds: [] } })) };
  const generateJson = vi.fn(async (request: { parse: (value: unknown) => PlannerDecision; prompt: string }) => {
    const value = responses.shift() ?? reply();
    if (value instanceof Error) throw value;
    return request.parse(value);
  });
  const integration = { integrate: vi.fn(async (_user: string, _project: string, options: { visual: VisualContextResult }) => ({ context,
    slots: { designTrajectory: { visualIndex: options.visual.index, visualCoverage: options.visual.coverage } } })) };
  const coordinator = new WorkflowCoordinator(database as never, {} as never, contexts as never, visual as never, { generateJson } as never, integrated ? integration as never : undefined);
  return { coordinator, generateJson, database, visual, graph, contexts, focused };
}

function visualBatch(ids: string[], pending: string[] = []): VisualContextResult {
  return {
    images: ids.map(id => ({ url: `data:image/webp;base64,${Buffer.from(id).toString("base64")}`, detail: "high" })),
    imageBindings: ids.map((id, imageIndex) => ({ imageIndex, nodeId: id, assetId: null, fileAssetId: `file-${id}` })),
    index: [...ids, ...pending].map(id => ({ nodeId: id, assetId: null, fileAssetId: `file-${id}`,
      status: pending.includes(id) ? "not_ready" : "ready", summary: null, error: null })),
    coverage: { total: ids.length + pending.length, ready: ids.length, pending: pending.length, failed: 0, attachedNodeIds: ids, unreadNodeIds: pending },
  };
}

describe("Fig8 bounded coordinator", () => {
  const input = { userId: "user", projectId: "project", request: "理解完整设计过程", referencedNodeIds: [] };
  it("模型收到13个独立画布工具及实际选择，输出真实对象动作并禁止假设自动操作", async () => {
    const record = { id: "shape:a", typeName: "shape", type: "fashion-image", parentId: "page:a", x: 20, y: 30, props: { w: 200, h: 300 } };
    const observation: AssistantCanvasObservation = { clientId: "00000000-0000-4000-a000-000000000001", sequence: 1, revision: 0, selectedIds: [record.id], omitted: 0, viewport: { x: 0, y: 0, w: 1000, h: 800 }, objects: [{ id: record.id, type: record.type, title: "当前图片", parentId: record.parentId, nodeId: null, creationId: null, locked: false, hidden: false, bounds: { x: 20, y: 30, w: 200, h: 300 }, stamp: assistantShapeStamp(record) }] };
    const request = "请把选中的图片向右移动80";
    const decision = { kind: "canvas", message: "等待执行", canvasQuote: request, canvasAction: { type: "move_objects", shapeIds: [record.id], offset: { x: 80, y: 0 } } };
    const h = harness([decision, { ...decision, canvasQuote: "假如我移动图片" }, { ...decision, canvasQuote: "假如我移动图片" }]);
    h.database.project.findUnique.mockResolvedValue({ canvasInteractionMode: "canvas" } as never);
    Object.assign(h.database, { canvasDocument: { findUnique: vi.fn(async () => ({ revision: 2, snapshot: { store: { [record.id]: record } } })) }, canvasObjectBinding: { findMany: vi.fn(async () => []) }, fabric: { findMany: vi.fn(async () => []) } });
    const result = await h.coordinator.run({ ...input, request, canvasObservation: observation });
    expect(result.decision).toMatchObject({ kind: "canvas", canvasAction: decision.canvasAction, execution: { requested: false } });
    const prompt = JSON.parse(h.generateJson.mock.calls[0]?.[0].prompt ?? "{}");
    expect(prompt.canvasTools).toHaveLength(13);
    expect(prompt.canvasTools.every((tool: { description: string }) => tool.description.length > 10)).toBe(true);
    expect(prompt.context.canvas).toMatchObject({ revision: 2, selectedIds: [record.id] });
    const hypothetical = await h.coordinator.run({ ...input, request: "假如我移动图片", canvasObservation: observation });
    expect(hypothetical.decision.kind).toBe("clarify");
  });
  it("助手读取已同步的目标版本，并优先读取目标最新引用", async () => {
    const h = harness([reply()]); h.database.canvasCreation.findFirst.mockResolvedValue(h.focused);
    await h.coordinator.run({ ...input, focusCreationId: "target", focusCreationRevision: 4 });
    expect(h.contexts.build).toHaveBeenCalledWith("user", "project", expect.objectContaining({ focusNodeIds: ["brief"] }));
    expect(h.visual.enrich).toHaveBeenCalledWith("user", "project", h.graph.nodes, expect.arrayContaining(["brief"]));
    const prompt = JSON.parse(h.generateJson.mock.calls[0]?.[0].prompt ?? "{}");
    expect(prompt.context.focusedCreation).toMatchObject({ id: "target", revision: 4, draft: h.focused.draft });
    expect(prompt.request).toBe(input.request);
  });
  it("清空引用后不会沿用会话旧焦点，未出结果的上游目标不伪造图片", async () => {
    const h = harness([reply()]); h.database.canvasCreation.findFirst.mockResolvedValue({ ...h.focused, draft: { ...h.focused.draft, inputs: [] } });
    await h.coordinator.run({ ...input, focusCreationId: "target", focusCreationRevision: 4 });
    expect(h.contexts.build).toHaveBeenCalledWith("user", "project", expect.objectContaining({ focusNodeIds: [] }));
  });
  it("目标版本不匹配或读取途中变化时不调用模型", async () => {
    const h = harness([reply()]); h.database.canvasCreation.findFirst.mockResolvedValue(h.focused);
    await expect(h.coordinator.run({ ...input, focusCreationId: "target", focusCreationRevision: 3 })).rejects.toThrow("创作要求已更新");
    expect(h.generateJson).not.toHaveBeenCalled();
    h.database.canvasCreation.findFirst.mockResolvedValueOnce(h.focused).mockResolvedValueOnce({ ...h.focused, revision: 5 });
    await expect(h.coordinator.run({ ...input, focusCreationId: "target", focusCreationRevision: 4 })).rejects.toThrow("读取期间");
    expect(h.generateJson).not.toHaveBeenCalled();
  });
  it("exposes trusted copy eligibility without inventing execution history", async () => {
    const h = harness([reply()]);
    h.database.$queryRaw.mockResolvedValue([{ id: "copy-version", nodeId: "brief", origin: "project_copy", baseline: true }] as never);
    await h.coordinator.run(input);
    const prompt = JSON.parse(h.generateJson.mock.calls[0]?.[0].prompt ?? "{}");
    expect(prompt.context.nodes[0]).toMatchObject({ nodeVersionId: "copy-version", attemptCount: 0, copiedSnapshot: true });
  });
  it("reserves commit time and refuses to start an expired turn", async () => {
    const h = harness([reply()]);
    await expect(h.coordinator.run({ ...input, deadlineAt: Date.now() + 4000 })).rejects.toThrow("超时");
    expect(h.generateJson).not.toHaveBeenCalled();
  });
  it("passes remaining time and a real cancellation signal to the model", async () => {
    const h = harness([reply()]);
    await h.coordinator.run({ ...input, deadlineAt: Date.now() + 10000 });
    expect(h.generateJson.mock.calls[0]?.[0]).toMatchObject({ timeoutMs: expect.any(Number), signal: expect.any(AbortSignal) });
  });
  it("feeds a skipped identical action back for one repair instead of failing only during commit", async () => {
    const decision = parsePlannerDecision({ kind: "propose", message: "起草文本", action: { type: "create_tool", toolKey: "generate_text", toolVersion: "1", title: "设计说明", parameters: { prompt: "保留立领" },
      inputs: [{ nodeId: "brief", port: "reference" }], newObjective: null, rationale: "根据设计目标" } });
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

  it("补读重新计算摘要覆盖，记录本轮实际传入过的图片而不只记录最后八张", async () => {
    const firstIds = Array.from({ length: 8 }, (_, i) => `image-${i}`);
    const nextIds = Array.from({ length: 8 }, (_, i) => `image-${i + 8}`);
    const h = harness([{ ...read(), reads: [{ type: "images", ids: nextIds }] }, reply()], [], true);
    const template = h.graph.nodes[0];
    if (!template) throw new Error("测试节点缺失");
    h.graph.nodes = [...firstIds, ...nextIds].map(id => ({ ...template, id }));
    h.visual.enrich.mockResolvedValueOnce(visualBatch(firstIds, nextIds)).mockResolvedValueOnce(visualBatch(nextIds));
    const result = await h.coordinator.run(input);
    const second = JSON.parse(h.generateJson.mock.calls[1]?.[0].prompt ?? "{}");
    expect(second.visualCoverage).toMatchObject({ total: 16, ready: 16, pending: 0, attachedNodeIds: nextIds });
    expect(second.context.visualIndex.map((entry: { status: string }) => entry.status)).toEqual(Array(16).fill("ready"));
    expect(second.contextSlots.designTrajectory.visualIndex).toEqual(second.context.visualIndex);
    expect(second.contextSlots.designTrajectory.visualCoverage).toEqual(second.visualCoverage);
    expect(second.imageBindings.map((binding: { nodeId: string }) => binding.nodeId)).toEqual(nextIds);
    expect(result.visual.coverage).toMatchObject({ providedNodeIds: [...firstIds, ...nextIds], providedImageCount: 16 });
  });

  it("一轮里补读后又被替换的图片没有进入模型时不能算作已经传入", async () => {
    const firstIds = Array.from({ length: 8 }, (_, i) => `first-${i}`);
    const skippedIds = Array.from({ length: 8 }, (_, i) => `skipped-${i}`);
    const lastIds = Array.from({ length: 8 }, (_, i) => `last-${i}`);
    const h = harness([{ ...read(), reads: [{ type: "images", ids: skippedIds }, { type: "images", ids: lastIds }] }, reply()]);
    const template = h.graph.nodes[0];
    if (!template) throw new Error("测试节点缺失");
    h.graph.nodes = [...firstIds, ...skippedIds, ...lastIds].map(id => ({ ...template, id }));
    h.visual.enrich.mockResolvedValueOnce(visualBatch(firstIds, [...skippedIds, ...lastIds]))
      .mockResolvedValueOnce(visualBatch(skippedIds)).mockResolvedValueOnce(visualBatch(lastIds));
    const result = await h.coordinator.run(input);
    expect(result.visual.coverage).toMatchObject({ providedNodeIds: [...firstIds, ...lastIds], providedImageCount: 16 });
    expect(h.generateJson).toHaveBeenCalledTimes(2);
  });
});
