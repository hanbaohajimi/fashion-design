import { prisma } from "@fashion/db";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ProjectTasksService } from "./project-tasks.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";

let ownerId = "";
let projectId = "";
let workspaceId = "";
let viewerId = "";
const service = new ProjectTasksService(prisma, new ProjectAccessPolicy(prisma));
beforeAll(async () => {
  const owner = await prisma.user.create({ data: { email: `tasks-${crypto.randomUUID()}@example.com`, ownedWorkspaces: { create: { name: "Task integration", projects: { create: { name: "Tasks" } } } } }, include: { ownedWorkspaces: { include: { projects: true } } } });
  ownerId = owner.id;
  const workspace = owner.ownedWorkspaces[0];
  const project = workspace?.projects[0];
  if (!workspace || !project) throw new Error("测试项目创建失败");
  workspaceId = workspace.id; projectId = project.id;
  const viewer = await prisma.user.create({ data: { email: `tasks-viewer-${crypto.randomUUID()}@example.com` } }); viewerId = viewer.id;
  await prisma.workspaceMember.create({ data: { workspaceId, userId: viewerId, role: "VIEWER" } });
  const date = new Date("2026-10-27T00:00:00.000Z");
  await prisma.generationTask.createMany({ data: Array.from({ length: 7 }, (_, index) => ({ userId: ownerId, projectId, taskType: "t2i", input: {}, status: index < 4 ? "RUNNING" as const : "FAILED" as const, createdAt: date })) });
  await prisma.exportJob.create({ data: { userId: ownerId, projectId, format: "PNG", quality: "STANDARD", watermark: false, createdAt: date } });
});
afterAll(async () => {
  if (ownerId) await prisma.user.delete({ where: { id: ownerId } });
  if (viewerId) await prisma.user.delete({ where: { id: viewerId } });
});

it("跨领域同时间分页无重复遗漏，计数来自数据库", async () => {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await service.list(ownerId, projectId, { group: "active", limit: 2, ...(cursor ? { cursor } : {}) });
    expect(page.counts).toEqual({ running: 5, attention: 3 });
    ids.push(...page.items.map(item => item.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(ids).toHaveLength(8); expect(new Set(ids).size).toBe(8);
});
it("只读成员可读状态但无写入操作，项目外用户不可读取", async () => {
  const page = await service.list(viewerId, projectId, { group: "active", limit: 30 });
  expect(page.items.every(item => item.actions.length === 0)).toBe(true);
  const owner = await service.list(ownerId, projectId, { group: "running", limit: 30 });
  expect(owner.items.filter(item => item.domain === "generation").every(item => item.actions.some(action => action.kind === "cancel_generation"))).toBe(true);
  await expect(service.list(crypto.randomUUID(), projectId, { group: "active", limit: 30 })).rejects.toThrow();
});
it("拒绝非法游标", async () => {
  await expect(service.list(ownerId, projectId, { group: "active", limit: 30, cursor: "invalid" })).rejects.toThrow("游标无效");
});

it("数据库活动摘要与分页独立，历史失败不会成为等待用户事项", async () => {
  const first = await service.list(ownerId, projectId, { group: "running", limit: 1, activity: true });
  expect(first.activity).toMatchObject({ preparing: 1, queued: 1, executing: 4, awaitingUser: 0 });
  expect(first.activity?.recent).toHaveLength(3);
  expect(first.activity?.recent.every(item => item.outcome === "failed")).toBe(true);
  const next = await service.list(viewerId, projectId, { group: "ended", limit: 1, ...(first.nextCursor ? { cursor: first.nextCursor } : {}), activity: true });
  expect(next.activity).toEqual(first.activity);
  expect(next.items.every(item => !item.actions.length)).toBe(true);
  await expect(service.list(crypto.randomUUID(), projectId, { group: "active", limit: 1, activity: true })).rejects.toThrow();
});

it("真实父子记录只计一次，父执行的创作状态跟随图片子任务而非提前开始", async () => {
  const project = await prisma.project.create({ data: { wsId: workspaceId, name: "Activity de-duplication" } });
  try {
    const toolId = crypto.randomUUID();
    await prisma.workflowGraph.create({ data: {
      projectId: project.id,
      nodes: { create: { id: toolId, kind: "tool", type: "generate_design", title: "生成设计", payload: {}, x: 0, y: 0 } },
    } });
    const image = await prisma.generationTask.create({ data: { projectId: project.id, userId: ownerId, taskType: "t2i", input: {}, status: "QUEUED" } });
    const execution = await prisma.workflowExecution.create({ data: { projectId: project.id, userId: ownerId, toolNodeId: toolId, executionKey: crypto.randomUUID(), requestSnapshot: {}, status: "running" } });
    await prisma.workflowAttempt.create({ data: { projectId: project.id, toolNodeId: toolId, executionId: execution.id, generationTaskId: image.id, ordinal: 1, executionKey: crypto.randomUUID(), requestSnapshot: {}, status: "queued" } });

    const legacyImage = await prisma.generationTask.create({ data: { projectId: project.id, userId: ownerId, taskType: "t2i", input: {}, status: "SUCCEEDED" } });
    const conversation = await prisma.agentConversation.create({ data: { projectId: project.id, createdById: ownerId, title: "历史执行" } });
    const legacy = await prisma.agentRun.create({ data: {
      projectId: project.id, conversationId: conversation.id, userId: ownerId, clientRequestId: crypto.randomUUID(), intent: "历史设计", contextSnapshot: {}, status: "completed",
      steps: { create: { key: "design", ordinal: 1, tool: "generate_design", title: "设计", instruction: "设计", prompt: "设计", negativePrompt: "", status: "completed",
        attempts: { create: { ordinal: 1, executionKey: crypto.randomUUID(), requestSnapshot: {}, status: "completed", leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(), generationTaskId: legacyImage.id } },
      } },
    } });
    const queued = await service.list(ownerId, project.id, { group: "active", limit: 1, activity: true });
    expect(queued.counts).toEqual({ running: 1, attention: 0 });
    expect(queued.activity).toMatchObject({ preparing: 1, queued: 1, executing: 0, recent: [{ id: `agent:${legacy.id}`, outcome: "completed" }] });
    expect(queued.items.map(item => item.id)).toEqual([`workflow:${execution.id}`]);

    await prisma.generationTask.update({ where: { id: image.id }, data: { status: "RUNNING" } });
    const running = await service.list(viewerId, project.id, { group: "running", limit: 1, activity: true });
    expect(running.activity).toMatchObject({ preparing: 0, queued: 0, executing: 1 });
    expect(running.items.every(item => item.actions.length === 0)).toBe(true);

    await prisma.generationTask.update({ where: { id: image.id }, data: { status: "SUCCEEDED" } });
    await prisma.workflowExecution.update({ where: { id: execution.id }, data: { status: "completed" } });
    const finished = await service.list(ownerId, project.id, { group: "ended", limit: 1, activity: true });
    expect(finished.activity).toMatchObject({ preparing: 0, executing: 0, awaitingUser: 0 });
    expect(finished.activity?.recent.map(item => item.id).sort()).toEqual([`workflow:${execution.id}`, `agent:${legacy.id}`].sort());
  } finally {
    await prisma.workflowAttempt.deleteMany({ where: { projectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } });
  }
});
