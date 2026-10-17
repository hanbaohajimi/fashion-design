import type { PrismaClient } from "@fashion/db";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowsService } from "../workflows/workflows.service";
import type { VisualContextService } from "../design-context/visual-context.service";
import { applyWorkflowReadPolicy, WorkflowReadGateway } from "./workflow-read-gateway";

function fixture() {
  const nodes = [
    { id: "goal", kind: "asset", type: "brief", title: "目标", status: "ready", payload: { text: "藏蓝通勤外套" } },
    { id: "tool-a", kind: "tool", type: "generate_design", title: "同名方案", status: "completed", payload: { params: { prompt: "保留藏蓝色" } } },
    { id: "tool-b", kind: "tool", type: "generate_design", title: "同名方案", status: "completed", payload: { params: { prompt: "另一个分支" } } },
    { id: "candidate-a", kind: "asset", type: "candidate", title: "同名候选", status: "ready", payload: { assetId: "asset-a", decision: { kind: "rejected", reason: "袖口太宽" } } },
    { id: "candidate-b", kind: "asset", type: "candidate", title: "同名候选", status: "ready", payload: { assetId: "asset-b" } },
    { id: "constraint", kind: "asset", type: "constraint", title: "要求", status: "ready", payload: { brief: { constraints: [{ id: "explicit", requirement: "保持藏蓝", origin: "explicit" }, { id: "hidden", requirement: "推测偏好银色", origin: "inferred" }] } } },
  ];
  const edges = [
    { id: "ga", sourceNodeId: "goal", targetNodeId: "tool-a", sourcePort: "out", targetPort: "goal" },
    { id: "gb", sourceNodeId: "goal", targetNodeId: "tool-b", sourcePort: "out", targetPort: "goal" },
    { id: "ac", sourceNodeId: "tool-a", targetNodeId: "candidate-a", sourcePort: "out", targetPort: "source" },
    { id: "bc", sourceNodeId: "tool-b", targetNodeId: "candidate-b", sourcePort: "out", targetPort: "source" },
  ];
  const graph = { projectId: "project", revision: 4, nodes, edges } as unknown as Awaited<ReturnType<WorkflowsService["get"]>>;
  const database = {
    project: { findFirst: vi.fn(async () => ({ id: "project" })) },
    agentConversation: { findFirst: vi.fn(async () => ({ id: "conversation" })) },
    workflowAttempt: { findMany: vi.fn(async () => [{ id: "attempt-a", toolNodeId: "tool-a", ordinal: 1, status: "completed", requestSnapshot: { request: { prompt: "冻结提示词" } }, error: null, createdAt: new Date(1) }]) },
    workflowNodeVersion: { findMany: vi.fn(async () => []) },
    agentMessage: { findMany: vi.fn(async () => [{ id: "message-a", role: "USER", content: "请保持藏蓝色", createdAt: new Date(1) }]) },
  };
  const visual = { enrich: vi.fn(async () => ({ index: [], images: [], imageBindings: [], coverage: { total: 0, ready: 0, pending: 0, failed: 0, attachedNodeIds: [], unreadNodeIds: [] } })) };
  return { graph, database, visual, gateway: new WorkflowReadGateway(database as unknown as PrismaClient, visual as unknown as VisualContextService) };
}

describe("WorkflowReadGateway", () => {
  it("拒绝越项目、越会话和不合法的补读编号", async () => {
    const { gateway, database, graph } = fixture();
    await expect(gateway.read("user", "foreign", "conversation", graph, { type: "nodes", ids: ["goal"] })).rejects.toThrow("画布不属于");
    database.project.findFirst.mockResolvedValueOnce(null as unknown as { id: string });
    await expect(gateway.read("user", "project", "conversation", graph, { type: "nodes", ids: ["goal"] })).rejects.toThrow("无权访问");
    await expect(gateway.read("user", "project", "conversation", graph, { type: "nodes", ids: ["foreign-node"] })).rejects.toThrow("当前项目画布");
    database.agentConversation.findFirst.mockResolvedValueOnce(null as unknown as { id: string });
    await expect(gateway.read("user", "project", "foreign-conversation", graph, { type: "dialog", ids: ["message-a"] })).rejects.toThrow("会话不属于");
    await expect(gateway.read("user", "project", "conversation", graph, { type: "nodes", ids: ["https://private.example"] })).rejects.toThrow("合法类型");
  });

  it("关闭的消融因子不能通过补读重新取回，其他补读同样去除推断字段", async () => {
    const { gateway, database, graph } = fixture();
    const policy = { trajectory: false, dialog: false, hiddenIntent: false };
    for (const type of ["attempts", "branch_history", "dialog"] as const) {
      expect((await gateway.read("user", "project", "conversation", graph, { type, ids: ["candidate-a"] }, policy)).result).toMatchObject({ unavailable: true });
    }
    expect(database.workflowAttempt.findMany).not.toHaveBeenCalled();
    expect(database.agentMessage.findMany).not.toHaveBeenCalled();
    const result = await gateway.read("user", "project", "conversation", graph, { type: "nodes", ids: ["candidate-a", "constraint"] }, policy);
    expect(JSON.stringify(result)).not.toContain("袖口太宽");
    expect(JSON.stringify(result)).not.toContain("推测偏好银色");
    expect(JSON.stringify(result)).toContain("保持藏蓝");
  });

  it("补读共享祖先的一个分支不会读到同名兄弟候选", async () => {
    const { gateway, database, graph } = fixture();
    const result = await gateway.read("user", "project", "conversation", graph, { type: "branch_history", ids: ["candidate-a"] });
    expect(JSON.stringify(result)).toContain("candidate-a");
    expect(JSON.stringify(result)).not.toContain("candidate-b");
    expect(database.workflowAttempt.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "project", toolNodeId: { in: ["tool-a"] } } }));
  });

  it("历史版本补读保留当时的图修订、时间和修改来源，不借用当前节点状态", async () => {
    const { gateway, database, graph } = fixture();
    database.workflowNodeVersion.findMany.mockResolvedValue([
      { id: "version-2", nodeId: "tool-a", version: 2, graphRevision: 3, previousVersionId: "version-1", origin: "user", mutationId: "mutation-3", kind: "tool", type: "generate_design", title: "旧标题", payload: { params: { prompt: "旧冻结要求" } }, inputBindings: [], baseline: false, createdAt: new Date(3_000) },
      { id: "version-1", nodeId: "tool-a", version: 1, graphRevision: 1, previousVersionId: null, origin: "baseline", mutationId: null, kind: "tool", type: "generate_design", title: "初始标题", payload: { params: { prompt: "基线要求" } }, inputBindings: [], baseline: true, createdAt: new Date(1_000) },
    ] as never[]);
    const response = await gateway.read("user", "project", "conversation", graph, { type: "branch_history", ids: ["candidate-a"] });
    expect(response.result).toMatchObject({ data: { versions: [
      { id: "version-2", graphRevision: 3, previousVersionId: "version-1", origin: "user", mutationId: "mutation-3", createdAt: new Date(3_000).toISOString(), content: { title: "旧标题", parameters: { prompt: "旧冻结要求" } } },
      { id: "version-1", graphRevision: 1, previousVersionId: null, origin: "baseline", mutationId: null, createdAt: new Date(1_000).toISOString(), baseline: true },
    ] } });
  });

  it("分支历史按稳定游标继续读取旧版本，显示未读范围而不重复最近窗口", async () => {
    const { gateway, database, graph } = fixture();
    // Use small factual asset versions so the fixed 24,000-character budget can cross a DB page.
    // Full tool provenance and oversized-record continuation are covered independently.
    const rows = Array.from({ length: 65 }, (_, index) => ({ id: `version-${String(65 - index).padStart(3, "0")}`, nodeId: "goal", version: 65 - index,
      graphRevision: 4, kind: "asset", type: "brief", title: "目标", payload: { text: "藏蓝" }, inputBindings: [], baseline: false, createdAt: new Date(1_000) }));
    database.workflowNodeVersion.findMany.mockImplementation(async (...args: unknown[]) => {
      const query = args[0] as { where: { AND?: { OR: ({ id?: { lt: string } })[] }[] }; take: number };
      const before = query.where.AND?.[0]?.OR.find((item) => item.id)?.id?.lt;
      return rows.filter((row) => !before || row.id < before).slice(0, query.take) as never[];
    });
    const seen = new Set<string>();
    let hasMore = true;
    for (let round = 0; round < 3 && hasMore; round += 1) {
      const response = await gateway.read("user", "project", "conversation", graph, { type: "branch_history", ids: ["candidate-a"] });
      const result = response.result as { data: { versions: { id: string }[]; hasMore: boolean; progress: unknown; unread: unknown }; excerpt?: string; remainingCharacters: number };
      expect(result.excerpt).toBeUndefined();
      expect(result.data.progress).toBeDefined();
      expect(result.data.unread).toBeDefined();
      for (const version of result.data.versions) { expect(seen.has(version.id)).toBe(false); seen.add(version.id); }
      hasMore = result.data.hasMore;
      if (result.remainingCharacters < 1_000) break;
    }
    expect(seen.size).toBeGreaterThan(40);
    expect(database.workflowNodeVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: [{ OR: [{ createdAt: { lt: new Date(1_000) } }, { createdAt: new Date(1_000), id: { lt: "version-026" } }] }] }),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }));
  });

  it("大历史记录分片保持字段结构与续读位置，不把 JSON 截成不可恢复的字符串", async () => {
    const { gateway, database, graph } = fixture();
    const inputs = Array.from({ length: 24 }, (_, index) => ({ sourceNodeId: `input-${index}-${"x".repeat(95)}`, sourceNodeVersionId: `immutable-${index}-${"y".repeat(90)}`, sourcePort: "out", targetPort: "reference" }));
    database.workflowNodeVersion.findMany.mockResolvedValue([{ id: "large-version", nodeId: "tool-a", version: 1, kind: "tool", type: "generate_design", title: "大记录", payload: { params: { prompt: "藏蓝".repeat(1_500), negativePrompt: "宽袖".repeat(2_000) } }, inputBindings: inputs, baseline: false, createdAt: new Date(1) }] as never[]);
    const fragments: { collection: string; recordId: string; fields: { path: (string | number)[]; value: unknown; range?: { start: number; end: number; total: number } }[]; complete: boolean }[] = [];
    for (let round = 0; round < 3; round += 1) {
      const response = await gateway.read("user", "project", "conversation", graph, { type: "branch_history", ids: ["candidate-a"] });
      const result = response.result as { data: { fragments: typeof fragments; hasMore: boolean }; excerpt?: string; remainingCharacters: number };
      expect(result.excerpt).toBeUndefined();
      expect(JSON.stringify(result.data).length).toBeLessThanOrEqual(8_000);
      fragments.push(...result.data.fragments.filter((fragment) => fragment.recordId === "large-version"));
      if (!result.data.hasMore) break;
    }
    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments.at(-1)?.complete).toBe(true);
    const fields = fragments.flatMap((fragment) => fragment.fields);
    expect(fields.some((field) => field.range)).toBe(true);
    expect(fields.filter((field) => field.path[0] === "inputBindings" && field.path[2] === "sourceNodeId").map((field) => field.value)).toEqual(inputs.map((input) => input.sourceNodeId));
    const promptParts = fields.filter((field) => field.path.join("/") === "content/parameters/prompt");
    expect(promptParts.map((field) => field.value).join("")).toBe("藏蓝".repeat(1_500));
    const negativeParts = fields.filter((field) => field.path.join("/") === "content/parameters/negativePrompt");
    expect(negativeParts.map((field) => field.value).join("")).toBe("宽袖".repeat(2_000));
  });

  it("请求编号顺序共享续读进度，而项目、图版本与不同分支互不共享", async () => {
    const { gateway, database, graph } = fixture();
    const rows = Array.from({ length: 3 }, (_, index) => ({ id: `v-${index}`, nodeId: "tool-a", version: index + 1, kind: "tool", type: "generate_design", title: "方案", payload: { params: { prompt: "说明".repeat(150) } }, inputBindings: [], baseline: false, createdAt: new Date(30 - index) }));
    database.workflowNodeVersion.findMany.mockResolvedValue(rows as never[]);
    const read = async (target: typeof graph, projectId: string, ids: string[]) => (await gateway.read("user", projectId, "conversation", target, { type: "branch_history", ids })).result as { data: { progress: { versions: { start: number; end: number } } } };
    const first = await read(graph, "project", ["candidate-a", "tool-a"]);
    const continued = await read(graph, "project", ["tool-a", "candidate-a"]);
    expect(continued.data.progress.versions.start).toBe(first.data.progress.versions.end);
    expect(continued.data.progress.versions.start).toBeGreaterThan(0);
    const updated = await read({ ...graph, revision: 5 }, "project", ["candidate-a", "tool-a"]);
    expect(updated.data.progress.versions.start).toBe(0);
    const other = await read({ ...graph, projectId: "other-project" }, "other-project", ["candidate-a", "tool-a"]);
    expect(other.data.progress.versions.start).toBe(0);
    const sibling = await read(graph, "project", ["candidate-b"]);
    expect(sibling.data.progress.versions.start).toBe(0);
  });

  it("执行尝试超过一页时继续读取且保留同一时间下的稳定顺序和总预算", async () => {
    const { gateway, database, graph } = fixture();
    const rows = Array.from({ length: 35 }, (_, index) => ({ id: `attempt-${String(35 - index).padStart(3, "0")}`, toolNodeId: "tool-a", ordinal: 35 - index,
      status: "completed", requestSnapshot: { request: { prompt: `冻结要求-${35 - index}` } }, error: null, createdAt: new Date(1_000) }));
    database.workflowAttempt.findMany.mockImplementation(async (...args: unknown[]) => {
      const query = args[0] as { where: { AND?: { OR: ({ id?: { lt: string } })[] }[] }; take: number };
      const before = query.where.AND?.[0]?.OR.find((item) => item.id)?.id?.lt;
      return rows.filter((row) => !before || row.id < before).slice(0, query.take);
    });
    const recordIds = new Set<string>();
    let read = 0, characters = 0, hasMore = true;
    for (let round = 0; round < 3 && hasMore; round += 1) {
      const response = await gateway.read("user", "project", "conversation", graph, { type: "branch_history", ids: ["candidate-a"] });
      const result = response.result as { data: { attempts: { id: string }[]; fragments: { collection: string; recordId: string }[]; progress: { attempts: { start: number; end: number } }; hasMore: boolean }; remainingCharacters: number };
      expect(result.data.progress.attempts.start).toBe(read);
      expect(JSON.stringify(result.data).length).toBeLessThanOrEqual(8_000);
      characters += JSON.stringify(result.data).length;
      expect(result.remainingCharacters).toBe(24_000 - characters);
      result.data.attempts.forEach((attempt) => recordIds.add(attempt.id));
      result.data.fragments.filter((fragment) => fragment.collection === "attempts").forEach((fragment) => recordIds.add(fragment.recordId));
      read = result.data.progress.attempts.end; hasMore = result.data.hasMore;
    }
    expect(read).toBe(35);
    expect(recordIds.size).toBe(35);
    expect(hasMore).toBe(false);
    expect(database.workflowAttempt.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      AND: [{ OR: [{ createdAt: { lt: new Date(1_000) } }, { createdAt: new Date(1_000), id: { lt: "attempt-006" } }] }],
    }) }));
  });

  it("长原文重复补读会继续后续分段，明确未读范围且累计预算不会超过24000字符", async () => {
    const { gateway, database, graph, visual } = fixture();
    database.agentMessage.findMany.mockResolvedValue([{ id: "message-a", role: "USER", content: `${"说明".repeat(6_000)}尾部更正：不要银色，保留藏蓝色。`, createdAt: new Date(1) }]);
    const first = await gateway.read("user", "project", "conversation", graph, { type: "dialog", ids: ["message-a"] });
    const second = await gateway.read("user", "project", "conversation", graph, { type: "dialog", ids: ["message-a"] });
    expect(JSON.stringify(first)).not.toContain("尾部更正");
    expect(JSON.stringify(second)).toContain("尾部更正");
    expect(first.result).toMatchObject({ data: { messages: [{ hasMore: true, range: { start: 0 } }] } });
    // Consume the remaining per-turn budget with full node details.
    for (let index = 0; index < 100; index += 1) await gateway.read("user", "project", "conversation", graph, { type: "nodes", ids: ["goal"] });
    const exhausted = await gateway.read("user", "project", "conversation", graph, { type: "images", ids: ["candidate-a"] });
    expect(exhausted.result).toMatchObject({ unavailable: true, remainingCharacters: 0 });
    expect(visual.enrich).not.toHaveBeenCalled();
  });
});

describe("initial prompt ablation policy", () => {
  it("初始context、六个slot和旧plan遵守同一消融，保留当前请求和显式事实", () => {
    const context = { currentObjective: "通勤外套", currentTask: "来自旧会话的任务", focusNodeIds: ["old-focus"], referencedNodeIds: ["current-reference"],
      requirements: [{ id: "explicit", origin: "explicit", text: "保留藏蓝" }, { id: "hidden", origin: "inferred", text: "银色猜测" }],
      preferences: [{ id: "hidden", origin: "inferred", text: "银色猜测" }], inactivePreferences: [{ origin: "inferred", text: "停用猜测" }], scopedMemory: [{ id: "hidden", text: "银色猜测" }],
      nodes: [{ id: "candidate", decision: { reason: "历史否决" } }], edges: ["history-edge"], attempts: ["history-attempt"], executions: ["history-execution"],
      dialog: ["history-message"], dialogSummary: { text: "history-summary" }, declinedProposals: ["history-proposal"], objectiveHistory: ["old-goal"],
    };
    const slots = { initialGoal: { requirements: context.requirements }, currentStepGoal: { currentTask: context.currentTask, plan: { text: "旧完整分析" } }, designTrajectory: { nodes: context.nodes, edges: context.edges, episodes: ["old-episode"] }, dialogue: { messages: context.dialog }, implicitIntent: { preferences: context.preferences } };
    const gated = applyWorkflowReadPolicy(context, slots, { text: "旧完整分析" }, { trajectory: false, dialog: false, hiddenIntent: false });
    const output = JSON.stringify(gated);
    for (const secret of ["银色猜测", "停用猜测", "历史否决", "history-edge", "history-attempt", "history-execution", "history-message", "history-summary", "history-proposal", "old-goal", "old-episode", "旧完整分析"]) expect(output).not.toContain(secret);
    expect(gated.context.currentObjective).toBe("通勤外套");
    expect(gated.context.focusNodeIds).toEqual(["current-reference"]);
    expect(output).toContain("保留藏蓝");
    expect(context.dialog).toEqual(["history-message"]);
  });
});
