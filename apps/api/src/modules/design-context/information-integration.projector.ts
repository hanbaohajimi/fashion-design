import { contextObject, contextText, projectNode, projectParameters, safeContextText, stringIds } from "./design-context.projector";
import { WORKFLOW_TOOL_KEYS, getWorkflowToolContract, type WorkflowToolKey } from "@fashion/shared";

export interface NodeVersionFact {
  id: string; projectId: string; nodeId: string; version: number; graphRevision: number;
  kind: string; type: string; title: string; payload: unknown; inputBindings: unknown;
  previousVersionId: string | null; origin: string; baseline: boolean; createdAt: Date;
  mutationId?: string | null;
}
export interface VersionInput { sourceNodeId: string; sourceNodeVersionId: string | null; sourcePort: string; targetPort: string }
export interface EpisodeEvidenceOptions {
  attemptsComplete?: boolean;
  decisionsComplete?: boolean;
  executionsComplete?: boolean;
  executions?: readonly { id: string; toolNodeId: string; nodeVersionId: string | null; status: string }[];
}
export function compareVersionTime(a: NodeVersionFact, b: NodeVersionFact): number {
  return a.graphRevision - b.graphRevision || a.createdAt.getTime() - b.createdAt.getTime() || a.version - b.version || a.id.localeCompare(b.id);
}
export function versionPredecessorIds(versions: readonly NodeVersionFact[]): string[] {
  return [...new Set(versions.flatMap((version) => [version.previousVersionId, contextText(contextObject(version.payload).forkedFromNodeVersionId, 128)]).filter((id): id is string => Boolean(id)))];
}
/** A fork is a causal parent only when its immutable, same-project source matches both identifiers. */
export function versionParent(version: NodeVersionFact, versions: ReadonlyMap<string, NodeVersionFact>): NodeVersionFact | null {
  if (version.previousVersionId) {
    const previous = versions.get(version.previousVersionId);
    return previous && previous.projectId === version.projectId && previous.nodeId === version.nodeId && previous.type === version.type && previous.kind === version.kind && previous.version < version.version && previous.graphRevision <= version.graphRevision ? previous : null;
  }
  const payload = contextObject(version.payload);
  const sourceId = contextText(payload.forkedFromNodeVersionId, 128), sourceNodeId = contextText(payload.forkedFromNodeId, 128);
  const source = sourceId ? versions.get(sourceId) : undefined;
  return version.origin === "proposal" && version.kind === "tool" && source && source.projectId === version.projectId && source.nodeId === sourceNodeId && source.nodeId !== version.nodeId && source.kind === version.kind && source.type === version.type && source.graphRevision <= version.graphRevision ? source : null;
}
export function projectVersionInputs(value: unknown): VersionInput[] {
  return (Array.isArray(value) ? value : []).map((value) => {
    const input = contextObject(value);
    return { sourceNodeId: contextText(input.sourceNodeId, 128), sourceNodeVersionId: contextText(input.sourceNodeVersionId, 128) || null, sourcePort: contextText(input.sourcePort, 80), targetPort: contextText(input.targetPort, 80) };
  }).filter((input) => input.sourceNodeId).slice(0, 32);
}
function meaning(version: NodeVersionFact) {
  const payload = contextObject(version.payload);
  const defaults = (WORKFLOW_TOOL_KEYS as readonly string[]).includes(version.type) ? getWorkflowToolContract(version.type as WorkflowToolKey).defaults : {};
  return { title: safeContextText(version.title, 300), parameters: projectParameters({ ...defaults, ...contextObject(payload.params ?? payload) }), inputs: projectVersionInputs(version.inputBindings), content: safeContextText(payload.text, 4_000) };
}
export function semanticVersionChanges(versions: readonly NodeVersionFact[]) {
  const byId = new Map(versions.map((version) => [version.id, version]));
  return [...versions].sort(compareVersionTime).flatMap((version) => {
    if (version.baseline || version.kind !== "tool" || !["user", "proposal"].includes(version.origin)) return [];
    const previous = versionParent(version, byId);
    if (!previous) return [];
    const before = meaning(previous), after = meaning(version);
    const changedParameterKeys = [...new Set([...Object.keys(before.parameters), ...Object.keys(after.parameters)])].filter((key) => JSON.stringify(before.parameters[key]) !== JSON.stringify(after.parameters[key]));
    const logicalInputs = (inputs: VersionInput[]) => inputs.map(({ sourceNodeId, sourcePort, targetPort }) => ({ sourceNodeId, sourcePort, targetPort })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const inputsChanged = JSON.stringify(logicalInputs(before.inputs)) !== JSON.stringify(logicalInputs(after.inputs));
    const contentChanged = before.content !== after.content;
    if (!changedParameterKeys.length && !inputsChanged && !contentChanged) return [];
    const changedFields = [...changedParameterKeys.map((key) => `parameters.${key}`), ...(inputsChanged ? ["inputBindings"] : []), ...(contentChanged ? ["content"] : [])];
    const evidenceAfter = { parameters: Object.fromEntries(changedParameterKeys.filter((key) => key in after.parameters).map((key) => [key, after.parameters[key]])), inputs: inputsChanged ? after.inputs : [], content: contentChanged ? after.content : "" };
    return [{ id: version.id, nodeId: version.nodeId, beforeNodeId: previous.nodeId, beforeVersionId: previous.id, afterVersionId: version.id, fork: previous.nodeId !== version.nodeId, graphRevision: version.graphRevision, before, after, changedFields, evidenceAfter, detailsIncluded: true, detailNote: null as string | null, createdAt: version.createdAt.toISOString() }];
  });
}
export function projectVersionEpisodes(versions: readonly NodeVersionFact[], attempts: readonly { id: string; toolNodeId: string; status: string; [key: string]: unknown }[], decisions: readonly { assetId: string; reason: string; [key: string]: unknown }[], evidence: EpisodeEvidenceOptions = {}) {
  const changes = new Map(semanticVersionChanges(versions).map((change) => [change.afterVersionId, change]));
  const byId = new Map(versions.map((version) => [version.id, version]));
  return [...versions].sort(compareVersionTime).map((version) => {
    const node = projectNode({ id: version.nodeId, kind: version.kind, type: version.type, title: version.title, status: "version_snapshot", payload: version.payload }, true);
    const inputs = projectVersionInputs(version.inputBindings);
    const change = changes.get(version.id);
    const parent = versionParent(version, byId);
    const assetId = contextText(contextObject(version.payload).assetId, 128);
    const sourceIds = stringIds(inputs.map((input) => input.sourceNodeId));
    const nodeAttempts = attempts.filter((attempt) => attempt.toolNodeId === version.nodeId).map((attempt) => {
      const direct = contextText(attempt.nodeVersionId, 128);
      const frozen = contextText(contextObject(attempt.requestSnapshot).nodeVersionId, 128);
      return { attempt, versionId: direct || frozen, conflict: Boolean(direct && frozen && direct !== frozen) };
    });
    const matchedAttempts = nodeAttempts.filter((binding) => !binding.conflict && binding.versionId === version.id).map(({ attempt }) => ({ id: attempt.id, status: attempt.status }));
    const matchedDecisions = assetId ? decisions.filter((decision) => decision.assetId === assetId) : [];
    const nodeExecutions = (evidence.executions ?? []).filter((execution) => execution.toolNodeId === version.nodeId);
    const matchedExecutions = nodeExecutions.filter((execution) => execution.nodeVersionId === version.id).map(({ id, status }) => ({ id, status }));
    const inputCount = Array.isArray(version.inputBindings) ? version.inputBindings.length : null;
    const inputDescription = sourceIds.join("、") || (inputCount === null ? "输入记录未提供" : inputCount > 0 ? "输入记录未能解析" : "未连接输入");
    return {
      nodeId: version.nodeId, nodeVersionId: version.id, previousVersionId: version.previousVersionId,
      assetId: assetId || null,
      sourceNodeId: parent?.nodeId ?? null, sourceNodeVersionId: parent?.id ?? null,
      version: version.version, graphRevision: version.graphRevision, baseline: version.baseline,
      historyMissing: version.baseline || Boolean((version.previousVersionId || contextText(contextObject(version.payload).forkedFromNodeVersionId, 128)) && !parent),
      origin: version.origin, node, inputs,
      detailsIncluded: true, hasSemanticChange: Boolean(change),
      sourceMutationId: version.mutationId ?? null,
      changes: change ? [{ beforeNodeId: change.beforeNodeId, beforeVersionId: change.beforeVersionId, afterVersionId: change.afterVersionId, before: change.before, after: change.after, changedFields: change.changedFields, fork: change.fork }] : [],
      attempts: matchedAttempts, decisions: matchedDecisions, executions: matchedExecutions,
      historyCoverage: {
        absenceClaimAllowed: false,
        inputs: { total: inputCount, included: inputs.length, omitted: inputCount === null ? null : Math.max(0, inputCount - inputs.length) },
        attempts: { included: matchedAttempts.length, loadedMatches: matchedAttempts.length, omittedForBudget: 0, complete: evidence.attemptsComplete === true, unversionedLoaded: nodeAttempts.filter((binding) => !binding.versionId).length, conflictingLoaded: nodeAttempts.filter((binding) => binding.conflict).length },
        decisions: { included: matchedDecisions.length, loadedMatches: matchedDecisions.length, omittedForBudget: 0, complete: evidence.decisionsComplete === true, association: "asset_id_events_not_version_time_snapshot" },
        executions: { included: matchedExecutions.length, loadedMatches: matchedExecutions.length, omittedForBudget: 0, complete: evidence.executionsComplete === true, unversionedLoaded: nodeExecutions.filter((execution) => !execution.nodeVersionId).length },
      },
      description: `${inputDescription}${inputCount !== null && inputCount > inputs.length ? `（另有${inputCount - inputs.length}条输入未投影）` : ""} → ${safeContextText(version.title, 120)} v${version.version}${parent && parent.nodeId !== version.nodeId ? `（从${parent.nodeId}的v${parent.version}派生）` : ""}${change ? "（已记录输入／参数调整）" : version.baseline ? "（当前基线，未补造此前历史）" : ""}`,
      createdAt: version.createdAt.toISOString(),
    };
  });
}
