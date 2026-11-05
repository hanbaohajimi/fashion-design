import { canvasMaterialTypeSchema } from "@fashion/shared";
import type { WorkflowOperation } from "./workflow-api";
import { runCanvasCommand } from "./canvas-api";

/** Adapts existing material entry forms; only explicit material creation is accepted.
 * The entire batch keeps one identity and commits atomically across network failures.
 * It never submits client graph mutations or execution edges.
 */
export async function importCanvasMaterials(
  projectId: string,
  input: {
    mode: "semantic";
    mutationId: string;
    baseRevision: number;
    operations: readonly WorkflowOperation[];
  },
) {
  const materials = input.operations.map((operation) => {
    if (operation.type !== "add_node" || operation.node.kind !== "asset")
      throw new Error("素材导入不能修改流程关系");
    return {
      ...operation.node,
      type: canvasMaterialTypeSchema.parse(operation.node.type),
    };
  });
  if (!materials.length) return;
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${projectId}:${input.mutationId}`),
    ),
  );
  const hash = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const mutationId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  await runCanvasCommand(projectId, {
    type: "import_materials",
    mutationId,
    materials: materials.map((material) => ({
      clientMaterialId: material.id,
      shapeId: `shape:import-${material.id}`,
      materialType: material.type,
      title: material.title,
      payload: { ...material.payload },
      position: { x: material.x, y: material.y },
    })),
  });
}
