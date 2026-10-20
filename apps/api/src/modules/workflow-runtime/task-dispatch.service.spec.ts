import { describe, expect, it, vi } from "vitest";
import { TaskDispatchService } from "./task-dispatch.service";

function harness() {
  const generationTask = { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
  const exportJob = { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
  const workflowAttempt = { findMany: vi.fn().mockResolvedValue([]) };
  const database = { generationTask, exportJob, workflowAttempt, $transaction: vi.fn() };
  database.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(database));
  const generations = { state: vi.fn().mockResolvedValue("missing"), enqueue: vi.fn() };
  const exports = { state: vi.fn().mockResolvedValue("missing"), enqueue: vi.fn() };
  return { database, generations, exports, service: new TaskDispatchService(database as never, generations as never, exports as never, { delete: vi.fn() }) };
}

describe("durable task reconciliation", () => {
  it("repairs missing queued jobs without creating another database task", async () => {
    const h = harness();
    h.database.generationTask.findMany.mockResolvedValue([{ id: "task", status: "QUEUED", userId: "owner" }]);
    h.database.exportJob.findMany.mockResolvedValue([{ id: "export", status: "QUEUED" }]);
    await h.service.reconcile();
    expect(h.generations.enqueue).toHaveBeenCalledWith("task", "owner");
    expect(h.exports.enqueue).toHaveBeenCalledWith("export");
  });
  it("does not interpret a Redis connection failure as a missing job", async () => {
    const h = harness();
    h.database.generationTask.findMany.mockResolvedValue([{ id: "task", status: "QUEUED", userId: "owner" }]);
    h.generations.state.mockRejectedValue(new Error("Redis offline"));
    await h.service.reconcile();
    expect(h.generations.enqueue).not.toHaveBeenCalled();
    expect(h.database.generationTask.updateMany).not.toHaveBeenCalled();
  });
  it("preserves a live lease and terminates an unrecoverable expired generation", async () => {
    const h = harness();
    h.database.generationTask.findMany.mockResolvedValue([
      { id: "live", status: "RUNNING", updatedAt: new Date() },
      { id: "expired", status: "RUNNING", updatedAt: new Date(0), attemptCount: 1, providerJob: null },
    ]);
    await h.service.reconcile();
    expect(h.generations.state).not.toHaveBeenCalled();
    expect(h.database.generationTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", errorCode: "GENERATION_INTERRUPTED" }) }));
    expect(h.generations.enqueue).not.toHaveBeenCalled();
  });
  it("advances a stable cursor beyond the first hundred tasks", async () => {
    const h = harness();
    h.database.generationTask.findMany.mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => ({ id: `task-${String(i).padStart(3, "0")}`, status: "QUEUED", userId: "owner" })));
    await h.service.reconcile(); await h.service.reconcile();
    expect(h.database.generationTask.findMany.mock.calls[1]?.[0]).toMatchObject({ where: { id: { gt: "task-099" } } });
  });
  it("ends an expired export lease even if a renderer has not released its Redis job", async () => {
    const h = harness();
    h.database.exportJob.findMany.mockResolvedValue([{ id: "hung", status: "RUNNING", leaseToken: "old", leaseExpiresAt: new Date(0) }]);
    await h.service.reconcile();
    expect(h.database.exportJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", errorCode: "EXPORT_TIMEOUT" }) }));
    expect(h.exports.enqueue).not.toHaveBeenCalled();
  });
  it("reclaims legacy running exports without a lease even when Redis still says active", async () => {
    const h = harness();
    h.database.exportJob.findMany.mockResolvedValue([{ id: "legacy", status: "RUNNING", leaseToken: null, leaseExpiresAt: null, updatedAt: new Date(0) }]);
    h.exports.state.mockResolvedValue("active");
    await h.service.reconcile();
    expect(h.database.exportJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", errorCode: "EXPORT_TIMEOUT" }) }));
    expect(h.exports.enqueue).not.toHaveBeenCalled();
  });
});
