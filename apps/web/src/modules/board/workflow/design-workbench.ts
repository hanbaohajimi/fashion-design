import type { WorkflowGraph, WorkflowNode } from "./workflow-api";

export interface DesignGroup {
  readonly id: string;
  readonly producer?: WorkflowNode;
  readonly candidates: WorkflowNode[];
  readonly sources: WorkflowNode[];
  readonly notes: WorkflowNode[];
}

const isNote = (node: WorkflowNode) => node.type === "constraint" || node.type === "evaluation";

/** §2.1/§2.4: group by the work produced, not the number of processing steps.
 * This is a read model: never rewrite saved nodes, links, positions or attempts. */
export function buildDesignWorkbench(graph: WorkflowGraph) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    incoming.set(edge.targetNodeId, [...incoming.get(edge.targetNodeId) ?? [], edge.sourceNodeId]);
    outgoing.set(edge.sourceNodeId, [...outgoing.get(edge.sourceNodeId) ?? [], edge.targetNodeId]);
  }
  const groups = new Map<string, DesignGroup>();
  for (const candidate of graph.nodes.filter((node) => node.type === "candidate")) {
    const producer = (incoming.get(candidate.id) ?? []).map((id) => byId.get(id)).find((node) => node?.kind === "tool");
    const id = producer?.id ?? "existing-designs";
    const group = groups.get(id) ?? { id, ...(producer ? { producer } : {}), candidates: [], sources: [], notes: [] };
    group.candidates.push(candidate);
    groups.set(id, group);
  }
  const attachedNotes = new Set<string>();
  for (const group of groups.values()) {
    const seen = new Set(group.candidates.map((node) => node.id));
    const sources = new Set<string>();
    const notes = new Set<string>();
    const queue = group.candidates.flatMap((node) => incoming.get(node.id) ?? []);
    while (queue.length) {
      const id = queue.pop();
      if (id === undefined) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      const node = byId.get(id);
      if (!node) continue;
      if (isNote(node)) notes.add(id);
      else if (node.kind === "asset" && node.type !== "brief") sources.add(id);
      // A previous design is a source, not permission to mix its other branches' notes.
      if (node.type !== "candidate") queue.push(...incoming.get(id) ?? []);
    }
    for (const candidate of group.candidates) {
      for (const id of outgoing.get(candidate.id) ?? []) {
        const node = byId.get(id);
        if (node?.type === "evaluation") notes.add(id);
        if (node?.type === "evaluate_design") {
          for (const output of outgoing.get(id) ?? []) if (byId.get(output)?.type === "evaluation") notes.add(output);
        }
      }
    }
    group.sources.push(...[...sources].flatMap((id) => byId.get(id) ?? []));
    group.notes.push(...[...notes].flatMap((id) => byId.get(id) ?? []));
    for (const id of notes) attachedNotes.add(id);
  }
  return {
    groups: [...groups.values()],
    briefs: graph.nodes.filter((node) => node.type === "brief"),
    materials: graph.nodes.filter((node) => node.kind === "asset" && !["candidate", "brief", "constraint", "evaluation"].includes(node.type)),
    notes: graph.nodes.filter((node) => isNote(node) && !attachedNotes.has(node.id)),
    activities: graph.nodes.filter((node) => node.kind === "tool" && (node.status !== "completed" || !(outgoing.get(node.id)?.length))),
  };
}

/** Only show recorded statements; the full, attributed report remains available. */
export function designNoteText(node: WorkflowNode, candidates: readonly WorkflowNode[] = []): string[] {
  const brief = node.payload.brief as { constraints?: Array<{ requirement?: unknown }> } | undefined;
  if (node.type === "constraint" && Array.isArray(brief?.constraints)) {
    return brief.constraints.flatMap((item) => typeof item.requirement === "string" ? [item.requirement] : []);
  }
  const report = node.payload.report as { evaluations?: Array<{ assetId?: string; summary?: unknown }> } | undefined;
  if (node.type === "evaluation" && Array.isArray(report?.evaluations)) {
    return report.evaluations.filter((item) => !candidates.length || candidates.some((candidate) => candidate.payload.assetId === item.assetId))
      .flatMap((item) => typeof item.summary === "string" ? [item.summary] : []);
  }
  return [node.payload.text, node.payload.summary, node.payload.report].filter((text): text is string => typeof text === "string" && Boolean(text.trim()));
}
