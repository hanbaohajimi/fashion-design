import { createCubismResourceRenderer, type RuntimeDependencies } from "./cubism-resource-renderer";
import { parseReadySpiritAsset, type SpiritRenderer } from "./spirit-contract";

/** Production approval is unconditional; dependency injection only supports lifecycle tests. */
export function createOfficialSpiritRenderer(canvas: HTMLCanvasElement, loader?: RuntimeDependencies): SpiritRenderer {
  const renderer = createCubismResourceRenderer(canvas, loader);
  return {
    ...renderer,
    async load(asset, signal) {
      if (!parseReadySpiritAsset(asset)) throw new Error("Approved forest spirit asset package is required");
      return renderer.load(asset, signal);
    },
  };
}
