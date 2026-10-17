import { visualSummaryJobId } from "@fashion/ai";
import { VISUAL_SUMMARY_SCHEMA_VERSION } from "@fashion/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queue = vi.hoisted(() => ({ getJob: vi.fn(), add: vi.fn(), close: vi.fn() }));
vi.mock("bullmq", () => ({ Queue: vi.fn(function () { return queue; }) }));

import { BullVisualSummaryJobs } from "./visual-summary-queue.service";

const data = { source: { kind: "file" as const, id: "file" }, model: "model", schemaVersion: VISUAL_SUMMARY_SCHEMA_VERSION };

beforeEach(() => {
  queue.getJob.mockReset(); queue.add.mockReset(); queue.close.mockReset();
  queue.add.mockResolvedValue({});
});

describe("visual summary queue retry", () => {
  it("冷却失败后原子重试原任务并恢复完整重试次数，不另建重复任务", async () => {
    const existing = { getState: vi.fn().mockResolvedValue("failed"), retry: vi.fn().mockResolvedValue(undefined), remove: vi.fn() };
    queue.getJob.mockResolvedValue(existing);
    await new BullVisualSummaryJobs().enqueue(data);
    expect(queue.getJob).toHaveBeenCalledWith(visualSummaryJobId(data));
    expect(existing.retry).toHaveBeenCalledWith("failed", { resetAttemptsMade: true, resetAttemptsStarted: true });
    expect(existing.remove).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("并发读取已由另一请求恢复时，保留其等待任务", async () => {
    const existing = { getState: vi.fn().mockResolvedValue("failed"), retry: vi.fn().mockRejectedValue(new Error("not failed")), remove: vi.fn() };
    const claimed = { getState: vi.fn().mockResolvedValue("waiting"), remove: vi.fn() };
    queue.getJob.mockResolvedValueOnce(existing).mockResolvedValueOnce(claimed);
    await new BullVisualSummaryJobs().enqueue(data);
    expect(queue.add).not.toHaveBeenCalled();
    expect(existing.remove).not.toHaveBeenCalled();
    expect(claimed.remove).not.toHaveBeenCalled();
  });

  it("失效任务已清理时以同一模型版本身份补齐一次任务", async () => {
    const existing = { getState: vi.fn().mockResolvedValue("failed"), retry: vi.fn().mockRejectedValue(new Error("missing")) };
    queue.getJob.mockResolvedValueOnce(existing).mockResolvedValueOnce(undefined);
    await new BullVisualSummaryJobs().enqueue(data);
    expect(queue.add).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledWith("describe", data, expect.objectContaining({ jobId: visualSummaryJobId(data), attempts: 3 }));
    expect(visualSummaryJobId({ ...data, model: "new-model" })).not.toBe(visualSummaryJobId(data));
    expect(visualSummaryJobId({ ...data, schemaVersion: `${VISUAL_SUMMARY_SCHEMA_VERSION}/next` })).not.toBe(visualSummaryJobId(data));
  });

  it("已存在活动任务时不重复投递", async () => {
    queue.getJob.mockResolvedValue({ getState: vi.fn().mockResolvedValue("active") });
    await new BullVisualSummaryJobs().enqueue(data);
    expect(queue.add).not.toHaveBeenCalled();
  });
});
