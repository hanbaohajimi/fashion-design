import { fetchWorkflow, patchWorkflow } from "../board/workflow/workflow-api";
import type { Fabric } from "./fabric-types";

/** Keep the node identity across retries; a lost response must not duplicate material. */
export async function addFabricToProject(
  projectId: string,
  fabric: Fabric,
  nodeId: string,
) {
  const graph = await fetchWorkflow(projectId);
  const existing = graph.nodes.find(
    (node) =>
      node.id === nodeId ||
      (node.type === "fabric" && node.payload.fabricId === fabric.id),
  );
  if (existing) return existing.id;
  await patchWorkflow(projectId, {
    mode: "semantic",
    mutationId: crypto.randomUUID(),
    baseRevision: graph.revision,
    operations: [
      {
        type: "add_node",
        node: {
          id: nodeId,
          kind: "asset",
          type: "fabric",
          title: (
            fabric.details?.name ||
            fabric.tags.join("、") ||
            "面料参考"
          ).slice(0, 200),
          payload: {
            fabricId: fabric.id,
            imageUrl: fabric.mainImageUrl,
            text: fabric.tags.join("、"),
          },
          x: Math.max(0, ...graph.nodes.map((node) => node.x)) + 320,
          y: 160,
        },
      },
    ],
  });
  return nodeId;
}
