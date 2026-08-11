export type GenerationStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "moderation_failed"
  | "canceled";

export interface GenerationCandidate {
  readonly assetId: string;
  readonly disposition?: "adopted" | "dismissed";
  readonly id: string;
  readonly height?: number;
  readonly taskId: string;
  readonly taskType: "t2i" | "i2i" | "inpaint";
  readonly url: string;
  readonly seed?: number;
  readonly sourceUrl?: string;
  readonly width?: number;
}

export interface GenerationTaskDetail {
  readonly createdAt: string;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly id: string;
  readonly output: unknown;
  readonly request: PersistedGenerationRequest | null;
  readonly status: GenerationStatus;
  readonly taskType: "t2i" | "i2i" | "inpaint";
  readonly updatedAt: string;
}

export interface GenerationTaskList {
  readonly items: readonly GenerationTaskDetail[];
  readonly nextCursor: string | null;
}

export interface PersistedGenerationRequest {
  readonly background?: "auto" | "opaque";
  readonly cfg: number;
  readonly height: number;
  readonly maskImageUrl?: string;
  readonly negativePrompt?: string;
  readonly outputCompression?: number;
  readonly outputFormat?: "jpeg" | "png" | "webp";
  readonly parentAssetId?: string;
  readonly projectId?: string;
  readonly prompt: string;
  readonly quality?: "auto" | "high" | "low" | "medium";
  readonly referenceImageUrl?: string;
  readonly seed?: number;
  readonly shapeIds?: readonly string[];
  readonly steps: number;
  readonly strength?: number;
  readonly taskType: "t2i" | "i2i" | "inpaint";
  readonly width: number;
}

export interface GenerationTaskItem {
  readonly candidates: readonly GenerationCandidate[];
  readonly connection: "sse" | "polling";
  readonly createdAt: string;
  readonly error: string | null;
  readonly id: string;
  readonly prompt: string;
  readonly request: GenerationStartRequest;
  readonly status: GenerationStatus;
  readonly referenceImageUrl?: string;
  readonly seed?: number;
  readonly taskType: "t2i" | "i2i" | "inpaint";
  readonly updatedAt: string;
}

export interface GenerationParameters {
  readonly background?: "auto" | "opaque";
  readonly cfg: number;
  readonly height: number;
  readonly outputCompression?: number;
  readonly outputFormat?: "jpeg" | "png" | "webp";
  readonly quality?: "auto" | "high" | "low" | "medium";
  readonly seed?: number;
  readonly steps: number;
  readonly width: number;
}

export const DEFAULT_GENERATION_PARAMETERS: GenerationParameters = {
  background: "opaque",
  cfg: 3.5,
  height: 1024,
  outputCompression: 90,
  outputFormat: "png",
  quality: "high",
  steps: 28,
  width: 1024,
};

export interface GenerationStartRequest {
  readonly parameters: GenerationParameters;
  readonly projectId: string;
  readonly prompt: string;
  readonly maskImageUrl?: string;
  readonly parentAssetId?: string;
  readonly referenceImageUrl?: string;
  readonly shapeIds: readonly string[];
  readonly strength?: number;
  readonly taskType?: "t2i" | "i2i" | "inpaint";
}

export type DesignAssetOperation =
  "generated" | "imported" | "variation" | "inpaint" | "upscale" | "restore";

export interface DesignAssetVersion {
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly height: number | null;
  readonly id: string;
  readonly operation: DesignAssetOperation;
  readonly parentAssetId: string | null;
  readonly projectId: string;
  readonly restoredFromAssetId: string | null;
  readonly seed: number | null;
  readonly thumbnailUrl: string | null;
  readonly url: string;
  readonly width: number | null;
}
