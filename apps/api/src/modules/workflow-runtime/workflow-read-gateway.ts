import { ProjectAccessPolicy } from "../studio/project-access.policy";
import type { PrismaClient } from "@fashion/db";
import { BadRequestException } from "@nestjs/common";
import { contextObject, projectAttempt, projectNode, relatedNodeIds, safeContextText } from "../design-context/design-context.projector";
import { projectVersionInputs } from "../design-context/information-integration.projector";
import { z } from "zod";
import type { WorkflowsService } from "../workflows/workflows.service";
import type { VisualContextResult, VisualContextService } from "../design-context/visual-context.service";

export type WorkflowRead = { type: "nodes" | "attempts" | "branch_history" | "dialog" | "images"; ids: string[] };
export type ReadFactor = "trajectory" | "dialog" | "hiddenIntent";
export type ReadPolicy = Partial<Record<ReadFactor, boolean>>;
type Graph = Awaited<ReturnType<WorkflowsService["get"]>>;
const MAX_READ_CHARACTERS = 24_000;
const MAX_REQUEST_CHARACTERS = 8_000;
const HISTORY_COLLECTIONS = ["nodes", "edges", "attempts", "versions"] as const;
type HistoryCollection = typeof HISTORY_COLLECTIONS[number];
type HistoryField = { path: (string | number)[]; value: unknown; range?: { start: number; end: number; total: number } };
type HistoryRecord = { id: string; value: unknown; fields?: HistoryField[]; fieldIndex?: number; characterOffset?: number };
type HistoryBucket = { records: HistoryRecord[]; index: number; read: number; more: boolean; cursor?: { id: string; createdAt: Date } };
type HistoryState = Record<HistoryCollection, HistoryBucket>;
type HistoryFragment = { collection: HistoryCollection; recordId: string; fields: HistoryField[]; complete: boolean };
type HistoryPage = Record<HistoryCollection, unknown[]> & { fragments: HistoryFragment[] };
const emptyHistoryPage = (): HistoryPage => ({ nodes: [], edges: [], attempts: [], versions: [], fragments: [] });
const cloneHistoryState = (state: HistoryState): HistoryState => Object.fromEntries(HISTORY_COLLECTIONS.map((key) => [key, { ...state[key], records: [...state[key].records] }])) as HistoryState;
/** Field paths preserve arrays and empty containers; long text is split only inside its actual field. */
function historyFields(value: unknown, path: (string | number)[] = []): HistoryField[] {
  if (Array.isArray(value)) return value.length ? value.flatMap((item, index) => historyFields(item, [...path, index])) : [{ path, value: [] }];
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    return entries.length ? entries.flatMap(([key, item]) => historyFields(item, [...path, key])) : [{ path, value: {} }];
  }
  return [{ path, value }];
}
function historyPageData(page: HistoryPage, state: HistoryState, start: Record<HistoryCollection, number>, graphRevision: number) {
  const hasMore = (bucket: HistoryBucket) => bucket.index < bucket.records.length || bucket.more;
  return { ...page, graphRevision, hasMore: HISTORY_COLLECTIONS.some((key) => hasMore(state[key])),
    progress: Object.fromEntries(HISTORY_COLLECTIONS.map((key) => [key, { start: start[key], end: state[key].read }])),
    unread: Object.fromEntries(HISTORY_COLLECTIONS.map((key) => {
      const bucket = state[key], record = bucket.records[bucket.index];
      const field = record?.fields?.[record.fieldIndex ?? 0];
      return [key, { hasMore: hasMore(bucket), loadedRecordsRemaining: bucket.records.length - bucket.index, hasOlderRecords: bucket.more,
        nextRecordId: record?.id ?? null, ...(field ? { fieldPath: field.path, characterOffset: record?.characterOffset ?? 0,
          ...(typeof field.value === "string" ? { fieldCharacters: field.value.length } : {}) } : {}) }];
    })),
    note: "完整记录位于对应数组；fragments按collection、recordId和字段path合并，range为该字段的字符范围。hasMore表示尚未读完；重复相同节点请求将继续，图版本变化后从新快照开始。",
  };
}
const workflowReadSchema = z.object({ type: z.enum(["nodes", "attempts", "branch_history", "dialog", "images"]), ids: z.array(z.string().trim().min(1).max(128).regex(/^[\p{L}\p{N}_.-]+$/u)).max(16) }).strict();
const isInferred = (value: unknown) => ["inferred", "interpretation"].includes(String(contextObject(value).origin));
function policyNode(node: unknown, policy: ReadPolicy): Record<string, unknown> {
  const result = { ...contextObject(node) };
  if (policy.trajectory === false) { delete result.decision; delete result.report; delete result.rationale; }
  if (policy.hiddenIntent === false && result.brief) {
    const brief = contextObject(result.brief);
    result.brief = { ...brief, constraints: (Array.isArray(brief.constraints) ? brief.constraints : []).filter((item) => !isInferred(item)) };
  }
  return result;
}

/** Apply the same factor gates to the initial prompt and every supplemental read. */
export function applyWorkflowReadPolicy(rawContext: unknown, rawSlots: unknown, previousPlan: unknown, policy: ReadPolicy = {}) {
  const context = { ...contextObject(rawContext) }, slots = { ...contextObject(rawSlots) };
  const filteredItems = (value: unknown) => (Array.isArray(value) ? value : []).filter((item) => !isInferred(item));
  if (Array.isArray(context.nodes)) context.nodes = context.nodes.map((node) => policyNode(node, policy));
  if (policy.hiddenIntent === false) {
    for (const key of ["requirements", "preferences", "inactivePreferences"]) context[key] = filteredItems(context[key]);
    const explicitIds = new Set([...(context.requirements as unknown[]), ...(context.preferences as unknown[])].map((item) => contextObject(item).id));
    context.scopedMemory = (Array.isArray(context.scopedMemory) ? context.scopedMemory : []).filter((item) => explicitIds.has(contextObject(item).id));
  }
  if (policy.trajectory === false) {
    for (const key of ["edges", "attempts", "decisions", "versionHistory", "semanticChanges", "mutations", "executions"]) context[key] = [];
    context.trajectory = null;
  }
  if (policy.dialog === false) {
    context.dialog = []; context.dialogSummary = null; context.proposalDecisions = []; context.declinedProposals = []; context.objectiveHistory = [];
    context.currentTask = null; context.focusNodeIds = context.referencedNodeIds ?? [];
  }
  const goals = contextObject(slots.initialGoal);
  if (Object.keys(goals).length) slots.initialGoal = { ...goals, requirements: context.requirements ?? goals.requirements, ...(policy.dialog === false ? { objectiveHistory: [] } : {}) };
  const step = contextObject(slots.currentStepGoal);
  if (Object.keys(step).length) slots.currentStepGoal = { ...step, ...(policy.dialog === false ? { currentTask: null, focusNodeIds: context.referencedNodeIds ?? [] } : {}), ...(Object.values(policy).some((value) => value === false) ? { plan: null } : {}) };
  const trajectory = contextObject(slots.designTrajectory);
  if (Object.keys(trajectory).length) slots.designTrajectory = { ...trajectory,
    nodes: Array.isArray(trajectory.nodes) ? trajectory.nodes.map((node) => policyNode(node, policy)) : [],
    ...(policy.trajectory === false ? { edges: [], trajectory: null, episodes: [], semanticChanges: [], mutations: [], attempts: [], executions: [], decisions: [] } : {}),
  };
  if (policy.dialog === false) slots.dialogue = { unavailable: true, messages: [], summary: null, proposalDecisions: [] };
  if (policy.hiddenIntent === false) slots.implicitIntent = { ...contextObject(slots.implicitIntent), preferences: context.preferences ?? [], scopedMemory: context.scopedMemory ?? [], unavailable: true };
  return { context, slots: rawSlots === undefined ? undefined : slots, previousPlan: Object.values(policy).some((value) => value === false) ? null : previousPlan };
}

/** The model supplies identifiers, never SQL, storage keys, URLs or a conversation identity. */
export class WorkflowReadGateway {
  private characters = 0;
  private readonly dialogOffsets = new Map<string, number>();
  private readonly historyProgress = new Map<string, HistoryState>();
  constructor(private readonly database: PrismaClient, private readonly visual: VisualContextService, private readonly access: ProjectAccessPolicy = new ProjectAccessPolicy(database)) {}

  async read(userId: string, projectId: string, conversationId: string | undefined, graph: Graph,
    request: WorkflowRead, policy: ReadPolicy = {}): Promise<{ result: unknown; visual?: VisualContextResult }> {
    const parsed = workflowReadSchema.safeParse(request);
    if (!parsed.success) throw new BadRequestException("补读仅接受合法类型和最多16个本地编号");
    if (graph.projectId !== projectId) throw new BadRequestException("补读画布不属于当前项目");
    await this.access.require(userId, projectId, "read");
    const ids = [...new Set(parsed.data.ids)];
    const remaining = Math.max(0, Math.min(MAX_REQUEST_CHARACTERS, MAX_READ_CHARACTERS - this.characters));
    if (!remaining) return { result: { type: request.type, ids, unavailable: true, reason: "补读字符预算已用尽", remainingCharacters: 0 } };
    if ((request.type === "branch_history" || request.type === "attempts") && policy.trajectory === false ||
      request.type === "dialog" && policy.dialog === false) {
      return { result: { type: request.type, unavailable: true, reason: "该信息在当前评估条件中不可读取" } };
    }
    const ownNodes = () => {
      const nodes = graph.nodes.filter((node) => ids.includes(node.id));
      if (!ids.length || nodes.length !== ids.length) throw new BadRequestException("补读节点必须属于当前项目画布");
      return nodes;
    };
    let data: unknown;
    let visual: VisualContextResult | undefined;
    switch (request.type) {
      case "nodes": data = ownNodes().map((node) => policyNode(projectNode(node, true), policy)); break;
      case "images": {
        const nodes = ownNodes();
        visual = await this.visual.enrich(userId, projectId, nodes, ids);
        data = { index: visual.index, coverage: visual.coverage };
        break;
      }
      case "attempts": {
        if (!ids.length) throw new BadRequestException("请指定实际执行尝试编号");
        const rows = await this.database.workflowAttempt.findMany({ where: { projectId, id: { in: ids } }, orderBy: { createdAt: "asc" }, take: 16 });
        if (rows.length !== ids.length) throw new BadRequestException("执行尝试不存在或不属于当前项目");
        data = rows.map(projectAttempt);
        break;
      }
      case "branch_history": {
        ownNodes();
        const related = relatedNodeIds(graph, ids);
        const tools = graph.nodes.filter((node) => related.has(node.id) && node.kind === "tool").map((node) => node.id);
        const history = await this.readHistory(userId, projectId, graph, ids, related, tools, policy, remaining);
        if (!history) return { result: { type: request.type, ids, unavailable: true, hasMore: true,
          reason: "剩余补读预算不足以返回结构化历史范围，未跳过任何记录", remainingCharacters: MAX_READ_CHARACTERS - this.characters } };
        this.characters += JSON.stringify(history).length;
        return { result: { type: request.type, ids, data: history, hasMore: history.hasMore, truncated: false,
          remainingCharacters: MAX_READ_CHARACTERS - this.characters } };
      }
      case "dialog": {
        if (!conversationId) throw new BadRequestException("本次规划没有可读取的会话");
        const conversation = await this.database.agentConversation.findFirst({ where: { id: conversationId, projectId, createdById: userId }, select: { id: true } });
        if (!conversation) throw new BadRequestException("补读会话不属于当前项目或设计师");
        const rows = await this.database.agentMessage.findMany({ where: { conversationId,
          ...(ids.length ? { id: { in: ids } } : {}), OR: [{ role: "USER" }, { status: "COMPLETED" }] },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: ids.length || 12,
          select: { id: true, content: true, role: true, createdAt: true } });
        if (ids.length && rows.length !== ids.length) throw new BadRequestException("对话原文不存在或不属于当前会话");
        const messages: unknown[] = [];
        const omittedMessageIds: string[] = [];
        for (const [index, row] of rows.reverse().entries()) {
          const key = `${conversationId}:${row.id}`;
          const content = safeContextText(row.content, row.content.length);
          const start = this.dialogOffsets.get(key) ?? 0;
          const available = Math.max(0, Math.floor((remaining - JSON.stringify({ messages, omittedMessageIds }).length - 400) / Math.max(1, rows.length - index)));
          let end = Math.min(content.length, start + available);
          let item = { id: row.id, role: row.role, content: content.slice(start, end), range: { start, end, total: content.length }, hasMore: end < content.length, createdAt: row.createdAt.toISOString() };
          while (end > start && JSON.stringify({ messages: [...messages, item], omittedMessageIds }).length > remaining) {
            end = start + Math.floor((end - start) / 2);
            item = { ...item, content: content.slice(start, end), range: { start, end, total: content.length }, hasMore: end < content.length };
          }
          if (JSON.stringify({ messages: [...messages, item], omittedMessageIds }).length > remaining || end === start && content.length > start) { omittedMessageIds.push(row.id); continue; }
          messages.push(item); this.dialogOffsets.set(key, end);
        }
        data = { messages, omittedMessageIds, note: "range以去除图片地址后的原文字符计数；同一消息重复补读会继续下一段，不回到开头。" };
        break;
      }
    }
    const encoded = JSON.stringify(data);
    this.characters += Math.min(remaining, encoded.length);
    return { result: { type: request.type, ids, ...(encoded.length <= remaining ? { data } : { excerpt: encoded.slice(0, remaining) }),
      truncated: encoded.length > remaining, remainingCharacters: Math.max(0, MAX_READ_CHARACTERS - this.characters),
      note: "原文摘录截断时必须说明未读取部分，不能据此虚构信息。" }, ...(visual ? { visual } : {}) };
  }

  private async readHistory(userId: string, projectId: string, graph: Graph, ids: string[], related: Set<string>, tools: string[], policy: ReadPolicy, limit: number) {
    const key = JSON.stringify([userId, projectId, graph.revision, [...ids].sort(), policy.hiddenIntent !== false]);
    const bucket = (records: HistoryRecord[] = [], more = false): HistoryBucket => ({ records, index: 0, read: 0, more });
    let state = cloneHistoryState(this.historyProgress.get(key) ?? {
      nodes: bucket(graph.nodes.filter((node) => related.has(node.id)).sort((a, b) => a.id.localeCompare(b.id)).map((node) => ({ id: node.id, value: policyNode(projectNode(node, true), policy) }))),
      edges: bucket(graph.edges.filter((edge) => related.has(edge.sourceNodeId) && related.has(edge.targetNodeId)).sort((a, b) => a.id.localeCompare(b.id)).map((edge) => ({ id: edge.id, value: edge }))),
      attempts: bucket([], true), versions: bucket([], true),
    });
    const start = Object.fromEntries(HISTORY_COLLECTIONS.map((collection) => [collection, state[collection].read])) as Record<HistoryCollection, number>;
    const page = emptyHistoryPage();
    const output = () => historyPageData(page, state, start, graph.revision);
    if (JSON.stringify(output()).length > limit) return null;
    const load = async (collection: "attempts" | "versions") => {
      const current = state[collection];
      if (current.index < current.records.length || !current.more) return;
      const after = current.cursor ? { AND: [{ OR: [{ createdAt: { lt: current.cursor.createdAt } }, { createdAt: current.cursor.createdAt, id: { lt: current.cursor.id } }] }] } : {};
      const size = collection === "attempts" ? 30 : 40;
      const rows = collection === "attempts"
        ? await this.database.workflowAttempt.findMany({ where: { projectId, toolNodeId: { in: tools }, ...after }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: size + 1 })
        : await this.database.workflowNodeVersion.findMany({ where: { projectId, graphRevision: { lte: graph.revision }, nodeId: { in: [...related] }, ...after }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: size + 1 });
      const included = rows.slice(0, size);
      current.records = included.map((row) => ({ id: row.id, value: collection === "attempts" ? projectAttempt(row as Parameters<typeof projectAttempt>[0]) : (() => {
        const version = row as Awaited<ReturnType<PrismaClient["workflowNodeVersion"]["findMany"]>>[number];
        return { id: version.id, nodeId: version.nodeId, version: version.version, baseline: version.baseline,
          graphRevision: version.graphRevision, createdAt: version.createdAt.toISOString(), previousVersionId: version.previousVersionId,
          origin: version.origin, mutationId: version.mutationId,
          content: policyNode(projectNode({ ...version, status: "historical" }, true), policy), inputBindings: projectVersionInputs(version.inputBindings) };
      })() }));
      current.index = 0;
      current.more = rows.length > size;
      const last = included.at(-1);
      if (last) current.cursor = { id: last.id, createdAt: last.createdAt };
    };
    await Promise.all([load("attempts"), load("versions")]);
    if (JSON.stringify(output()).length > limit) return null;
    const advance = (next: HistoryState, collection: HistoryCollection) => { next[collection].index += 1; next[collection].read += 1; };
    const blocked = new Set<HistoryCollection>();
    while (blocked.size < HISTORY_COLLECTIONS.length) {
      for (const collection of HISTORY_COLLECTIONS) {
        if (blocked.has(collection)) continue;
        if (collection === "attempts" || collection === "versions") {
          const beforeLoad = { ...state[collection] };
          await load(collection);
          // Fetching a new page can enlarge its next-record metadata. Keep that page
          // unread rather than returning an oversized result or advancing its cursor.
          if (JSON.stringify(output()).length > limit) { state[collection] = beforeLoad; blocked.add(collection); continue; }
        }
        const current = state[collection], record = current.records[current.index];
        if (!record) { blocked.add(collection); continue; }
        // A record fits atomically whenever possible; only oversized records need field fragments.
        if (!record.fields) {
          const next = cloneHistoryState(state);
          advance(next, collection);
          page[collection].push(record.value);
          if (JSON.stringify(historyPageData(page, next, start, graph.revision)).length <= limit) { state = next; continue; }
          page[collection].pop();
        }
        const fields = record.fields ?? historyFields(record.value), fieldIndex = record.fieldIndex ?? 0, offset = record.characterOffset ?? 0;
        const field = fields[fieldIndex];
        if (!field) { blocked.add(collection); continue; }
        const build = (characters?: number) => {
          const next = cloneHistoryState(state);
          const isText = typeof field.value === "string", text = isText ? field.value as string : "";
          const end = isText ? offset + (characters ?? text.length - offset) : 0;
          const fieldFinished = !isText || end === text.length;
          const complete = fieldFinished && fieldIndex + 1 === fields.length;
          const part: HistoryField = isText && (offset > 0 || !fieldFinished) ? { path: field.path, value: text.slice(offset, end), range: { start: offset, end, total: text.length } } : field;
          const fragment: HistoryFragment = { collection, recordId: record.id, fields: [part], complete };
          const previous = page.fragments.at(-1);
          const merged = previous?.collection === collection && previous.recordId === record.id;
          const fragments = merged ? [...page.fragments.slice(0, -1), { ...previous, fields: [...previous.fields, part], complete }] : [...page.fragments, fragment];
          if (complete) advance(next, collection);
          else next[collection].records[current.index] = { ...record, fields, fieldIndex: fieldFinished ? fieldIndex + 1 : fieldIndex, characterOffset: fieldFinished ? 0 : end };
          return { next, fragments, length: JSON.stringify(historyPageData({ ...page, fragments }, next, start, graph.revision)).length };
        };
        let candidate = build();
        if (candidate.length > limit && typeof field.value === "string" && field.value.length > offset) {
          let low = 0, high = field.value.length - offset;
          while (low < high) { const middle = Math.ceil((low + high) / 2); if (build(middle).length <= limit) low = middle; else high = middle - 1; }
          if (!low) { blocked.add(collection); continue; }
          candidate = build(low);
        }
        if (candidate.length > limit) { blocked.add(collection); continue; }
        state = candidate.next; page.fragments = candidate.fragments;
      }
    }
    this.historyProgress.set(key, state);
    return output();
  }
}
