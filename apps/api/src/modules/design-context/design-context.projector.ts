import { createHash } from "node:crypto";
import type { ContextItem } from "./design-context.schemas";

/** A prompt projection deliberately never serializes arbitrary node payloads. */
export interface ContextGraphNode {
  readonly id: string;
  readonly kind: string;
  readonly type: string;
  readonly title: string;
  readonly status: string;
  readonly payload: unknown;
}
export interface ContextGraphEdge {
  readonly id: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly sourcePort: string;
  readonly targetPort: string;
}
export interface ContextGraph {
  readonly projectId: string;
  readonly revision: number;
  readonly nodes: readonly ContextGraphNode[];
  readonly edges: readonly ContextGraphEdge[];
}

export function contextObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function contextText(value: unknown, limit = 2_000): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}
export function safeContextText(value: unknown, limit = 2_000): string {
  return contextText(value, limit).replace(/(?:https?:\/\/|s3:\/\/|data:image\/)[^\s"<>]+/giu, "[图片地址已省略]");
}
/** Only scalar values count as quotes; JSON keys and serialization escapes are not evidence. */
export function contextContainsQuote(value: unknown, quote: string): boolean {
  if (typeof value === "string") return value.includes(quote);
  if (typeof value === "number" || typeof value === "boolean") return String(value) === quote;
  if (Array.isArray(value)) return value.some((item) => contextContainsQuote(item, quote));
  return value !== null && typeof value === "object" && Object.values(value).some((item) => contextContainsQuote(item, quote));
}

const scalarKeys = ["prompt", "negativePrompt", "taskType", "width", "height", "quality", "count", "outputFormat", "background"] as const;
export function projectParameters(value: unknown) {
  const source = contextObject(value);
  const result: Record<string, unknown> = {};
  for (const key of scalarKeys) {
    const field = source[key];
    if (typeof field === "string") result[key] = safeContextText(field, key.endsWith("Prompt") || key === "prompt" ? 4_000 : 80);
    else if (typeof field === "number" && Number.isFinite(field) || typeof field === "boolean") result[key] = field as number | boolean;
  }
  if (Array.isArray(source.referenceInputs)) result.referenceInputs = source.referenceInputs.slice(0, 16).map((value) => {
    const input = contextObject(value);
    return { nodeId: contextText(input.nodeId, 128), role: contextText(input.role, 80), weight: typeof input.weight === "number" && Number.isFinite(input.weight) ? input.weight : null };
  });
  if (source.mask) {
    const mask = contextObject(source.mask);
    result.mask = { ...(typeof mask.assetId === "string" ? { assetId: contextText(mask.assetId, 128) } : {}), ...(typeof mask.fileAssetId === "string" ? { fileAssetId: contextText(mask.fileAssetId, 128) } : {}) };
  }
  if (Array.isArray(source.palette)) result.palette = source.palette.slice(0, 12).map((value) => {
    const color = contextObject(value);
    return { hex: contextText(color.hex, 7), name: safeContextText(color.name, 48) };
  });
  return result;
}

export function projectBrief(value: unknown) {
  const brief = contextObject(value);
  return {
    summary: safeContextText(brief.summary),
    garmentType: safeContextText(brief.garmentType, 120) || null,
    constraints: (Array.isArray(brief.constraints) ? brief.constraints : []).slice(0, 24).map((item) => {
      const constraint = contextObject(item);
      return {
        id: contextText(constraint.id, 128), requirement: safeContextText(constraint.requirement, 600),
        dimension: contextText(constraint.dimension, 40), mode: contextText(constraint.mode, 40),
        priority: contextText(constraint.priority, 40), origin: contextText(constraint.origin, 40),
        verification: contextText(constraint.verification, 40),
        evidenceIds: stringIds(constraint.evidenceIds), sourceQuote: safeContextText(constraint.sourceQuote, 600) || null,
      };
    }),
    unknowns: textList(brief.unknowns, 24, 300),
  };
}

/** Graph constraints remain attached to their producing branch, including in a global overview. */
export function projectGraphRequirements(graph: ContextGraph, related: ReadonlySet<string>, hasFocus: boolean): ContextItem[] {
  const modes: Record<string, string> = { require: "要求", preserve: "保留", change: "修改", avoid: "避免" };
  const verification: Record<string, string> = { visual: "视觉观察", requires_measurement: "需要测量或试穿资料", requires_specification: "需要规格或性能资料" };
  return graph.nodes.filter((node) => node.type === "constraint" && (!hasFocus || related.has(node.id))).flatMap((node) => {
    const brief = contextObject(contextObject(node.payload).brief);
    return (Array.isArray(brief.constraints) ? brief.constraints : []).slice(0, 24).flatMap((value, index) => {
      const constraint = contextObject(value);
      const requirement = safeContextText(constraint.requirement, 1_500);
      if (!requirement) return [];
      const origin = constraint.origin === "explicit" ? "explicit" as const : "inferred" as const;
      const label = modes[contextText(constraint.mode, 40)] ?? "要求";
      const check = verification[contextText(constraint.verification, 40)];
      return [{
        id: `graph_${createHash("sha256").update(`${node.id}\0${contextText(constraint.id, 128) || index}`).digest("hex").slice(0, 32)}`,
        kind: "requirement" as const,
        text: `${label}：${requirement}${check ? `（验证：${check}）` : ""}`,
        origin, priority: origin === "explicit" && constraint.priority === "must" ? "must" as const : "prefer" as const,
        status: "active" as const, scope: "branch" as const, branchNodeIds: [node.id],
        sourceMessageId: null, sourceNodeIds: [node.id], sourceQuote: safeContextText(constraint.sourceQuote, 2_000) || requirement,
      }];
    });
  });
}

export function projectEvaluation(value: unknown) {
  const report = contextObject(value);
  return {
    constraintNodeId: contextText(report.constraintNodeId, 128),
    inputNodeIds: stringIds(report.inputNodeIds),
    evaluations: (Array.isArray(report.evaluations) ? report.evaluations : []).slice(0, 4).map((value) => {
      const evaluation = contextObject(value);
      return {
        assetId: contextText(evaluation.assetId, 128), attemptId: contextText(evaluation.attemptId, 128),
        summary: safeContextText(evaluation.summary, 800),
        checks: (Array.isArray(evaluation.checks) ? evaluation.checks : []).slice(0, 24).map((value) => {
          const check = contextObject(value);
          return { constraintId: contextText(check.constraintId, 128), status: contextText(check.status, 40), observation: safeContextText(check.observation, 500) };
        }),
        nextActions: textList(evaluation.nextActions, 8, 300),
      };
    }),
  };
}

function textList(value: unknown, count: number, length: number): string[] {
  return (Array.isArray(value) ? value : []).map((item) => safeContextText(item, length)).filter(Boolean).slice(0, count);
}
export function stringIds(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => contextText(item, 128)).filter(Boolean))].slice(0, 100);
}

export function projectNode(node: ContextGraphNode, detailed: boolean) {
  const payload = contextObject(node.payload);
  const base = { id: node.id, kind: node.kind, type: node.type, title: safeContextText(node.title, 200), status: node.status };
  if (!detailed) return { ...base, detailIncluded: false as const };
  const decision = contextObject(payload.decision);
  return {
    ...base, detailIncluded: true as const,
    content: safeContextText(payload.text, 2_000),
    role: contextText(payload.role, 80),
    assetId: contextText(payload.assetId, 128) || null,
    fileAssetId: contextText(payload.fileAssetId, 128) || null,
    fabricId: contextText(payload.fabricId, 128) || null,
    trendItemId: contextText(payload.trendItemId, 128) || null,
    color: contextText(payload.color, 40), colors: textList(payload.colors, 24, 40),
    tags: textList(payload.tags ?? payload.fabricTags, 30, 120),
    rationale: safeContextText(payload.rationale, 800),
    ...(node.kind === "tool" ? { parameters: projectParameters(payload.params), toolVersion: contextText(payload.toolVersion, 40) } : {}),
    ...(node.type === "constraint" ? { brief: projectBrief(payload.brief) } : {}),
    ...(node.type === "evaluation" ? { report: projectEvaluation(payload.report) } : {}),
    ...(decision.kind ? { decision: { id: contextText(decision.id, 128), kind: contextText(decision.kind, 40), reason: safeContextText(decision.reason, 1_000) } } : {}),
  };
}

/** Separate upstream/downstream traversals avoid merging sibling branches through a shared parent. */
export function relatedNodeIds(graph: ContextGraph, focus: readonly string[]): Set<string> {
  const result = new Set(focus);
  for (const direction of ["upstream", "downstream"] as const) {
    const seen = new Set(focus);
    const pending = [...focus];
    while (pending.length) {
      const id = pending.pop();
      for (const edge of graph.edges) {
        const next = direction === "upstream"
          ? edge.targetNodeId === id ? edge.sourceNodeId : null
          : edge.sourceNodeId === id ? edge.targetNodeId : null;
        if (next && !seen.has(next)) { seen.add(next); result.add(next); pending.push(next); }
      }
    }
  }
  return result;
}

export function graphTrajectory(graph: ContextGraph) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const tools = graph.nodes.filter((node) => node.kind === "tool");
  const roots = graph.nodes.filter((node) => !graph.edges.some((edge) => edge.targetNodeId === node.id)).map((node) => node.id);
  return {
    roots,
    branches: tools.map((tool) => {
      const inputs = graph.edges.filter((edge) => edge.targetNodeId === tool.id).map((edge) => ({ nodeId: edge.sourceNodeId, port: edge.targetPort }));
      const outputs = graph.edges.filter((edge) => edge.sourceNodeId === tool.id).map((edge) => edge.targetNodeId);
      const sourceText = inputs.map((input) => `${safeContextText(byId.get(input.nodeId)?.title, 100) || input.nodeId}[${input.port}]`).join("、") || "尚未连接输入";
      const outputText = outputs.map((id) => safeContextText(byId.get(id)?.title, 100) || id).join("、") || "尚无输出";
      return { toolNodeId: tool.id, tool: tool.type, status: tool.status, inputs, outputNodeIds: outputs, description: `${sourceText} → ${safeContextText(tool.title, 100)}（${tool.status}）→ ${outputText}` };
    }),
  };
}

export function projectAttempt(attempt: { id: string; toolNodeId: string; ordinal: number; status: string; requestSnapshot: unknown; error: string | null; createdAt: Date; nodeVersionId?: string | null; executionId?: string | null }) {
  const snapshot = contextObject(attempt.requestSnapshot);
  const request = contextObject(snapshot.request);
  return {
    id: attempt.id, toolNodeId: attempt.toolNodeId, ordinal: attempt.ordinal, status: attempt.status,
    nodeVersionId: attempt.nodeVersionId ?? (contextText(snapshot.nodeVersionId, 128) || null),
    executionId: attempt.executionId ?? (contextText(snapshot.executionId, 128) || null),
    graphRevision: typeof snapshot.graphRevision === "number" ? snapshot.graphRevision : null,
    inputNodeIds: stringIds(snapshot.inputNodeIds),
    frozenInputs: (Array.isArray(snapshot.inputSnapshot) ? snapshot.inputSnapshot : []).slice(0, 20).map((value) => {
      const input = contextObject(value);
      return projectNode({ id: contextText(input.id, 128), kind: "asset", type: contextText(input.type, 80), title: contextText(input.title, 200), status: "frozen", payload: input.payload }, true);
    }),
    parameters: projectParameters(Object.keys(request).length ? request : snapshot.params),
    model: contextText(snapshot.model, 120), toolVersion: contextText(snapshot.toolVersion, 40),
    error: safeContextText(attempt.error, 500) || null,
    createdAt: attempt.createdAt.toISOString(),
  };
}
