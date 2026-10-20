import { Prisma, type WorkflowEdge, type WorkflowNode, type WorkflowNodeVersion } from "../generated/prisma/client.js";

export interface WorkflowVersionNode {
  readonly id: string;
  readonly kind: string;
  readonly type: string;
  readonly title: string;
  readonly payload: unknown;
  readonly status?: string;
}

export interface WorkflowVersionEdge {
  readonly id: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly sourcePort: string;
  readonly targetPort: string;
}

export interface WorkflowVersionBinding {
  readonly edgeId: string;
  readonly sourceNodeId: string;
  readonly sourceNodeVersionId: string;
  readonly sourcePort: string;
  readonly targetPort: string;
}

export interface WorkflowVersionSnapshot {
  readonly nodes: readonly WorkflowVersionNode[];
  readonly edges: readonly WorkflowVersionEdge[];
}

/** Internal records contain durable identifiers and text, never inline image bytes. */
function safeJson(value: unknown): Prisma.InputJsonValue {
  if (typeof value === "string") return value.startsWith("data:") ? "[inline content omitted]" : value;
  if (value === null || typeof value === "number" || typeof value === "boolean") return value as Prisma.InputJsonValue;
  if (Array.isArray(value)) return value.map(safeJson);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).filter(([, item]) => item !== undefined).map(([key, item]) => [key, safeJson(item)]));
  return String(value);
}

function semanticPayload(node: WorkflowVersionNode): Prisma.InputJsonValue {
  if (node.kind === "tool" && node.payload && !Array.isArray(node.payload) && typeof node.payload === "object") {
    const payload = node.payload as Record<string, unknown>;
    return safeJson({ toolKey: payload.toolKey, toolVersion: payload.toolVersion, params: payload.params,
      forkedFromNodeId: payload.forkedFromNodeId, forkedFromNodeVersionId: payload.forkedFromNodeVersionId });
  }
  return safeJson(node.payload);
}

function orderedNodes(nodes: readonly WorkflowVersionNode[], edges: readonly WorkflowVersionEdge[]): WorkflowVersionNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const visiting = new Set<string>();
  const result: WorkflowVersionNode[] = [];
  const visit = (node: WorkflowVersionNode): void => {
    if (seen.has(node.id)) return;
    if (visiting.has(node.id)) throw new Error("Workflow node versions require an acyclic graph");
    visiting.add(node.id);
    for (const edge of edges.filter((item) => item.targetNodeId === node.id).sort((a, b) => a.id.localeCompare(b.id))) {
      const source = byId.get(edge.sourceNodeId);
      if (source) visit(source);
    }
    visiting.delete(node.id);
    seen.add(node.id);
    result.push(node);
  };
  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) visit(node);
  return result;
}

function bindingsFor(nodeId: string, edges: readonly WorkflowVersionEdge[], versions: ReadonlyMap<string, WorkflowNodeVersion>): WorkflowVersionBinding[] {
  return edges.filter((edge) => edge.targetNodeId === nodeId).sort((a, b) => a.id.localeCompare(b.id)).map((edge) => {
    const source = versions.get(edge.sourceNodeId);
    if (!source) throw new Error(`Missing source node version: ${edge.sourceNodeId}`);
    return { edgeId: edge.id, sourceNodeId: edge.sourceNodeId, sourceNodeVersionId: source.id, sourcePort: edge.sourcePort, targetPort: edge.targetPort };
  });
}

async function latestVersions(transaction: Prisma.TransactionClient, projectId: string, nodeIds: readonly string[]): Promise<Map<string, WorkflowNodeVersion>> {
  if (!nodeIds.length) return new Map();
  const rows = await transaction.$queryRaw<WorkflowNodeVersion[]>(Prisma.sql`
    SELECT DISTINCT ON (v.node_id) v.id, v.node_id AS "nodeId", v.project_id AS "projectId", v.version,
      v.graph_revision AS "graphRevision", v.kind, v.type, v.title, v.payload, v.input_bindings AS "inputBindings",
      v.previous_version_id AS "previousVersionId", v.origin, v.actor_id AS "actorId", v.mutation_id AS "mutationId",
      v.baseline, v.created_at AS "createdAt"
    FROM workflow_node_versions v
    WHERE v.project_id = ${projectId} AND v.node_id IN (${Prisma.join([...nodeIds])}) ORDER BY v.node_id, v.version DESC`);
  const result = new Map<string, WorkflowNodeVersion>();
  for (const row of rows) if (!result.has(row.nodeId)) result.set(row.nodeId, row);
  return result;
}

/** Call inside the graph transaction. The graph row serializes baseline creation. */
export async function ensureWorkflowNodeVersions(
  transaction: Prisma.TransactionClient,
  projectId: string,
  graphRevision: number,
  suppliedNodes?: readonly WorkflowVersionNode[],
  suppliedEdges?: readonly WorkflowVersionEdge[],
): Promise<Map<string, WorkflowNodeVersion>> {
  await transaction.$queryRaw(Prisma.sql`SELECT "project_id" FROM "workflow_graphs" WHERE "project_id" = ${projectId} FOR UPDATE`);
  const nodes: readonly WorkflowVersionNode[] = suppliedNodes ?? await transaction.workflowNode.findMany({ where: { projectId } });
  const edges: readonly WorkflowVersionEdge[] = suppliedEdges ?? await transaction.workflowEdge.findMany({ where: { projectId } });
  const versions = await latestVersions(transaction, projectId, nodes.map((node) => node.id));
  for (const node of orderedNodes(nodes, edges)) {
    if (versions.has(node.id)) continue;
    const row = await transaction.workflowNodeVersion.create({ data: {
      projectId, nodeId: node.id, version: 1, graphRevision, kind: node.kind, type: node.type, title: node.title,
      payload: semanticPayload(node), inputBindings: safeJson(bindingsFor(node.id, edges, versions)),
      origin: "baseline", baseline: true,
    } });
    versions.set(node.id, row);
  }
  return versions;
}

export function workflowVersionSnapshot(nodes: readonly WorkflowVersionNode[] | readonly WorkflowNode[], edges: readonly WorkflowVersionEdge[] | readonly WorkflowEdge[]): Prisma.InputJsonObject {
  return safeJson({
    nodes: [...nodes].sort((a, b) => a.id.localeCompare(b.id)).map((node) => ({ id: node.id, kind: node.kind, type: node.type, title: node.title, payload: node.payload, status: node.status })),
    edges: [...edges].sort((a, b) => a.id.localeCompare(b.id)).map((edge) => ({ id: edge.id, sourceNodeId: edge.sourceNodeId, targetNodeId: edge.targetNodeId, sourcePort: edge.sourcePort, targetPort: edge.targetPort })),
  }) as Prisma.InputJsonObject;
}

export async function appendWorkflowOutbox(transaction: Prisma.TransactionClient, input: {
  readonly projectId: string;
  readonly eventKey: string;
  readonly eventType: string;
  readonly executionId?: string | null;
  readonly attemptId?: string | null;
  readonly generationTaskId?: string | null;
  readonly payload: unknown;
}) {
  return transaction.workflowOutbox.upsert({
    where: { eventKey: input.eventKey }, update: {},
    create: { ...input, payload: safeJson(input.payload) },
  });
}

export async function recordWorkflowSemanticChange(transaction: Prisma.TransactionClient, input: {
  readonly projectId: string;
  readonly mutationId: string;
  readonly baseRevision: number;
  readonly resultRevision: number;
  readonly actorId: string;
  readonly origin: string;
  readonly before: WorkflowVersionSnapshot;
  readonly after: WorkflowVersionSnapshot;
}): Promise<void> {
  const versions = await ensureWorkflowNodeVersions(transaction, input.projectId, input.baseRevision, input.before.nodes, input.before.edges);
  const edgeSignature = (edges: readonly WorkflowVersionEdge[]) => JSON.stringify([...edges].sort((a, b) => a.id.localeCompare(b.id)).map((edge) => ({ id: edge.id, sourceNodeId: edge.sourceNodeId, targetNodeId: edge.targetNodeId, sourcePort: edge.sourcePort, targetPort: edge.targetPort })));
  let changed = input.before.nodes.length !== input.after.nodes.length || edgeSignature(input.before.edges) !== edgeSignature(input.after.edges);
  for (const node of orderedNodes(input.after.nodes, input.after.edges)) {
    const previous = versions.get(node.id);
    const payload = semanticPayload(node);
    const inputBindings = safeJson(bindingsFor(node.id, input.after.edges, versions));
    if (previous && previous.title === node.title && previous.kind === node.kind && previous.type === node.type && JSON.stringify(safeJson(previous.payload)) === JSON.stringify(payload) && JSON.stringify(safeJson(previous.inputBindings)) === JSON.stringify(inputBindings)) continue;
    changed = true;
    const row = await transaction.workflowNodeVersion.create({ data: {
      projectId: input.projectId, nodeId: node.id, version: (previous?.version ?? 0) + 1,
      graphRevision: input.resultRevision, kind: node.kind, type: node.type, title: node.title, payload, inputBindings,
      previousVersionId: previous?.id ?? null, origin: input.origin, actorId: input.actorId, mutationId: input.mutationId,
    } });
    versions.set(node.id, row);
  }
  if (changed) await appendWorkflowOutbox(transaction, {
    projectId: input.projectId, eventKey: `workflow:${input.projectId}:${input.mutationId}:semantic`, eventType: "workflow.semantic_changed",
    payload: { mutationId: input.mutationId, baseRevision: input.baseRevision, resultRevision: input.resultRevision, actorId: input.actorId, origin: input.origin },
  });
}

/** Persist together with the terminal task CAS; repeated deliveries share one event key. */
export async function appendGenerationTerminalOutbox(transaction: Prisma.TransactionClient, input: {
  readonly taskId: string;
  readonly status: "SUCCEEDED" | "FAILED" | "CANCELED" | "MODERATION_FAILED";
  readonly assetIds?: readonly string[];
  readonly errorCode?: string | null;
}): Promise<void> {
  const attempts = await transaction.workflowAttempt.findMany({ where: { generationTaskId: input.taskId }, select: { id: true, projectId: true, executionId: true } });
  for (const attempt of attempts) await appendWorkflowOutbox(transaction, {
    projectId: attempt.projectId, eventKey: `generation:${input.taskId}:${attempt.id}:terminal`, eventType: "generation.terminal",
    executionId: attempt.executionId, attemptId: attempt.id, generationTaskId: input.taskId,
    payload: { status: input.status, assetIds: [...(input.assetIds ?? [])], errorCode: input.errorCode ?? null },
  });
}
