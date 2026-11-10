import type { Queue } from "bullmq";

export const IMAGE_EDIT_CLEANUP_QUEUE = "image-edit-cleanup";
export const IMAGE_EDIT_CLEANUP_GRACE_MS = 60_000;

export interface ImageEditCleanupJobData {
  readonly taskId: string;
  readonly failures?: number;
}

export interface ImageEditCleanupJobs {
  enqueue(taskId: string): Promise<void>;
}

/** Register before writing any temporary input, so a crash cannot lose cleanup. */
export function createImageEditCleanupJobs(
  queue: Queue<ImageEditCleanupJobData>,
  delay = IMAGE_EDIT_CLEANUP_GRACE_MS,
): ImageEditCleanupJobs {
  return {
    async enqueue(taskId) {
      const previous = await queue.getJob(taskId);
      if (previous) {
        const state = await previous.getState();
        if (state === "failed") {
          await previous.retry("failed", {
            resetAttemptsMade: true,
            resetAttemptsStarted: true,
          });
        }
        return;
      }
      await queue.add(
        "cleanup-inputs",
        { taskId },
        {
          jobId: taskId,
          delay,
          // Ordinary dependency errors are durably delayed by the processor.
          // These attempts cover interrupted workers and queue transition errors.
          attempts: 10,
          backoff: { type: "exponential", delay: 60_000 },
          keepLogs: 5,
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    },
  };
}
