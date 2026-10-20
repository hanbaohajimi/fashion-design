import { prisma } from "@fashion/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignContextService } from "../design-context/design-context.service";
import { WorkflowsService } from "../workflows/workflows.service";
import { WorkflowRuntimeService } from "./workflow-runtime.service";
import { WorkflowAssistantService } from "./workflow-assistant.service";
import { parsePlannerDecision } from "./workflow-planner";

const workflows = new WorkflowsService(prisma);
const contexts = new DesignContextService(prisma, workflows);
const cleanup: string[] = [];
const reply = { kind: "reply", message: "画布中有两个不同约束的候选分支，可以先比较各自的设计目标。", plan: null, objectiveUpdate: null, preferences: [] };

async function harness() {
  const user = await prisma.user.create({ data: { email: `assistant-${crypto.randomUUID()}@example.com`, ownedWorkspaces: { create: { name: "Assistant test", projects: { create: { name: "Design understanding" } } } } }, include: { ownedWorkspaces: { include: { projects: true } } } });
  cleanup.push(user.id);
  const project = user.ownedWorkspaces[0]?.projects[0];
  if (!project) throw new Error("Test project missing");
  const conversation = await prisma.agentConversation.create({ data: { createdById: user.id, projectId: project.id, title: "新的设计对话", mode: "workflow" } });
  const ids = Object.fromEntries(["brief", "c1", "c2", "g1", "g2", "a", "b", "orphan"].map((key) => [key, crypto.randomUUID()])) as Record<"brief" | "c1" | "c2" | "g1" | "g2" | "a" | "b" | "orphan", string>;
  const nodes = [
    { id: ids.brief, kind: "asset" as const, type: "brief" as const, title: "风衣目标", payload: { text: "设计藏蓝色立领风衣" } },
    { id: ids.c1, kind: "asset" as const, type: "constraint" as const, title: "利落肩线", payload: { text: "保持立领和藏蓝色" } },
    { id: ids.c2, kind: "asset" as const, type: "constraint" as const, title: "宽松肩线", payload: { text: "运动分支宽松肩线" } },
    { id: ids.g1, kind: "tool" as const, type: "generate_design" as const, title: "通勤生成", payload: { toolKey: "generate_design", toolVersion: "1", params: { prompt: "navy standing collar" } } },
    { id: ids.g2, kind: "tool" as const, type: "generate_design" as const, title: "运动生成", payload: { toolKey: "generate_design", toolVersion: "1", params: { prompt: "sport loose shoulder" } } },
    { id: ids.a, kind: "asset" as const, type: "candidate" as const, title: "同名候选", payload: { text: "通勤候选", decision: { kind: "rejected", reason: "袖子仍然太宽" } } },
    { id: ids.b, kind: "asset" as const, type: "candidate" as const, title: "同名候选", payload: { text: "运动候选" } },
    { id: ids.orphan, kind: "asset" as const, type: "reference_text" as const, title: "未连接参考", payload: { text: "独立素材，不是所有工具的输入" } },
  ];
  await workflows.patch(user.id, project.id, { mode: "semantic", mutationId: crypto.randomUUID(), baseRevision: 0, operations: [
    ...nodes.map((node, index) => ({ type: "add_node" as const, node: { ...node, x: index * 300, y: 100, status: "ready" as const } })),
    ...([[ids.c1, ids.g1, "constraint"], [ids.g1, ids.a, "source"], [ids.c2, ids.g2, "constraint"], [ids.g2, ids.b, "source"]] as const).map(([sourceNodeId, targetNodeId, targetPort]) => ({ type: "add_edge" as const, edge: { id: crypto.randomUUID(), sourceNodeId, targetNodeId, sourcePort: "out" as const, targetPort } })),
  ] });
  const model = { generateJson: vi.fn(async (request: { parse: (value: unknown) => unknown }) => request.parse(reply)) };
  const generation = { createFromAgent: vi.fn() };
  const visual = { enrich: vi.fn(async () => ({ index: [], images: [], imageBindings: [], coverage: { total: 0, ready: 0, pending: 0, failed: 0, attachedNodeIds: [], unreadNodeIds: [] } })) };
  const runtime = new WorkflowRuntimeService(prisma, workflows, generation as never, model as never, {} as never, {} as never);
  const assistant = new WorkflowAssistantService(prisma, workflows, runtime, contexts, visual as never, model as never);
  return { user, project, conversation, ids, model, generation, visual, runtime, assistant };
}

function planningReply(goal: string) {
  return { ...parsePlannerDecision(reply), understanding: { currentStepGoal: goal, requestType: "design", changesTask: true, evidenceRefs: [], openQuestions: [] },
    plan: { goal, milestones: [{ id: "review", title: goal, status: "active", completionCriteria: ["设计师确认修改范围"], evidenceRefs: [] }], activeMilestoneId: "review", nextGoal: "根据评价继续调整", completionCriteria: ["完成当前设计目标"] } };
}

async function executionEvent(h: Awaited<ReturnType<typeof harness>>) {
  const execution = await prisma.workflowExecution.create({ data: { projectId: h.project.id, userId: h.user.id, conversationId: h.conversation.id,
    toolNodeId: h.ids.g1, executionKey: crypto.randomUUID(), expectedAttempts: 2, status: "completed", requestSnapshot: {}, completedAt: new Date() } });
  for (const ordinal of [1, 2]) await prisma.workflowAttempt.create({ data: { projectId: h.project.id, executionId: execution.id, toolNodeId: h.ids.g1, ordinal, status: "completed", executionKey: crypto.randomUUID(), requestSnapshot: {} } });
  const event = await prisma.workflowOutbox.create({ data: { projectId: h.project.id, executionId: execution.id, eventKey: `execution:${execution.id}:completed`, eventType: "execution.completed", payload: {} } });
  return { execution, event };
}

afterEach(async () => { for (const id of cleanup.splice(0)) {
  await prisma.workflowAttempt.deleteMany({ where: { project: { workspace: { ownerId: id } } } });
  await prisma.user.delete({ where: { id } });
} });

describe("persistent workflow collaboration", () => {
  it("persists revisable goal plans and turn budgets without scheduling generation", async () => {
    const h = await harness();
    h.model.generateJson.mockImplementation(async (request) => request.parse(planningReply("比较袖型后再修改")));
    await h.assistant.send(h.user.id, h.conversation.id, { clientRequestId: "plan-goal-123", content: "先比较袖型", referencedNodeIds: [h.ids.a] });
    const first = await h.assistant.currentPlan(h.user.id, h.conversation.id);
    expect(first).toMatchObject({ revision: 1, plan: { goal: "比较袖型后再修改", activeMilestoneId: "review" } });
    const turn = await prisma.agentTurn.findFirstOrThrow({ where: { conversationId: h.conversation.id } });
    expect(turn).toMatchObject({ status: "completed", planRevision: 1, budget: { modelCalls: 1, readRounds: 0 } });
    h.model.generateJson.mockImplementation(async (request) => request.parse(planningReply("只修正肩线")));
    await h.assistant.send(h.user.id, h.conversation.id, { clientRequestId: "plan-revise-123", content: "改为只修正肩线", referencedNodeIds: [h.ids.a] });
    expect(await h.assistant.currentPlan(h.user.id, h.conversation.id)).toMatchObject({ revision: 2, plan: { goal: "只修正肩线" } });
    expect(await prisma.agentPlanRevision.count({ where: { conversationId: h.conversation.id } })).toBe(2);
    expect(h.generation.createFromAgent).not.toHaveBeenCalled();
  });

  it("analyzes one multi-candidate execution only once and initializes a conversation with no earlier messages", async () => {
    const h = await harness();
    const { event, execution } = await executionEvent(h);
    h.model.generateJson.mockImplementation(async (request) => request.parse(planningReply("根据两个候选确认袖型")));
    expect(await h.assistant.observeExecution(event.id)).toBe("completed");
    expect(await h.assistant.observeExecution(event.id)).toBe("completed");
    expect(h.model.generateJson).toHaveBeenCalledOnce();
    const messages = await h.assistant.messages(h.user.id, h.conversation.id, { limit: 50 });
    expect(messages.items.filter((item) => item.origin === "execution_result")).toHaveLength(1);
    expect(messages.items.filter((item) => item.origin === "background_analysis")).toHaveLength(1);
    expect(messages.items.every((item) => item.executionId === execution.id)).toBe(true);
    expect(await prisma.agentTurn.count({ where: { sourceEventId: event.id } })).toBe(1);
    expect(h.generation.createFromAgent).not.toHaveBeenCalled();
  });

  it("lets a foreground request supersede background analysis and prevents its older plan from committing", async () => {
    const h = await harness();
    const { event } = await executionEvent(h);
    let finish!: (value: unknown) => void;
    let start!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    h.model.generateJson.mockImplementationOnce(async (request) => { start(); return request.parse(await new Promise((resolve) => { finish = resolve; })); });
    const background = h.assistant.observeExecution(event.id);
    await started;
    h.model.generateJson.mockImplementation(async (request) => request.parse(planningReply("用户指定的新任务")));
    const foreground = await h.assistant.send(h.user.id, h.conversation.id, { clientRequestId: "foreground-priority-123", content: "先处理新的肩线要求", referencedNodeIds: [h.ids.a] });
    expect(foreground.assistantMessage.status).toBe("completed");
    finish(planningReply("已经过时的后台任务"));
    expect(await background).toBe("superseded");
    expect(await h.assistant.currentPlan(h.user.id, h.conversation.id)).toMatchObject({ revision: 1, plan: { goal: "用户指定的新任务" } });
    expect(await prisma.agentMessage.count({ where: { conversationId: h.conversation.id, origin: "background_analysis" } })).toBe(0);
  });

  it("supersedes background analysis after a manual correction while retaining its execution receipt", async () => {
    const h = await harness();
    const { event } = await executionEvent(h);
    let finish!: (value: unknown) => void;
    let start!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    h.model.generateJson.mockImplementationOnce(async (request) => { start(); return request.parse(await new Promise((resolve) => { finish = resolve; })); });
    const background = h.assistant.observeExecution(event.id);
    await started;
    const current = await h.assistant.getContext(h.user.id, h.conversation.id);
    await h.assistant.correctContext(h.user.id, h.conversation.id, { baseRevision: current.revision, mutationId: crypto.randomUUID(), currentObjective: "用户纠正后的银色系列" });
    finish(planningReply("过时的藏蓝目标"));
    expect(await background).toBe("superseded");
    expect((await h.assistant.getContext(h.user.id, h.conversation.id)).currentObjective).toBe("用户纠正后的银色系列");
    expect(await prisma.agentPlanRevision.count({ where: { conversationId: h.conversation.id } })).toBe(0);
    expect(await prisma.agentMessage.count({ where: { conversationId: h.conversation.id, origin: "execution_result" } })).toBe(1);
    expect(await prisma.agentMessage.count({ where: { conversationId: h.conversation.id, origin: "background_analysis" } })).toBe(0);
  });

  it("defers duplicate concurrent observations and never publishes two analyses for one event", async () => {
    const h = await harness();
    const { event } = await executionEvent(h);
    let finish!: (value: unknown) => void;
    let start!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    h.model.generateJson.mockImplementationOnce(async (request) => { start(); return request.parse(await new Promise((resolve) => { finish = resolve; })); });
    const first = h.assistant.observeExecution(event.id);
    await started;
    expect(await h.assistant.observeExecution(event.id)).toBe("deferred");
    finish(reply);
    expect(await first).toBe("completed");
    expect(await h.assistant.observeExecution(event.id)).toBe("completed");
    expect(h.model.generateJson).toHaveBeenCalledOnce();
    expect(await prisma.agentMessage.count({ where: { conversationId: h.conversation.id, origin: "background_analysis", sourceEventId: event.id } })).toBe(1);
  });
  it("answers a whole-canvas question without proposing or executing a tool and replays it safely", async () => {
    const h = await harness();
    const request = { clientRequestId: "summary-request-123", content: "总结整个画布和设计进度", referencedNodeIds: [] };
    const result = await h.assistant.send(h.user.id, h.conversation.id, request);
    expect(result.assistantMessage).toMatchObject({ kind: "reply", status: "completed", proposal: null });
    const modelInput = h.model.generateJson.mock.calls[0]?.[0] as unknown as { prompt: string };
    const input = JSON.parse(modelInput.prompt);
    expect(input.context.nodes.map((node: { id: string }) => node.id)).toEqual(expect.arrayContaining(Object.values(h.ids)));
    expect(input.context.edges).toHaveLength(4);
    expect(modelInput.prompt).toContain("袖子仍然太宽");
    expect(await prisma.workflowProposal.count({ where: { projectId: h.project.id } })).toBe(0);
    expect(await prisma.workflowAttempt.count({ where: { projectId: h.project.id } })).toBe(0);
    expect(h.generation.createFromAgent).not.toHaveBeenCalled();
    const replay = await h.assistant.send(h.user.id, h.conversation.id, request);
    expect(replay.assistantMessage.id).toBe(result.assistantMessage.id);
    expect(h.model.generateJson).toHaveBeenCalledOnce();
    await expect(h.assistant.send(h.user.id, h.conversation.id, { ...request, content: "不同内容" })).rejects.toThrow("请求编号");
    expect(JSON.stringify(replay)).not.toContain("requestFingerprint");
    expect((await h.assistant.messages(h.user.id, h.conversation.id, { limit: 50 })).items).toHaveLength(2);
  });

  it("persists a model-chosen proposal; acceptance adds only its explicit inputs and never generates", async () => {
    const h = await harness();
    h.model.generateJson.mockImplementation(async (request) => request.parse({ ...reply, kind: "propose", message: "建议只收窄通勤候选袖子", plan: { tool: "edit_design", title: "收窄袖子", prompt: "保持立领和藏蓝色，只收窄袖子", rationale: "候选被否决是因为袖子太宽", newObjective: null, inputs: [{ nodeId: h.ids.a, port: "source" }, { nodeId: h.ids.c1, port: "constraint" }] } }));
    const result = await h.assistant.send(h.user.id, h.conversation.id, { clientRequestId: "edit-request-123", content: "收窄这件风衣的袖子", referencedNodeIds: [h.ids.a] });
    expect(result.assistantMessage.status).toBe("completed");
    const proposal = result.assistantMessage.proposal;
    if (!proposal) throw new Error(`Expected proposal: ${JSON.stringify(result.assistantMessage)}`);
    const updated = await h.runtime.accept(h.user.id, h.project.id, proposal.id, { mutationId: crypto.randomUUID(), baseRevision: proposal.baseRevision });
    expect(updated.nodes).toHaveLength(9);
    expect(updated.edges).toHaveLength(6);
    expect(h.generation.createFromAgent).not.toHaveBeenCalled();
    const messages = await h.assistant.messages(h.user.id, h.conversation.id, { limit: 50 });
    expect(messages.items.at(-1)?.proposal?.status).toBe("accepted");
  });

  it("corrects a project goal across conversations while preserving history and invalidating older proposals", async () => {
    const h = await harness();
    const current = await h.assistant.getContext(h.user.id, h.conversation.id);
    const pending = await prisma.workflowProposal.create({ data: { userId: h.user.id, projectId: h.project.id, conversationId: h.conversation.id, contextRevision: current.revision, baseRevision: current.graphRevision, diff: [], evidence: {}, mutationId: crypto.randomUUID() } });
    await h.assistant.correctContext(h.user.id, h.conversation.id, { baseRevision: current.revision, summaryRevision: current.summaryRevision, mutationId: crypto.randomUUID(), currentObjective: "改为银色立领外套系列", focusNodeIds: [h.ids.a] });
    const other = await prisma.agentConversation.create({ data: { createdById: h.user.id, projectId: h.project.id, title: "另一个会话", mode: "workflow" } });
    const otherContext = await h.assistant.getContext(h.user.id, other.id);
    expect(otherContext.currentObjective).toBe("改为银色立领外套系列");
    expect(otherContext.focusNodeIds).toEqual([]);
    expect(otherContext.history).toHaveLength(1);
    await expect(h.runtime.accept(h.user.id, h.project.id, pending.id, { baseRevision: pending.baseRevision, mutationId: crypto.randomUUID() })).rejects.toThrow();
    expect((await workflows.get(h.user.id, h.project.id)).revision).toBe(current.graphRevision);
  });

  it("serializes conversation turns and discards a late response after context correction", async () => {
    const h = await harness();
    let resolveModel!: (value: unknown) => void;
    let started!: () => void;
    const modelStarted = new Promise<void>((resolve) => { started = resolve; });
    h.model.generateJson.mockImplementation(async (request) => { started(); return request.parse(await new Promise((resolve) => { resolveModel = resolve; })); });
    const running = h.assistant.send(h.user.id, h.conversation.id, { clientRequestId: "slow-request-123", content: "理解当前过程", referencedNodeIds: [] });
    await modelStarted;
    await expect(h.assistant.send(h.user.id, h.conversation.id, { clientRequestId: "parallel-request-123", content: "第二条请求", referencedNodeIds: [] })).rejects.toThrow("上一条消息");
    const profile = await contexts.get(h.user.id, h.project.id);
    await contexts.patch(h.user.id, h.project.id, { baseRevision: profile.revision, operations: [{ type: "set_objective", text: "新的明确目标" }] });
    resolveModel(reply);
    expect((await running).assistantMessage.status).toBe("failed");
    expect((await contexts.get(h.user.id, h.project.id)).state.currentObjective).toBe("新的明确目标");
  });

  it("repairs a bad invocation at most once before returning a clarification", async () => {
    const h = await harness();
    h.model.generateJson.mockImplementation(async (request) => request.parse({ ...reply, kind: "propose", plan: { tool: "edit_design", title: "修改", prompt: "修改袖子", rationale: "根据反馈", newObjective: null, inputs: [{ nodeId: "foreign-node", port: "source" }] } }));
    const result = await h.assistant.send(h.user.id, h.conversation.id, { clientRequestId: "invalid-tool-123", content: "修改袖子", referencedNodeIds: [h.ids.a] });
    expect(result.assistantMessage).toMatchObject({ kind: "clarify", proposal: null, status: "completed" });
    expect(h.model.generateJson).toHaveBeenCalledTimes(2);
    expect(await prisma.workflowProposal.count({ where: { projectId: h.project.id } })).toBe(0);
  });

  it("repairs malformed structured output once without executing anything", async () => {
    const h = await harness();
    h.model.generateJson.mockImplementationOnce(async (request) => request.parse({ kind: "unsupported", message: "bad" }));
    const result = await h.assistant.send(h.user.id, h.conversation.id, { clientRequestId: "schema-repair-123", content: "解释设计过程", referencedNodeIds: [] });
    expect(result.assistantMessage).toMatchObject({ status: "completed", kind: "reply", proposal: null });
    expect(h.model.generateJson).toHaveBeenCalledTimes(2);
  });

  it("marks an exhausted response-format failure as retryable instead of asking for unrelated design clarification", async () => {
    const h = await harness();
    h.model.generateJson.mockRejectedValue(new Error("Amux Claude 返回的内容不是有效 JSON"));
    const request = { clientRequestId: "invalid-json-123", content: "总结设计过程", referencedNodeIds: [] };
    const result = await h.assistant.send(h.user.id, h.conversation.id, request);
    expect(result.assistantMessage).toMatchObject({ status: "failed", proposal: null, kind: null });
    expect(h.model.generateJson).toHaveBeenCalledTimes(2);
    h.model.generateJson.mockImplementation(async (input) => input.parse(reply));
    const retried = await h.assistant.send(h.user.id, h.conversation.id, request);
    expect(retried.assistantMessage).toMatchObject({ id: result.assistantMessage.id, status: "completed", kind: "reply" });
    expect((await h.assistant.messages(h.user.id, h.conversation.id, { limit: 50 })).items).toHaveLength(2);
  });

  it("does not commit an old goal after focus has been corrected during model analysis", async () => {
    const h = await harness();
    let finish!: (value: unknown) => void;
    let start!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    h.model.generateJson.mockImplementationOnce(async (request) => { start(); return request.parse(await new Promise((resolve) => { finish = resolve; })); });
    const waiting = h.assistant.send(h.user.id, h.conversation.id, { clientRequestId: "focus-correction-123", content: "项目目标改成银色外套", referencedNodeIds: [h.ids.a] });
    await started;
    const context = await h.assistant.getContext(h.user.id, h.conversation.id);
    await h.assistant.correctContext(h.user.id, h.conversation.id, { baseRevision: context.revision, summaryRevision: context.summaryRevision, mutationId: crypto.randomUUID(), focusNodeIds: [h.ids.b] });
    finish({ ...reply, objectiveUpdate: { text: "银色外套", sourceQuote: "项目目标改成银色外套" } });
    expect((await waiting).assistantMessage.status).toBe("failed");
    expect((await contexts.get(h.user.id, h.project.id)).state.currentObjective).toBe("设计藏蓝色立领风衣");
    expect(await prisma.projectDesignContextRevision.count({ where: { projectId: h.project.id } })).toBe(0);
  });

  it("cannot write project memory after a timed-out turn has been replaced", async () => {
    const h = await harness();
    let finish!: (value: unknown) => void;
    let start!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    h.model.generateJson.mockImplementationOnce(async (request) => { start(); return request.parse(await new Promise((resolve) => { finish = resolve; })); });
    const old = h.assistant.send(h.user.id, h.conversation.id, { clientRequestId: "expired-turn-123", content: "项目目标改成银色外套", referencedNodeIds: [] });
    await started;
    const expired = new Date(Date.now() - 16 * 60_000);
    await prisma.agentConversation.update({ where: { id: h.conversation.id }, data: { activeTurnStartedAt: expired } });
    await prisma.agentMessage.updateMany({ where: { conversationId: h.conversation.id, status: "PENDING" }, data: { updatedAt: expired } });
    const replacement = await h.assistant.send(h.user.id, h.conversation.id, { clientRequestId: "replacement-turn-123", content: "继续理解原来的藏蓝色目标", referencedNodeIds: [] });
    expect(replacement.assistantMessage.status).toBe("completed");
    finish({ ...reply, objectiveUpdate: { text: "银色外套", sourceQuote: "项目目标改成银色外套" } });
    expect((await old).assistantMessage.status).toBe("failed");
    expect((await contexts.get(h.user.id, h.project.id)).state.currentObjective).toBe("设计藏蓝色立领风衣");
  });

  it("does not fail a same-request retry when the older timed-out model response arrives first", async () => {
    const h = await harness();
    const resolvers: Array<(value: unknown) => void> = [];
    h.model.generateJson.mockImplementation(async (request) => request.parse(await new Promise((resolve) => { resolvers.push(resolve); })));
    const request = { clientRequestId: "same-request-retry-123", content: "总结设计过程", referencedNodeIds: [] };
    const older = h.assistant.send(h.user.id, h.conversation.id, request);
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));
    const expired = new Date(Date.now() - 16 * 60_000);
    await prisma.agentConversation.update({ where: { id: h.conversation.id }, data: { activeTurnStartedAt: expired } });
    await prisma.agentMessage.updateMany({ where: { conversationId: h.conversation.id, status: "PENDING" }, data: { updatedAt: expired } });
    const retried = h.assistant.send(h.user.id, h.conversation.id, request);
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[0]?.(reply);
    await older;
    expect((await h.assistant.messages(h.user.id, h.conversation.id, { limit: 50 })).items.at(-1)?.status).toBe("pending");
    expect(await prisma.agentTurn.findFirstOrThrow({ where: { conversationId: h.conversation.id } })).toMatchObject({ status: "running", budget: { modelCalls: 2 } });
    resolvers[1]?.(reply);
    expect((await retried).assistantMessage.status).toBe("completed");
    expect(await prisma.agentTurn.findFirstOrThrow({ where: { conversationId: h.conversation.id } })).toMatchObject({ status: "completed", budget: { modelCalls: 2 } });
    expect((await h.assistant.messages(h.user.id, h.conversation.id, { limit: 50 })).items).toHaveLength(2);
  });

  it("keeps one durable five-call budget across repeated transport-failure retries", async () => {
    const h = await harness();
    h.model.generateJson.mockRejectedValue(new Error("ECONNREFUSED"));
    const request = { clientRequestId: "shared-budget-retry-123", content: "总结当前画布", referencedNodeIds: [] };
    for (let retry = 0; retry < 6; retry += 1) {
      const result = await h.assistant.send(h.user.id, h.conversation.id, request);
      expect(result.assistantMessage.status).toBe("failed");
      if (retry >= 4) expect(result.assistantMessage.error?.code).toBe("WORKFLOW_BUDGET_EXHAUSTED");
    }
    expect(h.model.generateJson).toHaveBeenCalledTimes(5);
    expect(await prisma.agentTurn.findFirstOrThrow({ where: { conversationId: h.conversation.id } })).toMatchObject({ status: "failed", budget: { modelCalls: 5 } });
    expect(await prisma.agentTurn.count({ where: { conversationId: h.conversation.id } })).toBe(1);
    expect(await prisma.agentMessage.count({ where: { conversationId: h.conversation.id } })).toBe(2);
    expect(h.generation.createFromAgent).not.toHaveBeenCalled();
  });

  it("retains a late execution receipt but does not replan after the designer has completed a newer request", async () => {
    const h = await harness();
    const { event, execution } = await executionEvent(h);
    await prisma.workflowExecution.update({ where: { id: execution.id }, data: { intentEpoch: 0 } });
    h.model.generateJson.mockImplementation(async (request) => request.parse(planningReply("用户的新目标")));
    await h.assistant.send(h.user.id, h.conversation.id, { clientRequestId: "newer-intent-123", content: "先讨论新的通勤目标", referencedNodeIds: [] });
    expect(await h.assistant.observeExecution(event.id)).toBe("superseded");
    expect(h.model.generateJson).toHaveBeenCalledOnce();
    expect(await h.assistant.currentPlan(h.user.id, h.conversation.id)).toMatchObject({ revision: 1, plan: { goal: "用户的新目标" } });
    expect(await prisma.agentMessage.count({ where: { conversationId: h.conversation.id, origin: "execution_result" } })).toBe(1);
    expect(await prisma.agentMessage.count({ where: { conversationId: h.conversation.id, origin: "background_analysis" } })).toBe(0);
    expect(await prisma.agentTurn.findUniqueOrThrow({ where: { sourceEventId: event.id } })).toMatchObject({ status: "superseded" });
  });

  it("keeps proposal state and graph atomic when accept races reject", async () => {
    const h = await harness();
    h.model.generateJson.mockImplementation(async (request) => request.parse({ ...reply, kind: "propose", plan: { tool: "edit_design", title: "收窄袖子", prompt: "保留立领和藏蓝色，收窄袖子", rationale: "修复袖宽", newObjective: null, inputs: [{ nodeId: h.ids.a, port: "source" }, { nodeId: h.ids.c1, port: "constraint" }] } }));
    const result = await h.assistant.send(h.user.id, h.conversation.id, { clientRequestId: "decision-race-123", content: "收窄袖子", referencedNodeIds: [h.ids.a] });
    const proposal = result.assistantMessage.proposal;
    if (!proposal) throw new Error("Expected proposal");
    await Promise.allSettled([
      h.runtime.accept(h.user.id, h.project.id, proposal.id, { mutationId: crypto.randomUUID(), baseRevision: proposal.baseRevision }),
      h.runtime.reject(h.user.id, h.project.id, proposal.id, { mutationId: crypto.randomUUID() }),
    ]);
    const stored = await prisma.workflowProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    const updated = await workflows.get(h.user.id, h.project.id);
    expect(["accepted", "rejected"]).toContain(stored.status);
    expect(updated.nodes).toHaveLength(stored.status === "accepted" ? 9 : 8);
    expect(h.generation.createFromAgent).not.toHaveBeenCalled();
  });

  it("replays a completed response even after its original referenced node has been removed", async () => {
    const h = await harness();
    const request = { clientRequestId: "deleted-ref-replay-123", content: "解释这个独立参考", referencedNodeIds: [h.ids.orphan] };
    const first = await h.assistant.send(h.user.id, h.conversation.id, request);
    const graph = await workflows.get(h.user.id, h.project.id);
    await workflows.patch(h.user.id, h.project.id, { mode: "semantic", baseRevision: graph.revision, mutationId: crypto.randomUUID(), operations: [{ type: "remove_node", nodeId: h.ids.orphan }] });
    expect((await h.assistant.send(h.user.id, h.conversation.id, request)).assistantMessage.id).toBe(first.assistantMessage.id);
    expect(h.model.generateJson).toHaveBeenCalledOnce();
  });

  it("cannot revive a timed-out FAILED response or write memory even without a replacement turn", async () => {
    const h = await harness();
    let finish!: (value: unknown) => void;
    let start!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    h.model.generateJson.mockImplementationOnce(async (request) => { start(); return request.parse(await new Promise((resolve) => { finish = resolve; })); });
    const running = h.assistant.send(h.user.id, h.conversation.id, { clientRequestId: "timeout-no-retry-123", content: "项目目标改成银色外套", referencedNodeIds: [] });
    await started;
    const expired = new Date(Date.now() - 16 * 60_000);
    await prisma.agentConversation.update({ where: { id: h.conversation.id }, data: { activeTurnStartedAt: expired } });
    await prisma.agentMessage.updateMany({ where: { conversationId: h.conversation.id, status: "PENDING" }, data: { updatedAt: expired } });
    expect((await h.assistant.messages(h.user.id, h.conversation.id, { limit: 50 })).items.at(-1)?.status).toBe("failed");
    finish({ ...reply, objectiveUpdate: { text: "银色外套", sourceQuote: "项目目标改成银色外套" } });
    expect((await running).assistantMessage.status).toBe("failed");
    expect((await contexts.get(h.user.id, h.project.id)).state.currentObjective).toBe("设计藏蓝色立领风衣");
    expect(await prisma.projectDesignContextRevision.count({ where: { projectId: h.project.id } })).toBe(0);
  });

  it("replays a combined correction atomically and rejects a stale focus without partially changing the goal", async () => {
    const h = await harness();
    const before = await h.assistant.getContext(h.user.id, h.conversation.id);
    const request = { baseRevision: before.revision, summaryRevision: before.summaryRevision, mutationId: crypto.randomUUID(), currentObjective: "银色外套系列", focusNodeIds: [h.ids.a] };
    const updated = await h.assistant.correctContext(h.user.id, h.conversation.id, request);
    expect((await h.assistant.correctContext(h.user.id, h.conversation.id, request)).summaryRevision).toBe(updated.summaryRevision);
    await expect(h.assistant.correctContext(h.user.id, h.conversation.id, { ...request, mutationId: crypto.randomUUID(), currentObjective: "旧窗口的过期目标", focusNodeIds: [h.ids.b] })).rejects.toThrow("焦点已更新");
    const current = await h.assistant.getContext(h.user.id, h.conversation.id);
    expect(current.currentObjective).toBe("银色外套系列");
    expect(current.focusNodeIds).toEqual([h.ids.a]);
    expect(current.history).toHaveLength(1);
    await expect(h.assistant.correctContext(h.user.id, h.conversation.id, { baseRevision: current.revision, summaryRevision: current.summaryRevision, mutationId: crypto.randomUUID(), currentObjective: "必须回滚的目标", disabledPreferenceIds: ["missing-preference"] })).rejects.toThrow();
    expect((await contexts.get(h.user.id, h.project.id)).state.currentObjective).toBe("银色外套系列");
  });

  it("ignores planner-mined preferences and does not restore an independently stored disabled inference", async () => {
    const h = await harness();
    for (const toolNodeId of [h.ids.g1, h.ids.g2]) for (const ordinal of [1, 2]) await prisma.workflowAttempt.create({ data: { projectId: h.project.id, toolNodeId, ordinal, status: "completed", executionKey: crypto.randomUUID(), requestSnapshot: { params: { prompt: "navy standing collar" } } } });
    h.model.generateJson.mockImplementationOnce(async (request) => request.parse({ ...reply, preferences: [{ text: "来自另一分支的偏好", sourceNodeIds: [h.ids.g2], sourceQuote: "sport loose shoulder" }] }));
    await h.assistant.send(h.user.id, h.conversation.id, { clientRequestId: "cross-branch-memory-123", content: "继续讨论通勤分支", referencedNodeIds: [h.ids.a] });
    expect((await contexts.get(h.user.id, h.project.id)).state.preferences).toHaveLength(0);
    const preference = { text: "可能偏好立领", sourceNodeIds: [h.ids.g1], sourceQuote: "navy standing collar" };
    h.model.generateJson.mockImplementation(async (request) => request.parse({ ...reply, preferences: [preference] }));
    await h.assistant.send(h.user.id, h.conversation.id, { clientRequestId: "scoped-memory-123", content: "沿此分支继续讨论", referencedNodeIds: [h.ids.a] });
    const notMined = await contexts.get(h.user.id, h.project.id);
    expect(notMined.state.preferences).toHaveLength(0);
    await contexts.patch(h.user.id, h.project.id, { baseRevision: notMined.revision, operations: [{ type: "upsert_item", item: {
      id: "independent-preference", kind: "preference", text: preference.text, sourceNodeIds: preference.sourceNodeIds,
      sourceQuote: preference.sourceQuote, origin: "inferred", scope: "branch", branchNodeIds: [h.ids.a],
    } }] });
    const stored = await contexts.get(h.user.id, h.project.id);
    expect(stored.state.preferences[0]).toMatchObject({ scope: "branch", branchNodeIds: [h.ids.a], origin: "inferred", priority: "prefer" });
    expect((await contexts.build(h.user.id, h.project.id, { focusNodeIds: [h.ids.b] })).context.preferences).toHaveLength(0);
    const saved = stored.state.preferences[0];
    if (!saved) throw new Error("Missing inferred preference");
    await h.assistant.correctContext(h.user.id, h.conversation.id, { baseRevision: stored.revision, mutationId: crypto.randomUUID(), disabledPreferenceIds: [saved.id] });
    await h.assistant.send(h.user.id, h.conversation.id, { clientRequestId: "disabled-memory-123", content: "继续当前分支", referencedNodeIds: [h.ids.a] });
    expect((await contexts.get(h.user.id, h.project.id)).state.preferences.filter((item) => item.status === "active")).toHaveLength(0);
  });
});
