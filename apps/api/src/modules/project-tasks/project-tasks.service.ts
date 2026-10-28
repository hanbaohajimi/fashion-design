import { GenerationTaskStatus, ExportStatus, type PrismaClient } from "@fashion/db";
import { type ProjectTaskAction, type ProjectTaskDomain, type ProjectTaskPage, type ProjectTaskView, projectTaskGroup } from "@fashion/shared";
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { ProjectAccessPolicy } from "../studio/project-access.policy";

export const PROJECT_TASKS_DB = Symbol("PROJECT_TASKS_DB");
type Group = "active" | "running" | "attention" | "ended";
type Cursor = { date: string; id: string };
function states<T extends string>(group: Group, running: T[], attention: T[]) {
  return group === "ended" ? { notIn: [...running, ...attention] } : { in: group === "running" ? running : group === "attention" ? attention : [...running, ...attention] };
}
function decodeCursor(value?: string): Cursor | null {
  if (!value) return null;
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString()) as Cursor;
    if (typeof cursor.id !== "string" || cursor.id.length > 256 ||
      !/^(assistant|workflow|generation|agent|export|runway):.+$/u.test(cursor.id) ||
      typeof cursor.date !== "string" || !Number.isFinite(Date.parse(cursor.date))) throw new Error();
    return { id: cursor.id, date: new Date(cursor.date).toISOString() };
  }
  catch { throw new BadRequestException("任务分页游标无效"); }
}
type Row = { id: string; status: string; createdAt: Date; updatedAt: Date };
const rowSelect = { id: true, status: true, createdAt: true, updatedAt: true } as const;

// Keep the merge order identical to the cursor's comparisons, independent of the server locale.
function compareDescending(a: string, b: string): number {
  return a === b ? 0 : a < b ? 1 : -1;
}

@Injectable()
export class ProjectTasksService {
  constructor(@Inject(PROJECT_TASKS_DB) private readonly db: PrismaClient, @Inject(ProjectAccessPolicy) private readonly access: ProjectAccessPolicy) {}

  async list(userId: string, projectId: string, input: { group: Group; limit: number; cursor?: string | undefined }): Promise<ProjectTaskPage> {
    const { capabilities } = await this.access.require(userId, projectId, "read");
    const editable = capabilities.edit;
    const cursor = decodeCursor(input.cursor);
    const boundaryFor = (domain: string) => {
      if (!cursor) return {};
      const [cursorDomain, ...id] = cursor.id.split(":");
      const date = new Date(cursor.date);
      return { OR: [{ createdAt: { lt: date } }, ...(domain <= (cursorDomain ?? "") ? [{ createdAt: date, ...(domain === cursorDomain ? { id: { lt: id.join(":") } } : {}) }] : [])] };
    };
    const base = `/${encodeURIComponent(projectId)}`;
    const toView = (domain: ProjectTaskDomain, row: Row, title: string, href: string, actions: ProjectTaskAction[] = [], objectId: string | null = null, conversationId: string | null = null): ProjectTaskView => ({ id: `${domain}:${row.id}`, domain, title, rawStatus: row.status, status: row.status.toLowerCase(), group: projectTaskGroup(row.status), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), href, actions: editable ? actions : [], objectId, conversationId });
    const take = input.limit + 1;
    const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];
    const generationWhere = (group: Group) => ({ projectId, workflowAttempts: { none: {} }, agentRunAttempt: { is: null }, status: states(group, [GenerationTaskStatus.QUEUED, GenerationTaskStatus.RUNNING], [GenerationTaskStatus.FAILED, GenerationTaskStatus.MODERATION_FAILED]) });
    const workflowWhere = (group: Group) => ({ projectId, status: states(group, ["queued", "pending", "running", "dispatching"], ["failed", "not_admitted"]) });
    const agentWhere = (group: Group) => ({ projectId, status: states(group, ["queued", "planning", "running", "executing"], ["ready", "awaiting_approval", "awaiting_review", "paused", "failed"]) });
    const runwayWhere = (group: Group) => ({ projectId, status: states(group, ["QUEUED", "RUNNING"], ["WAITING_INPUT", "NEEDS_ATTENTION", "FAILED"]) });
    const exportWhere = (group: Group) => ({ projectId, status: states(group, [ExportStatus.QUEUED, ExportStatus.RUNNING], [ExportStatus.FAILED]) });
    const assistantWhere = (group: Group) => ({ conversation: { projectId }, role: "ASSISTANT" as const, replyToId: { not: null }, status: states(group, ["PENDING" as const], ["FAILED" as const]) });
    const proposalWhere = (group: Group) => ({ projectId, status: states(group, [], ["pending"]) });
    const [generations, executions, agents, runways, exports, messages, proposals] = await Promise.all([
      this.db.generationTask.findMany({ where: { ...generationWhere(input.group), ...boundaryFor("generation") }, orderBy, take, select: { ...rowSelect, parentAssetId: true, generatedAssets: { select: { id: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1 } } }),
      this.db.workflowExecution.findMany({ where: { ...workflowWhere(input.group), ...boundaryFor("workflow") }, orderBy, take, select: { ...rowSelect, toolNodeId: true, conversationId: true } }),
      this.db.agentRun.findMany({ where: { ...agentWhere(input.group), ...boundaryFor("agent") }, orderBy, take, select: { ...rowSelect, conversationId: true, revision: true } }),
      this.db.runwayRun.findMany({ where: { ...runwayWhere(input.group), ...boundaryFor("runway") }, orderBy, take, select: { ...rowSelect, stage: true, showId: true, version: true } }),
      this.db.exportJob.findMany({ where: { ...exportWhere(input.group), ...boundaryFor("export") }, orderBy, take, select: { ...rowSelect, fileName: true, studioRevisionId: true, designAssetId: true, collectionId: true } }),
      this.db.agentMessage.findMany({ where: { ...assistantWhere(input.group), ...boundaryFor("assistant") }, select: { ...rowSelect, conversationId: true, replyTo: { select: { clientRequestId: true } } }, orderBy, take }),
      input.group === "running" || input.group === "ended" ? Promise.resolve([]) : this.db.workflowProposal.findMany({ where: { ...proposalWhere(input.group), ...boundaryFor("workflow") }, orderBy, take, select: { ...rowSelect, evidence: true, conversationId: true } }),
    ]);
    const countsFor = async (group: "running" | "attention") => (await Promise.all([
      this.db.generationTask.count({ where: generationWhere(group) }), this.db.workflowExecution.count({ where: workflowWhere(group) }),
      this.db.agentRun.count({ where: agentWhere(group) }), this.db.runwayRun.count({ where: runwayWhere(group) }), this.db.exportJob.count({ where: exportWhere(group) }),
      this.db.agentMessage.count({ where: assistantWhere(group) }), group === "attention" ? this.db.workflowProposal.count({ where: proposalWhere(group) }) : 0,
    ])).reduce((sum, count) => sum + count, 0);
    const revisionIds = [...new Set(exports.flatMap(row => row.studioRevisionId ? [row.studioRevisionId] : []))];
    const [running, attention, attempts, documents] = await Promise.all([
      countsFor("running"), countsFor("attention"),
      executions.length ? this.db.workflowAttempt.findMany({ where: { projectId, executionId: { in: executions.map(row => row.id) }, generationTask: { status: { in: ["QUEUED", "RUNNING"] } } }, select: { generationTaskId: true, executionId: true } }) : [],
      revisionIds.length ? this.db.studioDocument.findMany({ where: { projectId, id: { in: revisionIds } }, select: { id: true, type: true, styleRevisionId: true } }) : [],
    ]);
    const documentById = new Map(documents.map(document => [document.id, document]));
    const exportHref = (row: (typeof exports)[number]): string => {
      if (row.studioRevisionId) {
        const document = documentById.get(row.studioRevisionId);
        if (!document || !["TECH_PACK", "PRESENTATION_SET"].includes(document.type)) return `${base}/studio`;
        return `${base}/studio?tab=${document.type === "TECH_PACK" ? "tech" : "presentation"}${document.styleRevisionId ? `&styleRevisionId=${encodeURIComponent(document.styleRevisionId)}` : ""}`;
      }
      if (row.designAssetId) return `${base}/studio?tab=styles&assetId=${encodeURIComponent(row.designAssetId)}`;
      return `${base}/studio?tab=presentation`;
    };
    const rows = [
      ...generations.map(row => toView("generation", row, "图片生成", row.generatedAssets[0] ? `${base}/studio?tab=styles&assetId=${encodeURIComponent(row.generatedAssets[0].id)}` : `${base}?taskId=${encodeURIComponent(row.id)}`, ["QUEUED", "RUNNING"].includes(row.status) ? [{ kind: "cancel_generation", targetId: row.id }] : [], row.parentAssetId)),
      ...executions.map(row => toView("workflow", row, "设计步骤", `${base}?nodeId=${encodeURIComponent(row.toolNodeId)}`, row.status === "failed" ? [{ kind: "retry_workflow", targetId: row.toolNodeId }] : ["queued", "running"].includes(row.status) ? attempts.filter(item => item.executionId === row.id && item.generationTaskId).map(item => ({ kind: "cancel_generation" as const, targetId: item.generationTaskId ?? "" })) : [], row.toolNodeId, row.conversationId)),
      ...agents.map(row => toView("agent", row, "设计运行", `${base}?conversationId=${encodeURIComponent(row.conversationId)}&runId=${encodeURIComponent(row.id)}`, ["planning", "queued", "running", "executing", "paused"].includes(row.status) ? [...(row.status === "paused" ? [{ kind: "resume_agent" as const, targetId: row.id, version: row.revision }] : []), { kind: "cancel_agent", targetId: row.id, version: row.revision }, ...(["running", "executing"].includes(row.status) ? [{ kind: "pause_agent" as const, targetId: row.id, version: row.revision }] : [])] : [], row.id, row.conversationId)),
      ...runways.map(row => toView("runway", row, `服装秀 ${({ prepare: "准备素材", pairing: "搭配", tryon: "试衣", storyboard: "分镜", video: "视频", compose: "合成", music: "配乐", finished: "成片" })[row.stage] ?? row.stage}`, `${base}/studio?tab=runway&showId=${encodeURIComponent(row.showId)}&runId=${encodeURIComponent(row.id)}`, ["QUEUED", "RUNNING", "WAITING_INPUT"].includes(row.status) ? [{ kind: "cancel_runway", targetId: row.id, version: row.version }] : [], row.showId)),
      ...exports.map(row => toView("export", row, row.fileName ?? "导出文件", exportHref(row), [], row.studioRevisionId ?? row.designAssetId ?? row.collectionId)),
      ...messages.map(row => toView("assistant", row, "设计助手回复", `${base}?conversationId=${encodeURIComponent(row.conversationId)}`, row.status === "PENDING" && row.replyTo?.clientRequestId ? [{ kind: "cancel_reply", targetId: row.id, conversationId: row.conversationId, requestId: row.replyTo.clientRequestId }] : [], row.id, row.conversationId)),
      ...proposals.map(row => toView("workflow", { ...row, status: "awaiting_approval" }, "生成方案待确认", `${base}?nodeId=${encodeURIComponent(String((row.evidence as Record<string, unknown>)?.toolNodeId ?? ""))}${row.conversationId ? `&conversationId=${encodeURIComponent(row.conversationId)}` : ""}`, [], String((row.evidence as Record<string, unknown>)?.toolNodeId ?? ""), row.conversationId)),
    ].filter(row => !cursor || row.createdAt < cursor.date || row.createdAt === cursor.date && row.id < cursor.id)
      .sort((a, b) => compareDescending(a.createdAt, b.createdAt) || compareDescending(a.id, b.id));
    const items = rows.slice(0, input.limit);
    const last = items.at(-1);
    return { items, counts: { running, attention }, nextCursor: rows.length > input.limit && last ? Buffer.from(JSON.stringify({ date: last.createdAt, id: last.id })).toString("base64url") : null };
  }
}
