/** Manual review entry only. Never imported by an application route or production component. */
import { createCubismResourceRenderer, type RuntimeDependencies } from "../../../apps/web/src/modules/forest-spirit/cubism-resource-renderer";
import { parseSpiritRenderAsset, type SpiritRenderAsset, type SpiritRenderer } from "../../../apps/web/src/modules/forest-spirit/spirit-contract";

export interface ReviewSpiritCandidate extends SpiritRenderAsset {
  schemaVersion: 1;
  status: "diagnostic-candidate";
  characterId: "forest-spirit-front-v8";
  productionApproval: false;
  visualReview: { approved: false };
  hitArea: SpiritRenderAsset["hitArea"] & { approved: false };
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const reviewUrl = (url: unknown): url is string => typeof url === "string" && url.startsWith("/__forest_wip/");

export function parseReviewSpiritCandidate(value: unknown): ReviewSpiritCandidate | null {
  if (!record(value) || value.schemaVersion !== 1 || value.status !== "diagnostic-candidate" || value.characterId !== "forest-spirit-front-v8" || value.productionApproval !== false) return null;
  if (!record(value.visualReview) || value.visualReview.approved !== false || !record(value.hitArea) || value.hitArea.approved !== false) return null;
  const asset = parseSpiritRenderAsset(value);
  if (!asset || ![asset.model3Url, asset.coreUrl, asset.runtimeModuleUrl, ...Object.values(asset.motions)].every(reviewUrl)) return null;
  return value as unknown as ReviewSpiritCandidate;
}

/** Uses the exact production resource lifecycle with a separate, explicitly unapproved policy. */
export function createReviewSpiritRenderer(canvas: HTMLCanvasElement, loader?: RuntimeDependencies): SpiritRenderer {
  const renderer = createCubismResourceRenderer(canvas, loader);
  return {
    ...renderer,
    async load(asset, signal) {
      if (!parseReviewSpiritCandidate(asset)) throw new Error("Explicit unapproved forest spirit review candidate is required");
      return renderer.load(asset, signal);
    },
  };
}

/** Pass these props to ForestSpiritResourceHost alongside the existing chat callback and state. */
export function reviewSpiritHostResources(manifestUrl: string) {
  if (!reviewUrl(manifestUrl) || /[?#\\]|(?:^|\/)\.{1,2}(?:\/|$)/u.test(manifestUrl)) throw new Error("An isolated local review manifest URL is required");
  return { manifestUrl, parseAsset: parseReviewSpiritCandidate, rendererFactory: createReviewSpiritRenderer };
}
