import { workflowReferenceSummarySchema, type WorkflowReferenceSummary } from "@fashion/shared";

export function buildWorkflowReferenceSummary(
  nodes: readonly { id: string; title: string }[],
  explicitIds: readonly string[],
  discussionIds: readonly string[],
  imageIds: readonly string[],
): WorkflowReferenceSummary {
  const titles = new Map(nodes.map((node) => [node.id, node.title]));
  const entries = (ids: readonly string[]) => [...new Set(ids)].map((nodeId) => ({
    nodeId, title: titles.get(nodeId) ?? null,
  }));
  return workflowReferenceSummarySchema.parse({
    version: 1, explicit: entries(explicitIds), discussion: entries(discussionIds), images: entries(imageIds),
  });
}
