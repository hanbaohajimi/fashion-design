import type { PrismaClient } from "@fashion/db";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowsService } from "../workflows/workflows.service";
import { DesignContextService } from "./design-context.service";
import { graphTrajectory, relatedNodeIds } from "./design-context.projector";
import { mergeDialogSummary } from "./design-context.summary";

const node = (id: string, type: string, payload: unknown = {}, kind = "asset") => ({ id, kind, type, title: id, status: "completed", payload });
const edge = (sourceNodeId: string, targetNodeId: string, targetPort = "source") => ({ id: `${sourceNodeId}-${targetNodeId}`, sourceNodeId, targetNodeId, sourcePort: "out", targetPort });
const graph = () => ({
  projectId: "project", revision: 7,
  nodes: [
    node("goal", "brief", { text: "设计藏蓝色通勤风衣" }),
    node("constraint-a", "constraint", { brief: { summary: "保持藏蓝色", constraints: [{ id: "c1", requirement: "保持藏蓝色", mode: "preserve", verification: "visual" }] } }),
    node("generator-a", "generate_design", { params: { prompt: "当前新草稿", maskImageUrl: "https://private.example/mask?token=secret" } }, "tool"),
    node("candidate-a", "candidate", { assetId: "asset-a", imageUrl: "https://private.example/candidate?token=secret", decision: { id: "decision-a", kind: "rejected", reason: "袖口太宽" } }),
    node("generator-b", "generate_design", {}, "tool"), node("candidate-b", "candidate", { assetId: "asset-b" }),
    node("evaluation-a", "evaluation", { report: { constraintNodeId: "constraint-a", evaluations: [{ assetId: "asset-a", checks: [{ constraintId: "c1", status: "concern", observation: "颜色偏亮" }] }] } }),
  ],
  edges: [edge("goal", "generator-a", "goal"), edge("constraint-a", "generator-a", "constraint"), edge("generator-a", "candidate-a"), edge("goal", "generator-b", "goal"), edge("generator-b", "candidate-b"), edge("candidate-a", "evaluation-a", "candidate")],
});

function fixture() {
  let current: null | { projectId: string; revision: number; state: unknown } = null;
  const revisions: Array<{ projectId: string; revision: number; state: unknown; sourceMessageId: string | null; mutationId: string | null; requestHash: string; createdAt: Date }> = [];
  let summary: null | { conversationId: string; revision: number; summary: unknown; focusNodeIds: string[]; currentTask: string | null; graphRevision: number; throughMessageId: string | null } = null;
  const messages: Array<{ id: string; role: string; kind: string | null; status: string; content: string; context: unknown; createdAt: Date }> = [{ id: "user-current", role: "USER", kind: null, status: "COMPLETED", content: "请保留藏蓝色，只修改袖口", context: { referencedNodeIds: ["candidate-a"] }, createdAt: new Date("2026-10-15T08:01:00Z") }];
  const attempts: Array<{ id: string; toolNodeId: string; ordinal: number; status: string; error: string | null; createdAt: Date; requestSnapshot: unknown }> = [{ id: "attempt-a", toolNodeId: "generator-a", ordinal: 1, status: "completed", error: null, createdAt: new Date("2026-10-15T08:00:00Z"), requestSnapshot: { graphRevision: 3, inputNodeIds: ["goal"], request: { prompt: "原冻结提示词", negativePrompt: "禁止红色", referenceImageUrl: "https://private.example/frozen?token=secret" }, inputSnapshot: [{ id: "goal", type: "brief", title: "旧目标", payload: { text: "原冻结输入", url: "https://private.example/source" } }] } }];
  const db = {
    project: { findUnique: vi.fn().mockResolvedValue({ id: "project", archived: false, deletedAt: null, workspace: { ownerId: "user" } }), findFirst: vi.fn(async () => ({ id: "project", archived: false })) },
    workflowGraph: { findUnique: vi.fn(async () => ({ revision: 7 })), updateMany: vi.fn(async () => ({ count: 1 })) },
    projectDesignContext: {
      findUnique: vi.fn(async () => current),
      upsert: vi.fn(async ({ create }: { create: { state: unknown } }) => current ?? (current = { projectId: "project", revision: 0, state: create.state })),
      updateMany: vi.fn(async ({ where, data }: { where: { revision: number }; data: { state: unknown } }) => {
        if (!current || current.revision !== where.revision) return { count: 0 };
        current = { ...current, revision: current.revision + 1, state: data.state }; return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async () => current),
    },
    projectDesignContextRevision: {
      findMany: vi.fn(async () => revisions.slice().reverse()),
      findUnique: vi.fn(async ({ where }: { where: { projectId_mutationId: { mutationId: string } } }) => revisions.find((entry) => entry.mutationId === where.projectId_mutationId.mutationId) ?? null),
      create: vi.fn(async ({ data }: { data: Omit<(typeof revisions)[number], "createdAt"> }) => { revisions.push({ ...data, createdAt: new Date() }); return data; }),
    },
    agentConversation: { findFirst: vi.fn(async () => ({ id: "conversation", projectId: "project", createdById: "user" })) },
    agentMessage: {
      findMany: vi.fn(async () => messages), count: vi.fn(async () => messages.length),
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => messages.find((message) => message.id === where.id) ?? null),
    },
    agentContextSummary: {
      findUnique: vi.fn(async () => summary),
      upsert: vi.fn(async () => summary ?? (summary = { conversationId: "conversation", revision: 0, summary: {}, focusNodeIds: [], currentTask: null, graphRevision: 7, throughMessageId: null })),
      updateMany: vi.fn(async ({ where, data }: { where: { revision: number; throughMessageId?: string | null }; data: Record<string, unknown> }) => {
        if (!summary || summary.revision !== where.revision) return { count: 0 };
        if ("throughMessageId" in where && where.throughMessageId !== summary.throughMessageId) return { count: 0 };
        summary = { ...summary, ...data, revision: data.revision ? summary.revision + 1 : summary.revision } as typeof summary; return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async () => summary),
    },
    workflowAttempt: { findMany: vi.fn(async () => attempts), count: vi.fn(async () => attempts.length) },
    workflowNodeVersion: { findMany: vi.fn(async () => [{ id: "version-a", nodeId: "generator-a", kind: "tool", type: "generate_design", title: "生成方案", payload: { params: { prompt: "银色窄袖口" } } }]) },
    designAssetDecision: { findMany: vi.fn(async () => [{ id: "decision-a", assetId: "asset-a", kind: "rejected", reason: "袖口太宽", createdAt: new Date() }]) },
    workflowProposal: { updateMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: async <T>(run: (transaction: unknown) => Promise<T>) => run(db),
  };
  const workflows = { get: vi.fn(async () => graph()) };
  return { db, service: new DesignContextService(db as unknown as PrismaClient, workflows as unknown as WorkflowsService), workflows, messages, revisions };
}

describe("DesignContextService", () => {
  it("项目目标跨会话共享，更正保留初始目标与修订，停用条目不删除历史", async () => {
    const { service, revisions } = fixture();
    await service.patch("user", "project", { baseRevision: 0, operations: [{ type: "set_objective", text: "设计通勤风衣" }, { type: "upsert_item", item: { id: "color", kind: "requirement", text: "保持藏蓝色", priority: "must" } }] });
    const corrected = await service.patch("user", "project", { baseRevision: 1, operations: [{ type: "set_objective", text: "设计轻量通勤风衣" }, { type: "deactivate_item", id: "color" }] });
    expect(corrected.state).toMatchObject({ initialObjective: "设计藏蓝色通勤风衣", currentObjective: "设计轻量通勤风衣", requirements: [{ id: "color", status: "inactive" }] });
    expect(revisions).toHaveLength(2);
    expect((await service.build("user", "project", { conversationId: "another-conversation" })).context.currentObjective).toBe("设计轻量通勤风衣");
  });

  it("CAS阻止旧版本覆盖，mutationId可重放但不能换参数", async () => {
    const { service, db } = fixture();
    const input = { baseRevision: 0, mutationId: "context-request-001", operations: [{ type: "set_objective" as const, text: "藏蓝通勤" }] };
    await service.patch("user", "project", input);
    expect((await service.patch("user", "project", input)).revision).toBe(1);
    expect(db.projectDesignContext.updateMany).toHaveBeenCalledTimes(1);
    await expect(service.patch("user", "project", { ...input, operations: [{ type: "set_objective", text: "别的目标" }] })).rejects.toThrow("请求编号");
    await expect(service.patch("user", "project", { baseRevision: 0, operations: [{ type: "set_objective", text: "过期目标" }] })).rejects.toThrow("上下文已变化");
  });

  it("记忆可加入调用方的租约事务，既不另起事务也不提前读取未提交结果", async () => {
    const { service, db } = fixture();
    const nested = vi.spyOn(db, "$transaction");
    const result = await service.patchInTransaction("user", "project", { baseRevision: 0, sourceMessageId: "user-current", operations: [{ type: "set_objective", text: "轻量化通勤风衣" }] }, db as unknown as Parameters<DesignContextService["patchInTransaction"]>[3], graph());
    expect(nested).not.toHaveBeenCalled();
    expect(result).toMatchObject({ revision: 1, state: { initialObjective: "设计藏蓝色通勤风衣", currentObjective: "轻量化通勤风衣" } });
    expect(db.workflowProposal.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "pending" }), data: { status: "superseded" } }));
  });

  it("推断降为prefer，分支偏好不污染兄弟分支，必须保留真实来源", async () => {
    const { service } = fixture();
    await service.patch("user", "project", { baseRevision: 0, operations: [{ type: "upsert_item", item: { id: "sleeve", kind: "preference", text: "这个方案尝试窄袖口", origin: "inferred", priority: "must", scope: "branch", branchNodeIds: ["candidate-a"], sourceNodeIds: ["candidate-a"], sourceQuote: "袖口太宽" } }] });
    expect((await service.build("user", "project", { referencedNodeIds: ["candidate-a"] })).context.preferences).toMatchObject([{ id: "sleeve", priority: "prefer" }]);
    expect((await service.build("user", "project", { referencedNodeIds: ["candidate-b"] })).context.preferences).toEqual([]);
    await expect(service.patch("user", "project", { baseRevision: 1, operations: [{ type: "upsert_item", item: { id: "fake", kind: "preference", text: "不存在的偏好", origin: "inferred" } }] })).rejects.toThrow("真实消息或节点来源");
    await expect(service.patch("user", "project", { baseRevision: 1, operations: [{ type: "upsert_item", item: { id: "fake", kind: "preference", text: "不存在的偏好", sourceNodeIds: ["outside-project"] } }] })).rejects.toThrow("当前项目");
  });

  it("真实约束进入顶层要求并保留分支来源、保留方式和验证限制，推断不得升为must", async () => {
    const { service, workflows } = fixture();
    const branched = graph();
    const constraintA = branched.nodes.find((item) => item.id === "constraint-a");
    if (!constraintA) throw new Error("test constraint missing");
    constraintA.payload = { brief: { constraints: [
      { id: "explicit-a", requirement: "保持藏蓝色", mode: "preserve", origin: "explicit", priority: "must", verification: "visual", sourceQuote: "保留藏蓝色" },
      { id: "inferred-a", requirement: "袖口可能需要更窄", mode: "change", origin: "interpretation", priority: "must", verification: "requires_measurement" },
    ] } };
    branched.nodes.push(node("constraint-b", "constraint", { brief: { constraints: [{ id: "explicit-b", requirement: "避免红色", mode: "avoid", origin: "explicit", priority: "must", verification: "visual" }] } }));
    branched.edges.push(edge("constraint-b", "generator-b", "constraint"));
    workflows.get.mockResolvedValue(branched);
    await service.patch("user", "project", { baseRevision: 0, operations: [{ type: "upsert_item", item: { id: "project-item", kind: "requirement", text: "项目共同要求" } }] });
    const focused = (await service.build("user", "project", { referencedNodeIds: ["candidate-a"] })).context;
    expect(focused.requirements).toHaveLength(3);
    expect(focused.requirements).toContainEqual(expect.objectContaining({ text: "保留：保持藏蓝色（验证：视觉观察）", origin: "explicit", priority: "must", scope: "branch", branchNodeIds: ["constraint-a"], sourceNodeIds: ["constraint-a"], sourceQuote: "保留藏蓝色" }));
    expect(focused.requirements).toContainEqual(expect.objectContaining({ text: "修改：袖口可能需要更窄（验证：需要测量或试穿资料）", origin: "inferred", priority: "prefer" }));
    expect(focused.requirements.some((item) => item.sourceNodeIds.includes("constraint-b"))).toBe(false);
    const overview = (await service.build("user", "project")).context;
    expect(overview.requirements.filter((item) => item.scope === "branch")).toHaveLength(3);
    expect(overview.coverage.memory.graphRequirements).toBe(3);
    const otherBranch = (await service.build("user", "project", { referencedNodeIds: ["candidate-b"] })).context;
    expect(otherBranch.requirements.filter((item) => item.scope === "branch")).toMatchObject([{ text: "避免：避免红色（验证：视觉观察）", branchNodeIds: ["constraint-b"] }]);
    expect((await service.get("user", "project")).state.requirements).toHaveLength(1);
  });

  it("保留端口图、自然语言分支、冻结尝试、评价和具体否决；不传图片地址", async () => {
    const { service } = fixture();
    const { context } = await service.build("user", "project", { conversationId: "conversation", referencedNodeIds: ["candidate-a"] });
    expect(context.nodes).toHaveLength(7);
    expect(context.edges).toContainEqual(expect.objectContaining({ sourceNodeId: "constraint-a", targetNodeId: "generator-a", targetPort: "constraint" }));
    expect(context.trajectory.branches[0]?.description).toContain("constraint-a[constraint]");
    expect(context.attempts[0]).toMatchObject({ parameters: { prompt: "原冻结提示词" }, frozenInputs: [{ content: "原冻结输入" }] });
    expect(context.nodes.find((item) => item.id === "evaluation-a")).toMatchObject({ report: { evaluations: [{ checks: [{ observation: "颜色偏亮" }] }] } });
    expect(context.decisions[0]).toMatchObject({ assetId: "asset-a", reason: "袖口太宽" });
    expect(context.dialog).toContainEqual(expect.objectContaining({ id: "user-current", content: "请保留藏蓝色，只修改袖口" }));
    expect(JSON.stringify(context)).not.toContain("private.example");
    expect(JSON.stringify(context)).not.toContain("token=secret");
  });

  it("长历史保留当前消息并明确标记未读部分，完整轻量图不因预算丢失", async () => {
    const { service, db, messages, workflows } = fixture();
    const recent = Array.from({ length: 200 }, (_, i) => ({ ...messages[0], id: `message-${200 - i}`, role: "USER", kind: null, status: "COMPLETED", context: {}, content: `第${200 - i}条：${"长设计需求".repeat(120)}`, createdAt: new Date(1_800_000_000_000 - i * 1000) }));
    db.agentMessage.findMany.mockResolvedValue(recent);
    db.agentMessage.count.mockResolvedValue(240);
    const large = graph();
    large.nodes.push(...Array.from({ length: 120 }, (_, i) => node(`reference-${i}`, "reference_text", { text: "参考文字".repeat(300) })));
    workflows.get.mockResolvedValue(large);
    const { context } = await service.build("user", "project", { conversationId: "conversation" });
    expect(context.dialog.at(-1)?.id).toBe("message-200");
    expect(context.coverage.dialog.total).toBe(240);
    expect(context.coverage.dialog.omitted).toBeGreaterThanOrEqual(40);
    expect(context.nodes).toHaveLength(127);
    expect(context.coverage.graph.omittedDetailNodeIds.length).toBeGreaterThan(0);
    expect(JSON.stringify(context).length).toBeLessThan(130_000);
  });

  it("当前长消息被截断时提供精确消息编号与未读标记，尾部纠正可补读", async () => {
    const { service, messages } = fixture();
    const message = messages[0];
    if (!message) throw new Error("fixture message missing");
    message.content = `${"早期设计讨论，".repeat(800)}最终纠正：只保留藏蓝色。`;
    const { context } = await service.build("user", "project", { conversationId: "conversation" });
    expect(context.dialog).toContainEqual(expect.objectContaining({ id: "user-current", contentTruncated: true, contentCharacters: message.content.length }));
    expect(context.coverage.dialog).toMatchObject({ truncatedMessages: 1, truncatedMessageIds: ["user-current"] });
    expect(context.dialog[0]?.content).not.toContain("最终纠正");
  });

  it("会话焦点和当前任务独立保存，摘要不能引用其他会话消息或过期画布", async () => {
    const { service, db } = fixture();
    await service.updateSummary("user", "project", "conversation", { baseRevision: 0, graphRevision: 7, focusNodeIds: ["candidate-a"], currentTask: "收窄袖口", summary: { text: "设计师正在修改袖口", sourceMessageIds: ["user-current"] }, throughMessageId: "user-current" });
    const { context } = await service.build("user", "project", { conversationId: "conversation" });
    expect(context).toMatchObject({ focusNodeIds: ["candidate-a"], currentTask: "收窄袖口" });
    await expect(service.updateSummary("user", "project", "conversation", { baseRevision: 1, graphRevision: 6 })).rejects.toThrow("画布已变化");
    db.agentMessage.findFirst.mockResolvedValueOnce(null);
    await expect(service.updateSummary("user", "project", "conversation", { baseRevision: 1, graphRevision: 7, throughMessageId: "foreign-message" })).rejects.toThrow("当前会话");
  });

  it("伪造引文和不属于项目的引用在模型上下文生成前被拒绝", async () => {
    const { service } = fixture();
    await expect(service.patch("user", "project", { baseRevision: 0, sourceMessageId: "user-current", operations: [{ type: "set_objective", text: "红色风衣", sourceQuote: "用户明确要求红色" }] })).rejects.toThrow("引文必须命中");
    await expect(service.build("user", "project", { referencedNodeIds: ["foreign-node"] })).rejects.toThrow("当前画布");
  });

  it("隐含偏好的不可变版本和逐字引文必须真实，停用后不因自动推断恢复", async () => {
    const { service } = fixture();
    const item = { id: "silver", kind: "preference" as const, text: "本分支偏好银色", origin: "inferred" as const, scope: "branch" as const, branchNodeIds: ["generator-a"], sourceNodeIds: ["generator-a"], sourceVersionIds: ["version-a"], sourceQuote: "银色窄袖口" };
    await service.patch("user", "project", { baseRevision: 0, operations: [{ type: "upsert_item", item }] });
    expect((await service.get("user", "project")).state.preferences[0]).toMatchObject({ sourceVersionIds: ["version-a"], priority: "prefer" });
    await service.patch("user", "project", { baseRevision: 1, operations: [{ type: "deactivate_item", id: "silver" }] });
    await expect(service.patch("user", "project", { baseRevision: 2, operations: [{ type: "upsert_item", item: { ...item, id: "reworded", text: "该方案更喜欢金属银" } }] })).rejects.toThrow("停用的偏好不能");
    await expect(service.patch("user", "project", { baseRevision: 2, operations: [{ type: "upsert_item", item: { ...item, sourceNodeIds: ["generator-b"] } }] })).rejects.toThrow("真实来源节点");
    await expect(service.patch("user", "project", { baseRevision: 2, operations: [{ type: "upsert_item", item: { ...item, sourceQuote: "不存在的版本文字" } }] })).rejects.toThrow("真实版本快照");
  });

  it("多个需求不会被擅自压成第一条，首次读取会初始化可供CAS校验的项目上下文", async () => {
    const { service, workflows, db } = fixture();
    const multiple = graph();
    multiple.nodes.push(node("goal-b", "brief", { text: "运动夹克方案" }));
    workflows.get.mockResolvedValue(multiple);
    const { context } = await service.build("user", "project");
    expect(context.currentObjective).toBeNull();
    expect(context.goals).toHaveLength(2);
    expect(context.ambiguities[0]).toContain("多个设计需求");
    expect(db.projectDesignContext.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ projectId: "project" }) }));
  });

  it("先打开空画布后补充的唯一初始需求会持久保存，后续多个分支不丢失初始目标", async () => {
    const { service, workflows } = fixture();
    workflows.get.mockResolvedValue({ ...graph(), nodes: [], edges: [] });
    expect((await service.build("user", "project")).context.initialObjective).toBeNull();
    workflows.get.mockResolvedValue(graph());
    const initialized = await service.build("user", "project");
    expect(initialized.context.contextRevision).toBe(1);
    const multiple = graph();
    multiple.nodes.push(node("goal-b", "brief", { text: "运动夹克方案" }));
    workflows.get.mockResolvedValue(multiple);
    expect((await service.build("user", "project")).context).toMatchObject({ initialObjective: "设计藏蓝色通勤风衣", currentObjective: "设计藏蓝色通勤风衣" });
    expect((await service.get("user", "project")).state.objectiveSourceNodeIds).toEqual(["goal"]);
  });

  it("焦点分支历史独立检索，旧尝试不会被全项目近期尝试挤掉", async () => {
    const { service, db } = fixture();
    const old = { id: "old-focused", toolNodeId: "generator-a", ordinal: 1, status: "completed", error: null, createdAt: new Date("2020-01-01"), requestSnapshot: { request: { prompt: "旧焦点真实输入" } } };
    db.workflowAttempt.findMany.mockResolvedValueOnce([old]).mockResolvedValueOnce([{ ...old, id: "new-unrelated", toolNodeId: "generator-b", createdAt: new Date() }]);
    const { context } = await service.build("user", "project", { referencedNodeIds: ["candidate-a"] });
    expect(context.attempts[0]).toMatchObject({ id: "old-focused", parameters: { prompt: "旧焦点真实输入" } });
    expect(db.workflowAttempt.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ toolNodeId: { in: ["generator-a"] } }) }));
  });

  it("会话摘要只推进实际处理的游标，保留会话任务与焦点", async () => {
    const { service, db, messages } = fixture();
    await service.updateSummary("user", "project", "conversation", { baseRevision: 0, graphRevision: 7, focusNodeIds: ["candidate-a"], currentTask: "调整袖口" });
    const recent = Array.from({ length: 40 }, (_, i) => ({ ...messages[0], id: `recent-${40 - i}`, role: "USER", kind: null, status: "COMPLETED", content: "近期消息", context: {}, createdAt: new Date(1_800_000_000_000 - i * 1000) }));
    const sample = recent[0];
    if (!sample) throw new Error("test recent message missing");
    const older = [{ ...sample, id: "older-1", role: "USER", content: "最初的设计意图", createdAt: new Date(1_700_000_000_000) }, { ...sample, id: "older-2", role: "ASSISTANT", content: "对应回复", createdAt: new Date(1_700_000_001_000) }];
    db.agentMessage.findMany.mockResolvedValueOnce(recent).mockResolvedValueOnce(older);
    db.agentMessage.count.mockResolvedValueOnce(8);
    const result = await service.refreshSummary("user", "project", "conversation");
    expect(result.updated).toBe(true);
    expect(result.summary).toMatchObject({ revision: 1, throughMessageId: "older-2", focusNodeIds: ["candidate-a"], currentTask: "调整袖口", summary: { sourceMessageIds: ["older-1", "older-2"], pendingMessageCount: 6, coveredMessageCount: 2 } });
  });

  it("替换摘要正文时保留最近上下文更正的幂等标记", async () => {
    const { service, db } = fixture();
    const lastCorrection = { mutationId: "correction-request", requestHash: "correction-hash" };
    await service.updateSummary("user", "project", "conversation", { baseRevision: 0, graphRevision: 7 });
    db.agentContextSummary.upsert.mockResolvedValueOnce({ conversationId: "conversation", revision: 1, summary: { text: "旧摘要", lastCorrection }, focusNodeIds: [], currentTask: null, graphRevision: 7, throughMessageId: null });
    await service.updateSummary("user", "project", "conversation", { baseRevision: 1, graphRevision: 7, summary: { text: "新摘要" } });
    expect(db.agentContextSummary.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ summary: expect.objectContaining({ text: "新摘要", lastCorrection }) }) }));
    expect(JSON.stringify((await service.build("user", "project", { conversationId: "conversation" })).context)).not.toContain("correction-hash");
  });
});

describe("design graph traversal", () => {
  it("共享祖先不会使一个候选的焦点遍历扩散到兄弟分支", () => {
    const related = relatedNodeIds(graph(), ["candidate-a"]);
    expect([...related]).toEqual(expect.arrayContaining(["goal", "generator-a", "constraint-a", "evaluation-a"]));
    expect(related.has("candidate-b")).toBe(false);
    expect(related.has("generator-b")).toBe(false);
    expect(graphTrajectory(graph()).branches).toHaveLength(2);
  });
});

describe("bounded rolling dialog summary", () => {
  it("滚动压缩保留最近上下文更正的幂等标记", () => {
    const lastCorrection = { mutationId: "correction-request", requestHash: "correction-hash" };
    const summary = mergeDialogSummary({ text: "旧摘要", sourceMessageIds: [], lastCorrection }, [{ id: "new-message", role: "USER", content: "继续讨论" }]);
    expect(summary.lastCorrection).toEqual(lastCorrection);
  });
  it("合并去重并保留最早意图，预算丢弃均明确计数，不伪称完整阅读", () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, role: "USER", content: `${i === 0 ? "最初目标" : "迭代消息"}${"细节".repeat(200)}` }));
    const first = mergeDialogSummary(null, messages.slice(0, 50));
    const next = mergeDialogSummary(first, [messages[49] as (typeof messages)[number], ...messages.slice(50)]);
    expect(next.coveredMessageCount).toBe(100);
    expect(next.sourceMessageIds[0]).toBe("m0");
    expect(new Set(next.sourceMessageIds).size).toBe(next.sourceMessageIds.length);
    expect(next.omittedMessageCount).toBe(100 - next.sourceMessageIds.length);
    expect(next.truncatedMessageCount).toBe(next.entries.length);
    expect(next.text.length).toBeLessThanOrEqual(12_000);
  });
});
