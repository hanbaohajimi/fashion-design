import type { PrismaClient } from "@fashion/db";
import { projectTaskGroup, type ProjectTaskActivity, type ProjectTaskDomain, type ProjectTaskTerminal } from "@fashion/shared";
import { pendingProjectReviews } from "./project-review-tasks";

type StatusCount = { status: string; _count: { _all: number } };
type TerminalRow = { id: string; status: string; updatedAt: Date };
const select = { id: true, status: true, updatedAt: true } as const;
const orderBy = [{ updatedAt: "desc" }, { id: "desc" }] as const;

// Explicit outcomes only. Expired exports, accepted proposals and unknown states
// are not evidence of a newly completed task.
const outcomes: Record<ProjectTaskDomain, Record<string, ProjectTaskTerminal["outcome"]>> = {
  generation: { SUCCEEDED: "completed", FAILED: "failed", MODERATION_FAILED: "failed", CANCELED: "canceled" },
  workflow: { completed: "completed", failed: "failed", partial_failed: "failed", moderation_failed: "failed", not_admitted: "failed", canceled: "canceled" },
  agent: { completed: "completed", failed: "failed", canceled: "canceled" },
  runway: { SUCCEEDED: "completed", FAILED: "failed", CANCELED: "canceled" },
  export: { SUCCEEDED: "completed", FAILED: "failed" },
  assistant: { COMPLETED: "completed", FAILED: "failed", CANCELED: "canceled" },
  review: { APPROVED: "completed", CHANGES_REQUESTED: "failed" },
};

/** Called only after the existing project read permission has succeeded. */
export async function readProjectTaskActivity(db: PrismaClient, userId: string, projectId: string): Promise<{
  activity: ProjectTaskActivity;
  counts: { running: number; attention: number };
}> {
  // Keep the same parent/child de-duplication as the task center.
  const generation = { projectId, workflowAttempts: { none: {} }, agentRunAttempt: { is: null } };
  const assistant = { conversation: { projectId }, role: "ASSISTANT" as const, replyToId: { not: null } };
  const grouped = { by: ["status"] as ["status"], _count: { _all: true as const } };
  const terminal = { select, orderBy: [...orderBy], take: 20 };
  const [generations, workflows, agents, runways, exports, replies, proposals,
    generationEnds, workflowEnds, agentEnds, runwayEnds, exportEnds, replyEnds, activeWorkflows, pendingReviews] = await Promise.all([
    db.generationTask.groupBy({ ...grouped, where: generation }),
    db.workflowExecution.groupBy({ ...grouped, where: { projectId } }),
    db.agentRun.groupBy({ ...grouped, where: { projectId } }),
    db.runwayRun.groupBy({ ...grouped, where: { projectId } }),
    db.exportJob.groupBy({ ...grouped, where: { projectId } }),
    db.agentMessage.groupBy({ ...grouped, where: assistant }),
    db.workflowProposal.count({ where: { projectId, status: "pending" } }),
    db.generationTask.findMany({ ...terminal, where: { ...generation, status: { in: ["SUCCEEDED", "FAILED", "MODERATION_FAILED", "CANCELED"] } } }),
    db.workflowExecution.findMany({ ...terminal, where: { projectId, status: { in: Object.keys(outcomes.workflow) } } }),
    db.agentRun.findMany({ ...terminal, where: { projectId, status: { in: Object.keys(outcomes.agent) } } }),
    db.runwayRun.findMany({ ...terminal, where: { projectId, status: { in: Object.keys(outcomes.runway) } } }),
    db.exportJob.findMany({ ...terminal, where: { projectId, status: { in: ["SUCCEEDED", "FAILED"] } } }),
    db.agentMessage.findMany({ ...terminal, where: { ...assistant, status: { in: ["COMPLETED", "FAILED", "CANCELED"] } } }),
    db.workflowExecution.findMany({ where: { projectId, status: { in: ["queued", "pending", "running", "dispatching"] } }, select: { id: true, status: true } }),
    db.studioDocument.count({ where: pendingProjectReviews(projectId, userId) }),
  ]);
  const attempts = activeWorkflows.length ? await db.workflowAttempt.findMany({
    where: { projectId, executionId: { in: activeWorkflows.map(row => row.id) } },
    select: { executionId: true, generationTask: { select: { status: true } } },
  }) : [];
  const counts = { running: 0, attention: proposals };
  const waiting = { input: 0, confirmation: proposals, resume: 0 };
  counts.attention += pendingReviews;
  waiting.confirmation += pendingReviews;
  let preparing = 0, queued = 0, executing = 0;
  const groups: [ProjectTaskDomain, StatusCount[]][] = [
    ["generation", generations], ["workflow", workflows], ["agent", agents],
    ["runway", runways], ["export", exports], ["assistant", replies],
  ];
  for (const [domain, rows] of groups) for (const row of rows) {
    const count = row._count._all, status = row.status.toLowerCase();
    const group = projectTaskGroup(status);
    if (group !== "ended") counts[group] += count;
    if (["waiting_input", "needs_attention"].includes(status)) waiting.input += count;
    else if (["ready", "awaiting_approval", "awaiting_review", "waiting_review", "pending_approval"].includes(status)) waiting.confirmation += count;
    else if (status === "paused") waiting.resume += count;
    // WorkflowExecution is marked running before its children enter the worker.
    // Its real phase is resolved below from those existing generation records.
    else if (group === "running" && domain !== "workflow") {
      if (["running", "executing", "processing", "committing"].includes(status)) executing += count;
      else { preparing += count; if (status === "queued") queued += count; }
    }
  }
  const children = new Map<string, string[]>();
  for (const attempt of attempts) if (attempt.executionId && attempt.generationTask) {
    const statuses = children.get(attempt.executionId) ?? [];
    statuses.push(attempt.generationTask.status); children.set(attempt.executionId, statuses);
  }
  for (const execution of activeWorkflows) {
    const statuses = children.get(execution.id) ?? [];
    if (statuses.includes("RUNNING")) executing += 1;
    else {
      preparing += 1;
      if (statuses.includes("QUEUED") || execution.status === "queued") queued += 1;
    }
  }
  const terminalGroups: [ProjectTaskDomain, TerminalRow[]][] = [
    ["generation", generationEnds], ["workflow", workflowEnds], ["agent", agentEnds],
    ["runway", runwayEnds], ["export", exportEnds], ["assistant", replyEnds],
  ];
  const recent = terminalGroups.flatMap(([domain, rows]) => rows.flatMap(row => {
    const outcome = outcomes[domain][row.status];
    return outcome ? [{ id: `${domain}:${row.id}`, domain, outcome, updatedAt: row.updatedAt.toISOString() }] : [];
  })).sort((a, b) => a.updatedAt === b.updatedAt ? (a.id === b.id ? 0 : a.id < b.id ? 1 : -1) : a.updatedAt < b.updatedAt ? 1 : -1).slice(0, 20);
  return { counts, activity: { preparing, queued, executing, awaitingUser: waiting.input + waiting.confirmation + waiting.resume, waiting, recent } };
}
