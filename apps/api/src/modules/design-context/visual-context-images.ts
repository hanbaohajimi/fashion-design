import {
  MAX_VISUAL_CONTEXT_BINDINGS,
  MAX_VISUAL_CONTEXT_IMAGES,
  type VisualContextCoverage,
  type VisualContextIndexEntry,
} from "@fashion/shared";
import type { VisualContextResult } from "./visual-context.service";

type Binding = VisualContextResult["imageBindings"][number];

/** Only identities already resolved through project/file access may reach this helper. */
export function visualImageIdentity(binding: Binding): string {
  return binding.fileAssetId ? `file:${binding.fileAssetId}`
    : binding.assetId ? `asset:${binding.assetId}` : `node:${binding.nodeId}`;
}

export function visualContextCoverage(
  index: readonly VisualContextIndexEntry[],
  bindings: readonly Binding[],
  imageCount: number,
): VisualContextCoverage {
  const attached = new Set(bindings.map(binding => binding.nodeId));
  return {
    total: index.length,
    ready: index.filter(entry => entry.status === "ready").length,
    pending: index.filter(entry => entry.status === "pending" || entry.status === "not_ready").length,
    failed: index.filter(entry => entry.status === "failed" || entry.status === "unavailable").length,
    attachedNodeIds: [...attached],
    unreadNodeIds: index.filter(entry => !attached.has(entry.nodeId)).map(entry => entry.nodeId),
    attachedImageCount: imageCount,
  };
}

/** Keep the most recently requested images, without spending slots on their aliases. */
export function mergeVisualContext(priority: VisualContextResult, previous: VisualContextResult): VisualContextResult {
  const images: VisualContextResult["images"][number][] = [];
  const imageBindings: Binding[] = [];
  const imagePositions = new Map<string, number>();
  const boundNodes = new Set<string>();
  const refreshedNodes = new Set(priority.index.map(entry => entry.nodeId));
  for (const source of [priority, previous]) {
    for (const binding of source.imageBindings) {
      if (imageBindings.length >= MAX_VISUAL_CONTEXT_BINDINGS) break;
      if (boundNodes.has(binding.nodeId) || source === previous && refreshedNodes.has(binding.nodeId)) continue;
      const image = source.images[binding.imageIndex];
      if (!image) continue;
      const identity = visualImageIdentity(binding);
      let imageIndex = imagePositions.get(identity);
      if (imageIndex === undefined) {
        if (images.length >= MAX_VISUAL_CONTEXT_IMAGES) continue;
        imageIndex = images.length;
        imagePositions.set(identity, imageIndex);
        images.push(image);
      }
      imageBindings.push({ ...binding, imageIndex });
      boundNodes.add(binding.nodeId);
    }
  }
  const index = [...new Map([...previous.index, ...priority.index].map(entry => [entry.nodeId, entry])).values()];
  return { index, images, imageBindings, coverage: visualContextCoverage(index, imageBindings, images.length) };
}
