import type { Prisma, PrismaClient, WorkflowExecution } from "@fashion/db";
import {
  workflowExecutionProgressSchema,
  workflowExecutionResultSchema,
  type WorkflowExecutionProgress,
} from "@fashion/shared";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
type Database = Pick<
  PrismaClient | Prisma.TransactionClient,
  "workflowAttempt" | "workflowNodeVersion"
>;

/** Counts describe observed attempts; no queue position, percentage or completion is inferred. */
export async function buildWorkflowExecutionProgress(
  database: Database,
  projectId: string,
  executions: readonly WorkflowExecution[],
  canEdit: boolean,
): Promise<Map<string, WorkflowExecutionProgress>> {
  const admitted = executions.filter(
    (execution) => execution.projectId === projectId,
  );
  if (!admitted.length) return new Map();
  const attempts = await database.workflowAttempt.findMany({
    where: {
      projectId,
      executionId: { in: admitted.map((execution) => execution.id) },
    },
    select: {
      id: true,
      executionId: true,
      status: true,
      requestSnapshot: true,
      updatedAt: true,
      generationTask: {
        select: {
          id: true,
          userId: true,
          projectId: true,
          status: true,
          updatedAt: true,
        },
      },
    },
  });
  const versionIds = admitted.flatMap((execution) =>
    execution.nodeVersionId ? [execution.nodeVersionId] : [],
  );
  const versions = versionIds.length
    ? await database.workflowNodeVersion.findMany({
        where: { projectId, id: { in: versionIds } },
        select: { id: true, title: true, type: true },
      })
    : [];
  const found = new Map<string, WorkflowExecutionProgress>();
  for (const execution of admitted) {
    const records = attempts.filter(
      (attempt) => attempt.executionId === execution.id,
    );
    const counts = {
      total: Math.max(1, execution.expectedAttempts, records.length),
      preparing: 0,
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      canceled: 0,
    };
    const cancelTaskIds = new Set<string>();
    let updatedAt = execution.updatedAt.getTime();
    for (const attempt of records) {
      const task =
        attempt.generationTask?.projectId === projectId
          ? attempt.generationTask
          : null;
      updatedAt = Math.max(
        updatedAt,
        attempt.updatedAt.getTime(),
        task?.updatedAt.getTime() ?? 0,
      );
      if (attempt.status === "completed") counts.completed++;
      else if (attempt.status === "canceled" || task?.status === "CANCELED")
        counts.canceled++;
      else if (
        ["failed", "moderation_failed"].includes(attempt.status) ||
        task?.status === "FAILED" ||
        task?.status === "MODERATION_FAILED"
      )
        counts.failed++;
      else if (task?.status === "QUEUED") counts.queued++;
      else if (
        task?.status === "RUNNING" ||
        (!task &&
          attempt.status === "running" &&
          !object(attempt.requestSnapshot).request &&
          !object(attempt.requestSnapshot).transformAssetId)
      )
        counts.running++;
      else if (task?.status !== "SUCCEEDED") counts.preparing++;
      if (
        canEdit &&
        task &&
        ["QUEUED", "RUNNING"].includes(task.status) &&
        !workflowExecutionResultSchema.shape.status.safeParse(execution.status)
          .success
      )
        cancelTaskIds.add(task.id);
    }
    counts.preparing += Math.max(0, counts.total - records.length);
    const terminal = workflowExecutionResultSchema.shape.status.safeParse(
      execution.status,
    );
    const status = terminal.success
      ? terminal.data
      : counts.running
        ? "running"
        : counts.queued && !counts.preparing
          ? "queued"
          : counts.preparing
            ? "preparing"
            : "processing";
    const version = versions.find(
      (version) => version.id === execution.nodeVersionId,
    );
    const snapshot = object(execution.requestSnapshot);
    const operation =
      ["generate_design", "edit_design"].includes(version?.type ?? "") ||
      records.some((attempt) => attempt.generationTask)
        ? "image"
        : version?.type === "transform_image" || snapshot.transformAssetId
          ? "transform"
          : ["analyze_brief", "evaluate_design"].includes(version?.type ?? "")
            ? "analysis"
            : "other";
    const parsed = workflowExecutionProgressSchema.safeParse({
      version: 1,
      executionId: execution.id,
      toolNodeId: execution.toolNodeId,
      title: version?.title.trim().slice(0, 200) || "设计任务",
      operation,
      status,
      updatedAt: new Date(updatedAt).toISOString(),
      counts,
      cancelTaskIds: [...cancelTaskIds],
    });
    if (parsed.success) found.set(execution.id, parsed.data);
  }
  return found;
}
