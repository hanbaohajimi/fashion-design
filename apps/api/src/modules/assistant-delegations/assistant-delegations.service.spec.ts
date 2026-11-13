import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@fashion/db";

import { AssistantDelegationsService } from "./assistant-delegations.service";

const future = "2030-01-02T03:04:05.000Z";

function record(overrides: Record<string, unknown> = {}) {
  return {
    cadence: "DAILY" as const,
    conversationId: "conversation-a",
    createdAt: new Date("2029-01-01T00:00:00.000Z"),
    fingerprint: "fingerprint-a",
    id: "delegation-a",
    lastError: null,
    lastRunAt: null,
    leaseExpiresAt: null,
    leaseToken: null as string | null,
    name: "每周复盘",
    nextRunAt: new Date(future),
    ownerId: "user-a",
    projectId: "project-a",
    prompt: "检查当前方案并列出下一步",
    requestKey: "request-a",
    runCount: 0,
    scheduledLocalDayOfMonth: 2,
    scheduledLocalHour: 11,
    scheduledLocalMinute: 4,
    scheduledLocalSecond: 5,
    status: "ACTIVE" as const,
    timeZone: "Asia/Shanghai",
    updatedAt: new Date("2029-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function harness() {
  const db = {
    agentConversation: { findFirst: vi.fn() },
    workflowExecution: { findFirst: vi.fn() },
    assistantDelegation: {
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const access = { require: vi.fn().mockResolvedValue({ workspaceId: "workspace-a" }) };
  const assistant = { send: vi.fn().mockResolvedValue({ assistantMessage: { id: "reply", status: "completed", kind: "reply", context: {}, proposal: null, executionId: null } }) };
  const service = new AssistantDelegationsService(db as unknown as PrismaClient, access as never, assistant as never);
  return { access, assistant, db, service };
}

afterEach(() => vi.restoreAllMocks());

describe("AssistantDelegationsService", () => {
  it("过期租约直接换发持有者，不重设计划时间或将正在执行的委托暂改为空闲", async () => {
    const { db, service, assistant } = harness();
    const running = record({ status: "RUNNING", leaseToken: "old-lease" });
    db.assistantDelegation.findMany.mockResolvedValue([running]);
    db.assistantDelegation.updateMany.mockResolvedValue({ count: 1 });
    db.assistantDelegation.findUnique.mockResolvedValue(null);
    await service.drain();
    expect(db.assistantDelegation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [
      { nextRunAt: { lte: expect.any(Date) }, status: "ACTIVE" },
      { leaseExpiresAt: { lte: expect.any(Date) }, status: "RUNNING" },
    ] } }));
    const write = db.assistantDelegation.updateMany.mock.calls[0]?.[0];
    expect(write.data).toMatchObject({ status: "RUNNING", leaseToken: expect.any(String) });
    expect(write.data).not.toHaveProperty("nextRunAt");
    expect(assistant.send).not.toHaveBeenCalled();
  });
  it.each(["ONCE", "DAILY"])("助手明确失败时记录错误，%s 不会伪装为完成", async cadence => {
    const { db, assistant, service } = harness();
    db.assistantDelegation.findUnique.mockResolvedValue(record({ status: "RUNNING", leaseToken: "lease", cadence }));
    db.assistantDelegation.updateMany.mockResolvedValue({ count: 1 });
    assistant.send.mockResolvedValue({ assistantMessage: { status: "failed", error: { message: "本轮分析未完成" }, context: {} } });
    await (service as unknown as { execute: (id: string, token: string) => Promise<void> }).execute("delegation-a", "lease");
    expect(db.assistantDelegation.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: cadence === "ONCE" ? "FAILED" : "ACTIVE", lastError: "本轮分析未完成", runCount: { increment: 1 },
    }) }));
  });

  it.each([
    { status: "pending", kind: "reply", context: {}, expected: "RUNNING" },
    { status: "canceled", kind: "reply", context: {}, expected: "PAUSED" },
    { status: "completed", kind: "clarify", context: {}, expected: "PAUSED" },
    { status: "completed", kind: "reply", context: {}, proposal: { status: "pending" }, expected: "PAUSED" },
    { status: "completed", kind: "reply", context: { executionReceipt: { status: "stopped" } }, expected: "FAILED" },
    { status: "completed", kind: "reply", context: { executionReceipt: { status: "submitted" } }, expected: "PAUSED" },
  ])("回复 $status/$kind 按真实情况保持或等待：$expected", async ({ expected, ...reply }) => {
    const { db, assistant, service } = harness();
    db.assistantDelegation.findUnique.mockResolvedValue(record({ status: "RUNNING", leaseToken: "lease", cadence: "ONCE" }));
    db.assistantDelegation.updateMany.mockResolvedValue({ count: 1 });
    assistant.send.mockResolvedValue({ assistantMessage: reply });
    await (service as unknown as { execute: (id: string, token: string) => Promise<void> }).execute("delegation-a", "lease");
    const data = db.assistantDelegation.updateMany.mock.calls.at(-1)?.[0].data;
    if (expected === "RUNNING") {
      expect(data).toEqual({ leaseExpiresAt: expect.any(Date) });
    } else expect(data.status).toBe(expected);
  });

  it("实际图片执行未终止时复读同一请求，核实完成后才完成委托", async () => {
    const { db, assistant, service } = harness();
    db.assistantDelegation.findUnique.mockResolvedValue(record({ status: "RUNNING", leaseToken: "lease", cadence: "ONCE" }));
    db.assistantDelegation.updateMany.mockResolvedValue({ count: 1 });
    db.workflowExecution.findFirst.mockResolvedValueOnce({ status: "running" }).mockResolvedValueOnce({ status: "completed" });
    assistant.send.mockResolvedValue({ assistantMessage: { status: "completed", context: { executionReceipt: { status: "submitted" } }, executionId: "execution-a" } });
    const execute = () => (service as unknown as { execute: (id: string, token: string) => Promise<void> }).execute("delegation-a", "lease");
    await execute();
    expect(db.assistantDelegation.updateMany.mock.calls[0]?.[0].data).toEqual({ leaseExpiresAt: expect.any(Date) });
    await execute();
    expect(assistant.send.mock.calls.map(call => call[2].clientRequestId)).toEqual(["delegation:delegation-a:1", "delegation:delegation-a:1"]);
    expect(db.workflowExecution.findFirst).toHaveBeenCalledWith({ where: { id: "execution-a", projectId: "project-a", conversationId: "conversation-a", userId: "user-a" }, select: { status: true } });
    expect(db.assistantDelegation.updateMany.mock.calls[1]?.[0].data.status).toBe("COMPLETED");
  });

  it("执行部分失败保留失败结果，不将请求受理当作作品完成", async () => {
    const { db, assistant, service } = harness();
    db.assistantDelegation.findUnique.mockResolvedValue(record({ status: "RUNNING", leaseToken: "lease", cadence: "ONCE" }));
    db.assistantDelegation.updateMany.mockResolvedValue({ count: 1 });
    db.workflowExecution.findFirst.mockResolvedValue({ status: "partial_failed" });
    assistant.send.mockResolvedValue({ assistantMessage: { status: "completed", context: {}, executionId: "execution-a" } });
    await (service as unknown as { execute: (id: string, token: string) => Promise<void> }).execute("delegation-a", "lease");
    expect(db.assistantDelegation.updateMany.mock.calls[0]?.[0].data).toMatchObject({ status: "FAILED", lastError: expect.stringContaining("未全部完成") });
  });

  it("creates a persisted delegation and replays the same idempotency key", async () => {
    const { db, service } = harness();
    let created = record();
    let lookup = 0;
    db.agentConversation.findFirst.mockResolvedValue({ id: "conversation-a" });
    db.assistantDelegation.findUnique.mockImplementation(async () => lookup++ === 0 ? null : created);
    db.assistantDelegation.count.mockResolvedValue(0);
    db.assistantDelegation.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      created = record({ ...data });
      return created;
    });
    const input = {
      cadence: "DAILY" as const,
      conversationId: "conversation-a",
      name: "每周复盘",
      nextRunAt: future,
      prompt: "检查当前方案并列出下一步",
      timeZone: "Asia/Shanghai",
    };

    const first = await service.create("user-a", "project-a", input, "request-a");
    const replay = await service.create("user-a", "project-a", input, "request-a");

    expect(first.id).toBe("delegation-a");
    expect(replay).toEqual(first);
    expect(db.assistantDelegation.create).toHaveBeenCalledTimes(1);
    expect(db.assistantDelegation.create.mock.calls[0]?.[0].data).toMatchObject({
      scheduledLocalDayOfMonth: 2,
      scheduledLocalHour: 11,
      scheduledLocalMinute: 4,
      scheduledLocalSecond: 5,
    });
  });

  it("runs immediately once, writes the assistant message, and advances recurring time", async () => {
    const { assistant, db, service } = harness();
    const active = record();
    const running = record({
      status: "RUNNING" as const,
    });
    db.assistantDelegation.findFirst.mockResolvedValue(active);
    db.assistantDelegation.updateMany.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      if (data.status === "RUNNING") running.leaseToken = data.leaseToken as string;
      return { count: 1 };
    });
    db.assistantDelegation.findUniqueOrThrow.mockResolvedValue(running);
    db.assistantDelegation.findUnique.mockResolvedValue(running);

    const result = await service.runNow("user-a", "delegation-a");
    await vi.waitFor(() => expect(assistant.send).toHaveBeenCalledTimes(1));

    expect(result.status).toBe("RUNNING");
    expect(assistant.send).toHaveBeenCalledWith(
      "user-a",
      "conversation-a",
      expect.objectContaining({
        content: "检查当前方案并列出下一步",
        clientRequestId: expect.stringMatching(/^delegation:delegation-a:1$/),
      }),
    );
    expect(db.assistantDelegation.updateMany).toHaveBeenCalledTimes(2);
    expect(db.assistantDelegation.updateMany.mock.calls[1]?.[0].data.status).toBe("ACTIVE");
  });
});
