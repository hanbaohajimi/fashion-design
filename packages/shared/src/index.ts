export const PLATFORM_NAME = "AI 服装设计平台";
export const GENERATION_QUEUE_NAME = "generation";
export const COLLECTION_SIMILARITY_QUEUE_NAME = "collection-similarity";
export const THUMBNAIL_QUEUE_NAME = "thumbnail";
export const VLM_INFERENCE_QUEUE_NAME = "vlm-inference";
export const BOARD_ELEMENT_ROLES = [
  "style_ref",
  "fabric_ref",
  "palette",
  "silhouette_ref",
  "detail_ref",
  "avoid",
  "note",
] as const;
export const VLM_ROLE_LABELS = [
  "garment_photo",
  "fabric_texture",
  "fashion_sketch",
  "silhouette",
  "garment_detail",
  "color_palette",
  "non_fashion",
  "other_fashion",
] as const;

export type BoardElementRole = (typeof BOARD_ELEMENT_ROLES)[number];
export type VlmRoleLabel = (typeof VLM_ROLE_LABELS)[number];

export interface ThumbnailJobData {
  readonly fileId: string;
}

export interface GenerationJobData {
  readonly taskId: string;
  readonly userId: string;
}

export interface CollectionSimilarityJobData {
  readonly collectionId: string;
  readonly designAssetId: string;
}

export type GenerationTaskEventStatus =
  "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface GenerationTaskEvent {
  readonly taskId: string;
  readonly status: GenerationTaskEventStatus;
  readonly timestamp: string;
}

export interface VlmInferenceJobData {
  readonly fileId: string;
  readonly projectId: string;
  readonly shapeId: string;
}

export interface HealthResponse {
  readonly ok: true;
  readonly ts: string;
}
