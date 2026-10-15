export type WorkflowConnectionPort =
  "goal" | "reference" | "constraint" | "candidate" | "source";

const referenceTypes = new Set([
  "reference_text",
  "reference_image",
  "swatch",
  "sketch",
  "trend",
  "fabric",
  "legacy",
  "candidate",
]);

/** The same input contract is used by the canvas and API. Order expresses preference. */
export function workflowInputPorts(
  assetType: string,
  toolType: string,
): readonly WorkflowConnectionPort[] {
  if (toolType === "analyze_brief") {
    if (assetType === "brief") return ["goal"];
    if (assetType === "reference_text") return ["goal", "reference"];
    return referenceTypes.has(assetType) ? ["reference"] : [];
  }
  if (
    ![
      "generate_design",
      "edit_design",
      "evaluate_design",
      "restore_version",
    ].includes(toolType)
  )
    return [];
  if (assetType === "constraint") return ["constraint"];
  if (assetType === "candidate")
    return toolType === "evaluate_design"
      ? ["candidate", "reference"]
      : ["source", "reference"];
  return referenceTypes.has(assetType) ? ["reference"] : [];
}

export function isWorkflowInputPort(
  assetType: string,
  toolType: string,
  port: string,
): boolean {
  return workflowInputPorts(assetType, toolType).some(
    (value) => value === port,
  );
}

interface InputEdge {
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly targetPort: string;
}

/** Validate the final graph, excluding the edge being replaced. */
export function workflowInputConnectionError(
  assetType: string,
  toolType: string,
  proposed: InputEdge,
  edges: readonly InputEdge[],
): string | null {
  if (!isWorkflowInputPort(assetType, toolType, proposed.targetPort))
    return "这类素材不能作为该工具的输入";
  const inputs = edges.filter(
    (edge) => edge.targetNodeId === proposed.targetNodeId,
  );
  if (
    inputs.some(
      (edge) =>
        edge.sourceNodeId === proposed.sourceNodeId &&
        edge.targetPort === proposed.targetPort,
    )
  )
    return "这条连接已存在";
  if (
    proposed.targetPort === "source" &&
    inputs.some((edge) => edge.targetPort === "source")
  )
    return "原图只能连接一个，请选择已有连线后更换原图";
  const stack = [proposed.targetNodeId];
  const visited = new Set<string>();
  while (stack.length) {
    const id = stack.pop();
    if (!id) continue;
    if (id === proposed.sourceNodeId)
      return "这条连接会形成循环，请从新分支继续";
    if (visited.has(id)) continue;
    visited.add(id);
    stack.push(
      ...edges
        .filter((edge) => edge.sourceNodeId === id)
        .map((edge) => edge.targetNodeId),
    );
  }
  return null;
}
