import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@fashion/db";
import type { Job } from "bullmq";
import type { ImageEditCleanupJobData } from "../queues/image-edit-cleanup.queue";
import { createImageEditCleanupProcessor } from "./image-edit-cleanup.processor";

function fixture(status: string | null, completedAt = new Date(0)) {
  const findUnique = vi
    .fn()
    .mockResolvedValue(
      status
        ? { status, completedAt, canceledAt: null, updatedAt: completedAt }
        : null,
    );
  const remove = vi.fn().mockResolvedValue(undefined);
  const clock = vi.fn(() => 120_000);
  const job = {
    data: { taskId: "task-1" },
    timestamp: 0,
    token: "lock",
    moveToDelayed: vi.fn().mockResolvedValue(undefined),
    updateData: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue(undefined),
  };
  const process = createImageEditCleanupProcessor({
    database: { generationTask: { findUnique } } as unknown as Pick<
      PrismaClient,
      "generationTask"
    >,
    storage: { delete: remove },
    now: clock,
  });
  return {
    findUnique,
    remove,
    clock,
    job,
    run: () => process(job as unknown as Job<ImageEditCleanupJobData>),
  };
}

describe("图片临时输入持久清理", () => {
  it.each(["QUEUED", "RUNNING"])(
    "%s只延后，不消耗生成重试或删除输入",
    async (status) => {
      const f = fixture(status);
      await expect(f.run()).rejects.toMatchObject({ name: "DelayedError" });
      expect(f.remove).not.toHaveBeenCalled();
      expect(f.job.moveToDelayed).toHaveBeenCalledWith(180_000, "lock");
      expect(f.job.updateData).not.toHaveBeenCalled();
    },
  );
  it.each(["SUCCEEDED", "FAILED", "CANCELED", "MODERATION_FAILED", null])(
    "终态%s或已删除任务仅清理固定私有临时键",
    async (status) => {
      const f = fixture(status);
      await f.run();
      expect(f.remove.mock.calls.map(([key]) => key)).toEqual([
        "image-edit/task-1/input.png",
        "image-edit/task-1/mask.png",
        "image-edit/task-1/annotations.png",
        "image-edit/task-1/inpaint-source.png",
        "image-edit/task-1/inpaint-mask.png",
      ]);
      expect(f.job.moveToDelayed).not.toHaveBeenCalled();
    },
  );
  it("取消后等待在途写入结束，不立即完成持久清理", async () => {
    const f = fixture("CANCELED", new Date(110_000));
    await expect(f.run()).rejects.toMatchObject({ name: "DelayedError" });
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.job.moveToDelayed).toHaveBeenCalledWith(170_000, "lock");
  });
  it("数据库或删除故障保留清理并延后重试，不更改业务状态", async () => {
    const f = fixture("SUCCEEDED");
    f.findUnique.mockRejectedValueOnce(new Error("database offline"));
    await expect(f.run()).rejects.toMatchObject({ name: "DelayedError" });
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.job.updateData).toHaveBeenCalledWith({
      taskId: "task-1",
      failures: 1,
    });
    f.remove.mockRejectedValueOnce(new Error("storage offline"));
    await expect(f.run()).rejects.toMatchObject({ name: "DelayedError" });
    expect(f.remove).toHaveBeenCalledTimes(5);
  });
  it("无效任务路径不会传入存储", async () => {
    const f = fixture("SUCCEEDED");
    f.job.data.taskId = "../../original";
    await expect(f.run()).rejects.toMatchObject({ name: "UnrecoverableError" });
    expect(f.findUnique).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
  });
});
