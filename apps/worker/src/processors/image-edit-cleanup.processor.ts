import type { PrismaClient } from "@fashion/db";
import { DelayedError, UnrecoverableError, type Job } from "bullmq";
import {
  IMAGE_EDIT_CLEANUP_GRACE_MS,
  type ImageEditCleanupJobData,
} from "../queues/image-edit-cleanup.queue";
import type { ThumbnailStorage } from "../storage";

const TERMINAL = new Set([
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "MODERATION_FAILED",
]);
const TEMPORARY_NAMES = [
  "input.png",
  "mask.png",
  "annotations.png",
  "inpaint-source.png",
  "inpaint-mask.png",
];

export function createImageEditCleanupProcessor({
  database,
  storage,
  graceMs = IMAGE_EDIT_CLEANUP_GRACE_MS,
  retryMs = 60_000,
  now = Date.now,
}: {
  database: Pick<PrismaClient, "generationTask">;
  storage: Pick<ThumbnailStorage, "delete">;
  graceMs?: number;
  retryMs?: number;
  now?: () => number;
}) {
  return async (job: Job<ImageEditCleanupJobData>): Promise<void> => {
    const { taskId } = job.data;
    // Cleanup accepts task identities only, never arbitrary client-provided keys.
    if (!/^[a-z\d_-]{1,128}$/iu.test(taskId))
      throw new UnrecoverableError("临时图片清理任务标识无效");
    let retryAt: number | undefined;
    try {
      const task = await database.generationTask.findUnique({
        where: { id: taskId },
        select: {
          status: true,
          completedAt: true,
          canceledAt: true,
          updatedAt: true,
        },
      });
      if (task && !TERMINAL.has(task.status)) {
        retryAt = now() + retryMs;
      } else {
        // Terminal states are irreversible; a user's retry creates a new task ID.
        // Allow outstanding storage operations to settle after cancel/deletion.
        const endedAt = task
          ? (task.completedAt ?? task.canceledAt ?? task.updatedAt).getTime()
          : job.timestamp;
        const safeAfter = Math.max(endedAt, job.timestamp) + graceMs;
        if (safeAfter > now()) {
          retryAt = safeAfter;
        } else {
          const deleted = await Promise.allSettled(
            TEMPORARY_NAMES.map((name) =>
              storage.delete(`image-edit/${taskId}/${name}`),
            ),
          );
          const failed = deleted.find((result) => result.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
        }
      }
    } catch {
      const failures = Math.min((job.data.failures ?? 0) + 1, 16);
      await job.updateData({ taskId, failures });
      await job.log("临时图片清理暂不可用，已保留任务并延后重试。");
      retryAt = now() + Math.min(retryMs * 2 ** (failures - 1), 60 * 60_000);
    }
    if (retryAt !== undefined) {
      await job.moveToDelayed(retryAt, job.token);
      throw new DelayedError();
    }
  };
}
