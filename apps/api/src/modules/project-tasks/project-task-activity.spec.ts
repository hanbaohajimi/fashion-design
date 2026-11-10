import { describe, expect, it, vi } from "vitest";
import { readProjectTaskActivity } from "./project-task-activity";

const group = (status: string, count: number) => ({ status, _count: { _all: count } });
const end = (id: string, status: string, at = "2026-11-08T10:00:00Z") => ({ id, status, updatedAt: new Date(at) });
function setup() {
  const table = () => ({ groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) });
  const db = { generationTask: table(), workflowExecution: table(), agentRun: table(), runwayRun: table(), exportJob: table(), agentMessage: table(), workflowProposal: table(), workflowAttempt: table() };
  return { db, read: () => readProjectTaskActivity(db as never, "project-a") };
}

describe("项目活动的权威摘要", () => {
  it("分开历史失败与等待用户，按子任务的真实执行状态区分排队、分析与创作", async () => {
    const { db, read } = setup();
    db.generationTask.groupBy.mockResolvedValue([group("QUEUED", 2), group("RUNNING", 1), group("FAILED", 50)]);
    db.workflowExecution.groupBy.mockResolvedValue([group("running", 3)]);
    db.agentRun.groupBy.mockResolvedValue([group("ready", 2), group("waiting_review", 1), group("paused", 1), group("planning", 1), group("running", 1), group("failed", 6)]);
    db.runwayRun.groupBy.mockResolvedValue([group("WAITING_INPUT", 1), group("NEEDS_ATTENTION", 1), group("RUNNING", 1), group("FAILED", 1)]);
    db.exportJob.groupBy.mockResolvedValue([group("QUEUED", 1), group("RUNNING", 1), group("EXPIRED", 4)]);
    db.agentMessage.groupBy.mockResolvedValue([group("PENDING", 1), group("FAILED", 1)]);
    db.workflowProposal.count.mockResolvedValue(2);
    db.workflowExecution.findMany.mockImplementation(query => query.select.updatedAt ? [] : [{ id: "queue", status: "running" }, { id: "work", status: "running" }, { id: "analysis", status: "running" }]);
    db.workflowAttempt.findMany.mockResolvedValue([
      { executionId: "queue", generationTask: { status: "QUEUED" } },
      { executionId: "work", generationTask: { status: "RUNNING" } },
      { executionId: "work", generationTask: { status: "QUEUED" } },
      { executionId: "analysis", generationTask: null },
    ]);
    expect(await read()).toMatchObject({ counts: { running: 12, attention: 66 }, activity: { preparing: 7, queued: 4, executing: 5, awaitingUser: 8, waiting: { input: 2, confirmation: 5, resume: 1 } } });
    expect(db.generationTask.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "project-a", workflowAttempts: { none: {} }, agentRunAttempt: { is: null } } }));
    expect(db.generationTask.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workflowAttempts: { none: {} }, agentRunAttempt: { is: null } }) }));
  });

  it("终态按更新时间跨领域排序，最多 20 条，未知/过期状态不算成功", async () => {
    const { db, read } = setup();
    db.generationTask.findMany.mockResolvedValue(Array.from({ length: 20 }, (_, index) => end(`image-${index}`, "SUCCEEDED", `2026-11-08T10:00:${String(index).padStart(2, "0")}Z`)));
    db.workflowExecution.findMany.mockImplementation(query => query.select.updatedAt ? [end("partial", "partial_failed", "2026-11-08T11:00:00Z")] : []);
    db.agentRun.findMany.mockResolvedValue([end("cancel", "canceled", "2026-11-08T12:00:00Z")]);
    db.exportJob.findMany.mockResolvedValue([end("expired", "EXPIRED", "2026-11-08T13:00:00Z")]);
    const result = await read();
    expect(result.activity.recent).toHaveLength(20);
    expect(result.activity.recent.slice(0, 2)).toMatchObject([{ id: "agent:cancel", outcome: "canceled" }, { id: "workflow:partial", outcome: "failed" }]);
    expect(result.activity.recent.some(row => row.id === "export:expired")).toBe(false);
    expect(db.generationTask.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20, orderBy: [{ updatedAt: "desc" }, { id: "desc" }] }));
    expect(db.agentMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ conversation: { projectId: "project-a" }, role: "ASSISTANT", replyToId: { not: null } }) }));
  });
});
