import { appendGenerationTerminalOutbox, prisma } from "@fashion/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowsService } from "../workflows/workflows.service";
import { DesignContextService } from "../design-context/design-context.service";
import { WorkflowRuntimeService } from "./workflow-runtime.service";
import { WorkflowAssistantService } from "./workflow-assistant.service";
import { WorkflowOutboxConsumer } from "./workflow-outbox.consumer";

const workflows = new WorkflowsService(prisma);
const users: string[] = [];
function required<T>(value: T | undefined | null): T { if (value == null) throw new Error("Test fixture missing"); return value; }
const visual = { enrich: async () => ({ index: [], images: [], imageBindings: [], coverage: { total: 0, ready: 0, pending: 0, failed: 0, attachedNodeIds: [], unreadNodeIds: [] } }) };
async function harness(count = 2) {
  const user = await prisma.user.create({ data: { email: `outbox-${crypto.randomUUID()}@example.com`, ownedWorkspaces: { create: { name: "Recovery", projects: { create: { name: "Design" } } } } }, include: { ownedWorkspaces: { include: { projects: true } } } });
  users.push(user.id);
  const project = required(required(user.ownedWorkspaces[0]).projects[0]);
  const conversation = await prisma.agentConversation.create({ data: { projectId: project.id, createdById: user.id, mode: "workflow", title: "执行发起会话" } });
  const constraintId = crypto.randomUUID(), toolId = crypto.randomUUID();
  await workflows.patch(user.id, project.id, { mode: "semantic", baseRevision: 0, mutationId: crypto.randomUUID(), operations: [
    { type: "add_node", node: { id: constraintId, kind: "asset", type: "constraint", title: "通勤分支", payload: { text: "保留立领" }, x: 0, y: 0 } },
    { type: "add_node", node: { id: toolId, kind: "tool", type: "generate_design", title: "生成", payload: { toolKey: "generate_design", toolVersion: "1", params: { prompt: "navy coat", count, width: 1024, height: 1536, quality: "auto", negativePrompt: "no lettering" } }, x: 400, y: 0 } },
    { type: "add_edge", edge: { id: crypto.randomUUID(), sourceNodeId: constraintId, targetNodeId: toolId, sourcePort: "out", targetPort: "constraint" } },
  ] });
  const generation = {
    createFromAgent: vi.fn(async (_user: string, request: { projectId: string }, executionKey: string) => {
      const existing = await prisma.workflowAttempt.findUniqueOrThrow({ where: { executionKey } });
      if (existing.generationTaskId) return { taskId: existing.generationTaskId };
      const task = await prisma.generationTask.create({ data: { userId: user.id, projectId: request.projectId, taskType: "t2i", status: "RUNNING", input: {} } });
      return { taskId: task.id };
    }),
    get: vi.fn(async (_user: string, id: string) => {
      const task = await prisma.generationTask.findUniqueOrThrow({ where: { id } });
      return { id, status: task.status.toLowerCase(), output: task.output, error: task.errorCode ? { message: task.errorCode } : null };
    }),
  };
  const model = { generateJson: vi.fn(async (request: { parse: (value: unknown) => unknown }) => request.parse({ kind: "reply", message: "本次执行结果已结合实际分支记录，等待设计师确认。", plan: null, objectiveUpdate: null, preferences: [] })) };
  const contexts = new DesignContextService(prisma, workflows);
  const runtime = new WorkflowRuntimeService(prisma, workflows, generation as never, model as never, {} as never, {} as never, contexts);
  const assistant = new WorkflowAssistantService(prisma, workflows, runtime, contexts, visual as never, model as never);
  const miner = { processChanges: vi.fn(async () => ({ status: "skipped" })) };
  const consumer = new WorkflowOutboxConsumer(prisma, runtime, assistant, miner as never);
  const mutationId = crypto.randomUUID();
  await runtime.execute(user.id, project.id, toolId, { mutationId, conversationId: conversation.id });
  const execution = await prisma.workflowExecution.findFirstOrThrow({ where: { projectId: project.id } });
  const attempts = await prisma.workflowAttempt.findMany({ where: { executionId: execution.id }, orderBy: { ordinal: "asc" } });
  async function terminal(index: number, status: "SUCCEEDED" | "FAILED" | "CANCELED" | "MODERATION_FAILED" = "SUCCEEDED") {
    const attempt = required(attempts[index]);
    const taskId = required(attempt.generationTaskId);
    await prisma.$transaction(async (tx) => {
      const assetId = crypto.randomUUID();
      if (status === "SUCCEEDED") await tx.designAsset.create({ data: { id: assetId, rootAssetId: assetId, generationTaskId: taskId, projectId: project.id, operation: "GENERATED", url: `s3://test/${assetId}.png`, width: 1024, height: 1536 } });
      await tx.generationTask.update({ where: { id: taskId }, data: { status, ...(status === "SUCCEEDED" ? { output: { images: [{ assetId, width: 1024, height: 1536 }] } } : { errorCode: status }) } });
      await appendGenerationTerminalOutbox(tx, { taskId, status });
    });
  }
  return { user, project, conversation, toolId, runtime, assistant, consumer, generation, model, execution, attempts, terminal, mutationId };
}
afterEach(async () => { for (const id of users.splice(0)) await prisma.user.delete({ where: { id } }); });

describe("durable workflow execution observations", () => {
  it("freezes four exact parameterized attempts and analyzes the complete group once without a browser", async () => {
    const h = await harness(4);
    expect(h.attempts).toHaveLength(4);
    expect(h.attempts.every((attempt) => attempt.nodeVersionId === h.execution.nodeVersionId)).toBe(true);
    const snapshot = required(h.attempts[0]).requestSnapshot as { request: unknown; params: unknown };
    expect(snapshot.request).toMatchObject({ width: 1024, height: 1536, quality: "auto", negativePrompt: "no lettering" });
    expect(snapshot.params).toMatchObject({ count: 4 });
    await h.terminal(3);
    await h.consumer.drainFacts();
    expect(await prisma.workflowOutbox.count({ where: { executionId: h.execution.id, eventType: "execution.terminal" } })).toBe(0);
    for (const index of [1, 0, 2]) await h.terminal(index);
    await Promise.all([h.consumer.drainFacts(), h.consumer.drainFacts()]);
    await h.consumer.drainObservations();
    expect(await prisma.workflowOutbox.findFirst({ where: { executionId: h.execution.id, eventType: "execution.terminal" } })).toMatchObject({ status: "completed", lastError: null });
    const graph = await workflows.get(h.user.id, h.project.id);
    expect(graph.nodes.filter((node) => node.type === "candidate")).toHaveLength(4);
    expect(await prisma.workflowOutbox.count({ where: { executionId: h.execution.id, eventType: "execution.terminal" } })).toBe(1);
    expect(await prisma.agentMessage.count({ where: { conversationId: h.conversation.id, origin: "execution_result" } })).toBe(1);
    expect(await prisma.agentMessage.count({ where: { conversationId: h.conversation.id, origin: "background_analysis" } })).toBe(1);
    expect(h.model.generateJson).toHaveBeenCalledOnce();
    await h.consumer.reconcile();
    await h.consumer.drainObservations();
    await h.runtime.execute(h.user.id, h.project.id, h.toolId, { mutationId: h.mutationId, conversationId: h.conversation.id });
    expect(h.generation.createFromAgent).toHaveBeenCalledTimes(4);
    expect(h.model.generateJson).toHaveBeenCalledOnce();
  });

  it("recovers a lost wakeup and expired lease after a restart with duplicate terminal events", async () => {
    const h = await harness(1);
    await h.terminal(0);
    await prisma.workflowOutbox.updateMany({ where: { projectId: h.project.id }, data: { status: "processing", leaseToken: "dead-api", leaseExpiresAt: new Date(Date.now() - 1_000) } });
    await prisma.$transaction((tx) => appendGenerationTerminalOutbox(tx, { taskId: required(required(h.attempts[0]).generationTaskId), status: "SUCCEEDED" }));
    await h.consumer.reconcile();
    await h.consumer.drainFacts();
    await h.consumer.drainObservations();
    expect((await workflows.get(h.user.id, h.project.id)).nodes.filter((node) => node.type === "candidate")).toHaveLength(1);
    expect(await prisma.workflowOutbox.count({ where: { executionId: h.execution.id, eventType: "generation.terminal" } })).toBe(1);
    expect(h.model.generateJson).toHaveBeenCalledOnce();
  });

  it("keeps assets and the fact receipt when model analysis fails; no generation is retried", async () => {
    const h = await harness(2);
    h.model.generateJson.mockRejectedValue(new Error("provider unavailable"));
    await h.terminal(0);
    await h.terminal(1, "MODERATION_FAILED");
    await h.consumer.drainFacts();
    await h.consumer.drainObservations();
    expect((await prisma.workflowExecution.findUniqueOrThrow({ where: { id: h.execution.id } })).status).toBe("partial_failed");
    expect((await workflows.get(h.user.id, h.project.id)).nodes.filter((node) => node.type === "candidate")).toHaveLength(1);
    expect(await prisma.agentMessage.count({ where: { conversationId: h.conversation.id, origin: "execution_result" } })).toBe(1);
    expect(await prisma.agentMessage.count({ where: { conversationId: h.conversation.id, origin: "background_analysis" } })).toBe(0);
    expect(await prisma.workflowOutbox.findFirst({ where: { executionId: h.execution.id, eventType: "execution.terminal" } })).toMatchObject({ status: "failed" });
    expect(h.generation.createFromAgent).toHaveBeenCalledTimes(2);
  });

  it.each(["CANCELED", "MODERATION_FAILED"] as const)("preserves the %s technical outcome without inventing a candidate", async (status) => {
    const h = await harness(1);
    await h.terminal(0, status);
    await h.consumer.drainFacts();
    await h.consumer.drainObservations();
    expect(await prisma.workflowExecution.findUnique({ where: { id: h.execution.id } })).toMatchObject({ status: status.toLowerCase() });
    expect(await prisma.workflowAttempt.findUnique({ where: { id: required(h.attempts[0]).id } })).toMatchObject({ status: status.toLowerCase() });
    expect((await workflows.get(h.user.id, h.project.id)).nodes.filter((node) => node.type === "candidate")).toHaveLength(0);
    expect(await prisma.agentMessage.count({ where: { conversationId: h.conversation.id, origin: "execution_result" } })).toBe(1);
    expect(h.generation.createFromAgent).toHaveBeenCalledOnce();
  });

  it("does not report a succeeded task as a completed design when it contains no traceable output", async () => {
    const h = await harness(1);
    await h.terminal(0);
    await prisma.generationTask.update({ where: { id: required(required(h.attempts[0]).generationTaskId) }, data: { output: { images: [] } } });
    await h.consumer.drainFacts();
    expect(await prisma.workflowExecution.findUnique({ where: { id: h.execution.id } })).toMatchObject({ status: "failed" });
    expect(await prisma.workflowAttempt.findUnique({ where: { id: required(h.attempts[0]).id } })).toMatchObject({ status: "failed", error: "生成任务已结束但缺少可追溯的输出资产" });
    expect((await workflows.get(h.user.id, h.project.id)).nodes.filter((node) => node.type === "candidate")).toHaveLength(0);
  });
});
