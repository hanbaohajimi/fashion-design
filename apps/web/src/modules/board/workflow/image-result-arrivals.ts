import type { WorkflowGraph, WorkflowNode } from "./workflow-api";

/** Initial history is a baseline. A batch is offered once, even after dismissal. */
export class ImageResultArrivals {
  private project = "";
  private assets = new Set<string>();
  private batches = new Set<string>();
  observe(graph: WorkflowGraph): {
    fresh: WorkflowNode[];
    first: WorkflowNode | null;
  } {
    const results = graph.nodes.filter(
      (node) =>
        node.type === "candidate" &&
        node.status === "completed" &&
        typeof node.payload.assetId === "string" &&
        graph.edges.some(
          (edge) =>
            edge.targetNodeId === node.id &&
            graph.nodes.some(
              (source) =>
                source.id === edge.sourceNodeId &&
                ["generate_design", "edit_design", "transform_image"].includes(
                  source.type,
                ),
            ),
        ),
    );
    const batch = (node: WorkflowNode) =>
      String(
        node.payload.executionId ??
          node.payload.attemptId ??
          graph.edges.find((edge) => edge.targetNodeId === node.id)
            ?.sourceNodeId ??
          node.id,
      );
    if (this.project !== graph.projectId) {
      this.project = graph.projectId;
      this.assets = new Set(
        results.map((node) => String(node.payload.assetId)),
      );
      this.batches = new Set(results.map(batch));
      return { fresh: [], first: null };
    }
    const fresh = results.filter(
      (node) => !this.assets.has(String(node.payload.assetId)),
    );
    let first: WorkflowNode | null = null;
    for (const node of fresh) {
      this.assets.add(String(node.payload.assetId));
      if (!this.batches.has(batch(node))) {
        first ??= node;
        this.batches.add(batch(node));
      }
    }
    return { fresh, first };
  }
}
