import type { WorkflowResultImage } from "@fashion/shared";
import type { WorkflowGraph } from "./workflow-api";

/** A historical result must never open or reference a replacement now occupying its old node. */
export function resultImageNode(
  graph: WorkflowGraph,
  image: WorkflowResultImage,
) {
  const matches = graph.nodes.filter(
    (node) =>
      node.kind === "asset" &&
      node.type === "candidate" &&
      node.payload.assetId === image.assetId,
  );
  return matches.find((node) => node.id === image.nodeId) ?? matches[0] ?? null;
}
