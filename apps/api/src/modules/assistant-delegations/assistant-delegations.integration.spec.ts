import { randomUUID } from "node:crypto";
import { prisma } from "@fashion/db";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { AssistantDelegationsService } from "./assistant-delegations.service";

const reply = { status: "completed", kind: "reply", context: {}, proposal: null, executionId: null };
const assistant = { send: vi.fn().mockResolvedValue({ assistantMessage: reply }) };
const service = new AssistantDelegationsService(prisma, new ProjectAccessPolicy(prisma), assistant as never);
let userId = "", workspaceId = "", projectId = "", conversationId = "";
beforeAll(async () => {
  const owner = await prisma.user.create({ data: { email: `delegation-state-${randomUUID()}@example.test`, ownedWorkspaces: { create: { name: "委托状态隔离", projects: { create: { name: "委托状态项目" } } } } }, include: { ownedWorkspaces: { include: { projects: true } } } });
  userId = owner.id;
  const workspace = owner.ownedWorkspaces[0], project = workspace?.projects[0];
  if (!workspace || !project) throw new Error("缺少测试项目");
  workspaceId = workspace.id; projectId = project.id;
  conversationId = (await prisma.agentConversation.create({ data: { projectId, createdById: userId, mode: "workflow", title: "隔离持续设计对话" } })).id;
});
afterAll(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } });
  if (userId) await prisma.user.delete({ where: { id: userId } });
});
const create = () => service.create(userId, projectId, { cadence: "ONCE", conversationId, name: "隔离复盘", nextRunAt: "2099-01-01T00:00:00.000Z", prompt: "核对当前方案", timeZone: "Asia/Shanghai" }, randomUUID());

it("助手失败正常返回时实际委托记录为失败，显式重试使用新一轮编号", async () => {
  assistant.send.mockClear();
  assistant.send.mockResolvedValueOnce({ assistantMessage: { ...reply, status: "failed", error: { message: "本轮分析未完成" } } }).mockResolvedValueOnce({ assistantMessage: reply });
  const item = await create();
  await service.runNow(userId, item.id);
  await vi.waitFor(async () => expect((await prisma.assistantDelegation.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("FAILED"));
  expect(await prisma.assistantDelegation.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ lastError: "本轮分析未完成", runCount: 1 });
  await service.runNow(userId, item.id);
  await vi.waitFor(async () => expect((await prisma.assistantDelegation.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("COMPLETED"));
  expect(assistant.send.mock.calls.map(call => call[2].clientRequestId)).toEqual([`delegation:${item.id}:1`, `delegation:${item.id}:2`]);
});

it("实际执行未结束时保持运行，同一轮复读不新增编号，明确完成后才结束", async () => {
  assistant.send.mockClear();
  const toolNodeId = randomUUID();
  await prisma.workflowGraph.create({ data: { projectId, nodes: { create: { id: toolNodeId, kind: "tool", type: "generate_design", title: "隔离执行", payload: {}, x: 0, y: 0 } } } });
  const execution = await prisma.workflowExecution.create({ data: { projectId, userId, conversationId, toolNodeId, executionKey: randomUUID(), requestSnapshot: {}, status: "running" } });
  assistant.send.mockResolvedValue({ assistantMessage: { ...reply, executionId: execution.id, context: { executionReceipt: { status: "submitted" } } } });
  const item = await create();
  await service.runNow(userId, item.id);
  await vi.waitFor(async () => {
    const running = await prisma.assistantDelegation.findUniqueOrThrow({ where: { id: item.id } });
    expect(running.status).toBe("RUNNING");
    expect((running.leaseExpiresAt?.getTime() ?? Infinity) - Date.now()).toBeLessThan(30_000);
  });
  const running = await prisma.assistantDelegation.findUniqueOrThrow({ where: { id: item.id } });
  expect(running.runCount).toBe(0);
  await prisma.workflowExecution.update({ where: { id: execution.id }, data: { status: "completed" } });
  await (service as unknown as { execute: (id: string, token: string) => Promise<void> }).execute(item.id, running.leaseToken ?? "");
  expect(await prisma.assistantDelegation.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ status: "COMPLETED", runCount: 1 });
  expect(assistant.send.mock.calls.map(call => call[2].clientRequestId)).toEqual([`delegation:${item.id}:1`, `delegation:${item.id}:1`]);
});

it("等待确认的回复暂停当前委托，保持明确的处理说明", async () => {
  assistant.send.mockResolvedValue({ assistantMessage: { ...reply, proposal: { status: "pending" } } });
  const item = await create();
  await service.runNow(userId, item.id);
  await vi.waitFor(async () => expect((await prisma.assistantDelegation.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("PAUSED"));
  const saved = await prisma.assistantDelegation.findUniqueOrThrow({ where: { id: item.id } });
  expect(saved.lastError).toContain("确认方案");
  expect(saved.leaseToken).toBeNull();
});

it("提前手动运行周期委托保留原来的下次计划时间", async () => {
  assistant.send.mockResolvedValue({ assistantMessage: reply });
  const nextRunAt = "2099-01-02T03:00:00.000Z";
  const item = await service.create(userId, projectId, { cadence: "DAILY", conversationId, name: "提前复盘", nextRunAt, prompt: "整理下一步", timeZone: "Asia/Shanghai" }, randomUUID());
  await service.runNow(userId, item.id);
  await vi.waitFor(async () => expect((await prisma.assistantDelegation.findUniqueOrThrow({ where: { id: item.id } })).runCount).toBe(1));
  const saved = await prisma.assistantDelegation.findUniqueOrThrow({ where: { id: item.id } });
  expect(saved.status).toBe("ACTIVE");
  expect(saved.nextRunAt.toISOString()).toBe(nextRunAt);
});
