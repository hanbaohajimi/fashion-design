import type {
  CanvasCreation,
  CreationInputBinding,
  CreationResultView,
} from "@fashion/shared";
import type { WorkflowGraph } from "./workflow-api";
import { nodeImageUrl } from "./workflow-graph";

export function creationReferenceToken(index: number, inputs: readonly CreationInputBinding[], graph: WorkflowGraph, creations: readonly CanvasCreation[]) {
  const image = (input: CreationInputBinding) => Boolean(input.assetId || nodeImageUrl(graph.nodes.find(node => node.id === input.nodeId) ?? { payload: {} }) || creations.find(item => item.id === input.creationId)?.module === "image");
  const input = inputs[index];
  return input && image(input) ? `图${inputs.slice(0, index + 1).filter(image).length}` : `素材${index + 1}`;
}

/** Frozen references retain their asset; upstream bindings display the current real result. */
export function creationReferenceView(
  binding: CreationInputBinding,
  graph: WorkflowGraph,
  creations: readonly CanvasCreation[],
): CreationResultView {
  const node = graph.nodes.find((item) => item.id === binding.nodeId);
  const creation = creations.find((item) => item.id === binding.creationId);
  const result = binding.nodeId && creation ? creation.runs.flatMap(run => run.results).find(result => result.nodeId === binding.nodeId) : binding.assetId
    ? creation?.runs
        .flatMap((run) => run.results)
        .find((item) => item.assetId === binding.assetId)
    : creation?.currentResult;
  if (result) return result;
  const assetId =
    binding.assetId ??
    (typeof node?.payload.assetId === "string" ? node.payload.assetId : null);
  return {
    nodeId:
      binding.assetId && node?.payload.assetId !== binding.assetId
        ? ""
        : (node?.id ?? binding.creationId ?? ""),
    assetId,
    title: node?.title ?? creation?.title ?? "引用素材",
    imageUrl:
      binding.assetId && node?.payload.assetId !== binding.assetId
        ? `/api/design-assets/${encodeURIComponent(binding.assetId)}/content`
        : node
          ? nodeImageUrl(node)
          : assetId
            ? `/api/design-assets/${encodeURIComponent(assetId)}/content`
            : null,
    text:
      typeof node?.payload.text === "string"
        ? node.payload.text
        : creation && !creation.currentResult
          ? "这项创作尚无可用结果。"
          : null,
    width: typeof node?.payload.width === "number" ? node.payload.width : null,
    height:
      typeof node?.payload.height === "number" ? node.payload.height : null,
  };
}
