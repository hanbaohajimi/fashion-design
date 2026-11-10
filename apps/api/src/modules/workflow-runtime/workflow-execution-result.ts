import type { Prisma, PrismaClient } from "@fashion/db";
import {
  workflowExecutionResultSchema,
  type WorkflowExecutionResult,
} from "@fashion/shared";
import { visibleStudioAssets } from "../studio/studio-asset-visibility";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
type Execution = {
  id: string;
  projectId: string;
  toolNodeId: string;
  status: string;
  completedAt: Date | null;
};
type Database = Pick<
  PrismaClient | Prisma.TransactionClient,
  "workflowAttempt" | "imageTransformResult" | "designAsset" | "workflowNode"
>;

/** Batch reads use the attempt/task identities, never all outputs currently linked to a tool. */
export async function buildWorkflowExecutionResults(
  database: Database,
  projectId: string,
  executions: readonly Execution[],
): Promise<Map<string, WorkflowExecutionResult>> {
  const admitted = executions.filter(
    (execution) => execution.projectId === projectId,
  );
  if (!admitted.length) return new Map();
  const attempts = await database.workflowAttempt.findMany({
    where: {
      projectId,
      executionId: { in: admitted.map((execution) => execution.id) },
    },
    orderBy: [{ ordinal: "asc" }, { id: "asc" }],
    select: {
      id: true,
      executionId: true,
      status: true,
      generationTaskId: true,
      generationTask: {
        select: { id: true, projectId: true, status: true, output: true },
      },
    },
  });
  const completed = attempts.filter(
    (attempt) => attempt.status === "completed",
  );
  const transforms = completed.some((attempt) => !attempt.generationTaskId)
    ? await database.imageTransformResult.findMany({
        where: {
          attemptId: {
            in: completed
              .filter((attempt) => !attempt.generationTaskId)
              .map((attempt) => attempt.id),
          },
          error: null,
          assetId: { not: null },
        },
        select: { attemptId: true, assetId: true },
      })
    : [];
  const outputs = new Map<
    string,
    { assetId: string; taskId: string | null }[]
  >();
  for (const attempt of completed) {
    const task = attempt.generationTask;
    const images =
      task?.projectId === projectId &&
      task.status === "SUCCEEDED" &&
      Array.isArray(object(task.output).images)
        ? (object(task.output).images as unknown[])
        : [];
    const source = task
      ? images.flatMap((value) =>
          typeof object(value).assetId === "string"
            ? [{ assetId: String(object(value).assetId), taskId: task.id }]
            : [],
        )
      : transforms.flatMap((value) =>
          value.attemptId === attempt.id && value.assetId
            ? [{ assetId: value.assetId, taskId: null }]
            : [],
        );
    outputs.set(attempt.id, source);
  }
  const ids = [
    ...new Set([...outputs.values()].flat().map((output) => output.assetId)),
  ];
  const assets = ids.length
    ? await database.designAsset.findMany({
        where: { AND: [visibleStudioAssets(projectId), { id: { in: ids } }] },
        select: { id: true, generationTaskId: true, width: true, height: true },
      })
    : [];
  const nodes = assets.length
    ? await database.workflowNode.findMany({
        where: {
          projectId,
          kind: "asset",
          type: "candidate",
          OR: assets.map((asset) => ({
            payload: { path: ["assetId"], equals: asset.id },
          })),
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, title: true, payload: true },
      })
    : [];
  const results = new Map<string, WorkflowExecutionResult>();
  for (const execution of admitted) {
    const grouped = attempts.filter(
      (attempt) => attempt.executionId === execution.id,
    );
    const seen = new Set<string>();
    const images = grouped.flatMap((attempt) =>
      (outputs.get(attempt.id) ?? []).flatMap((output) => {
        const asset = assets.find(
          (asset) =>
            asset.id === output.assetId &&
            (!output.taskId || asset.generationTaskId === output.taskId),
        );
        if (!asset || seen.has(asset.id)) return [];
        seen.add(asset.id);
        const matching = nodes.filter(
          (node) => object(node.payload).assetId === asset.id,
        );
        const node =
          matching.find(
            (node) => object(node.payload).attemptId === attempt.id,
          ) ?? matching[0];
        return [
          {
            assetId: asset.id,
            nodeId: node?.id ?? null,
            title: node?.title.trim().slice(0, 200) || `方案 ${seen.size}`,
            width: asset.width && asset.width > 0 ? asset.width : null,
            height: asset.height && asset.height > 0 ? asset.height : null,
          },
        ];
      }),
    );
    const result = workflowExecutionResultSchema.safeParse({
      version: 1,
      executionId: execution.id,
      toolNodeId: execution.toolNodeId,
      status: execution.status,
      completedAt: execution.completedAt?.toISOString() ?? null,
      attempts: {
        completed: grouped.filter((attempt) => attempt.status === "completed")
          .length,
        failed: grouped.filter(
          (attempt) => !["completed", "canceled"].includes(attempt.status),
        ).length,
        canceled: grouped.filter((attempt) => attempt.status === "canceled")
          .length,
      },
      images,
    });
    if (result.success) results.set(execution.id, result.data);
  }
  return results;
}

export function workflowExecutionResultText(
  status: string,
  imageCount: number,
): string {
  if (status === "completed")
    return imageCount
      ? `本次完成 ${imageCount} 张图片，可预览、比较或继续修改。`
      : "本次执行已完成，结果已记录。";
  if (status === "partial_failed")
    return imageCount
      ? `本次已有 ${imageCount} 张图片完成，其余操作未完成。可以先查看已有结果。`
      : "本次部分操作未完成，请在项目任务中查看具体原因。";
  if (status === "canceled")
    return imageCount
      ? `本次执行已取消，已完成的 ${imageCount} 张图片仍可查看。`
      : "本次执行已取消。";
  if (status === "moderation_failed")
    return "本次执行未通过内容检查，请在项目任务中查看原因。";
  return imageCount
    ? `本次执行未全部完成，已保存的 ${imageCount} 张图片仍可查看。`
    : "本次执行未完成，请在项目任务中查看原因。";
}
