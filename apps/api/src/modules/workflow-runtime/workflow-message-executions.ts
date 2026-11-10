import { Prisma, type PrismaClient, type WorkflowProposal } from "@fashion/db";
import type { WorkflowProposalExecution } from "@fashion/shared";
import {
  acceptedProposalVersions,
  initialProposalExecutionId,
} from "./proposal-execution-binding";
import { buildWorkflowExecutionProgress } from "./workflow-execution-progress";
import { buildWorkflowExecutionResults } from "./workflow-execution-result";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export async function readWorkflowMessageExecutions(
  database: PrismaClient,
  context: {
    projectId: string;
    conversationId: string;
    userId: string;
    canEdit: boolean;
  },
  executionIds: readonly string[],
  proposals: readonly WorkflowProposal[],
) {
  const { projectId, conversationId, userId, canEdit } = context;
  const accepted = proposals.filter(
    (proposal) => proposal.status === "accepted",
  );
  // Pick the latest record for each explicit association in SQL, rather than limiting a mixed page.
  const relatedIds = accepted.length
    ? await database.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT DISTINCT ON (COALESCE('proposal:' || (e.request_snapshot->>'proposalId'), 'legacy:' || (e.request_snapshot->>'mutationId'))) e.id
    FROM workflow_executions e
    WHERE e.project_id = ${projectId} AND e.conversation_id = ${conversationId} AND e.user_id = ${userId}
      AND ((e.request_snapshot->>'proposalId') IN (${Prisma.join(accepted.map((proposal) => proposal.id))})
        OR (NOT (e.request_snapshot ? 'proposalId') AND (e.request_snapshot->>'mutationId') IN (${Prisma.join(accepted.map((proposal) => initialProposalExecutionId(projectId, proposal.id)))})))
    ORDER BY COALESCE('proposal:' || (e.request_snapshot->>'proposalId'), 'legacy:' || (e.request_snapshot->>'mutationId')), e.created_at DESC, e.id DESC
  `)
    : [];
  const ids = [
    ...new Set([...executionIds, ...relatedIds.map((row) => row.id)]),
  ];
  const executions = ids.length
    ? await database.workflowExecution.findMany({
        where: { projectId, conversationId, userId, id: { in: ids } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
    : [];
  const [progress, results, versions] = await Promise.all([
    buildWorkflowExecutionProgress(database, projectId, executions, canEdit),
    buildWorkflowExecutionResults(database, projectId, executions),
    acceptedProposalVersions(database, projectId, accepted),
  ]);
  const nodeIds = accepted.flatMap((proposal) =>
    typeof object(proposal.evidence).toolNodeId === "string"
      ? [String(object(proposal.evidence).toolNodeId)]
      : [],
  );
  const latestVersions = nodeIds.length
    ? await database.workflowNodeVersion.findMany({
        where: { projectId, nodeId: { in: nodeIds }, kind: "tool" },
        orderBy: { version: "desc" },
        select: { id: true, nodeId: true },
      })
    : [];
  const nodes = nodeIds.length
    ? await database.workflowNode.findMany({
        where: { projectId, id: { in: nodeIds }, kind: "tool" },
        select: { id: true, status: true },
      })
    : [];
  const recordedVersions = versions.size
    ? await database.workflowExecution.groupBy({
        by: ["nodeVersionId"],
        where: { projectId, nodeVersionId: { in: [...versions.values()] } },
        _count: true,
      })
    : [];
  const proposalExecutions = new Map<string, WorkflowProposalExecution>();
  for (const proposal of accepted) {
    const nodeVersionId = versions.get(proposal.id) ?? null;
    const toolNodeId = String(object(proposal.evidence).toolNodeId ?? "");
    const execution = executions.find(
      (execution) =>
        execution.toolNodeId === toolNodeId &&
        execution.nodeVersionId === nodeVersionId &&
        (object(execution.requestSnapshot).proposalId === proposal.id ||
          (object(execution.requestSnapshot).proposalId === undefined &&
            object(execution.requestSnapshot).mutationId ===
              initialProposalExecutionId(projectId, proposal.id))),
    );
    const observed = execution ? (progress.get(execution.id) ?? null) : null;
    const current = latestVersions.find(
      (version) => version.nodeId === toolNodeId,
    );
    const node = nodes.find((node) => node.id === toolNodeId);
    const changed = Boolean(nodeVersionId && current?.id !== nodeVersionId);
    const binding = changed
      ? "changed"
      : execution
        ? "linked"
        : nodeVersionId &&
            node?.status === "ready" &&
            !recordedVersions.some(
              (record) => record.nodeVersionId === nodeVersionId,
            )
          ? "not_started"
          : "unrecorded";
    const terminal =
      observed &&
      ["failed", "canceled", "moderation_failed"].includes(observed.status);
    proposalExecutions.set(proposal.id, {
      version: 1,
      binding,
      nodeVersionId,
      progress: observed,
      result: execution ? (results.get(execution.id) ?? null) : null,
      canExecute:
        canEdit &&
        !changed &&
        Boolean(
          nodeVersionId && node && ["ready", "failed"].includes(node.status),
        ) &&
        (binding === "not_started" || Boolean(terminal)),
    });
  }
  return { progress, results, proposalExecutions };
}
