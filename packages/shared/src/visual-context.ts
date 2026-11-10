export const VISUAL_SUMMARY_QUEUE_NAME = "visual-summary";
export const VISUAL_SUMMARY_SCHEMA_VERSION = "visual/2";
export const MAX_VISUAL_CONTEXT_IMAGES = 8;
export const MAX_VISUAL_CONTEXT_BINDINGS = 64;

export type VisualSummarySource =
  | { readonly kind: "file"; readonly id: string }
  | { readonly kind: "asset"; readonly id: string };

export interface VisualSummaryJobData {
  readonly source: VisualSummarySource;
  readonly model: string;
  readonly schemaVersion: string;
}

export interface ImageVisualDescription {
  readonly subject: string;
  readonly silhouette: readonly string[];
  readonly visibleStructure: readonly string[];
  readonly colors: readonly string[];
  readonly surfaceTexture: readonly string[];
  readonly uncertainties: readonly string[];
}

export interface VisualContextIndexEntry {
  readonly nodeId: string;
  readonly assetId: string | null;
  readonly fileAssetId: string | null;
  readonly status: "ready" | "pending" | "failed" | "not_ready" | "unavailable";
  readonly summary: ImageVisualDescription | null;
  readonly error: string | null;
}

export interface VisualContextCoverage {
  readonly total: number;
  readonly ready: number;
  readonly pending: number;
  readonly failed: number;
  readonly attachedNodeIds: readonly string[];
  readonly unreadNodeIds: readonly string[];
  /** Distinct images in this model request; multiple canvas objects may share one. */
  readonly attachedImageCount?: number;
  /** Union across model requests in the completed turn, not merely fetched images. */
  readonly providedNodeIds?: readonly string[];
  readonly providedImageCount?: number;
}
