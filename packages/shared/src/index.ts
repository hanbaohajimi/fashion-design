export const PLATFORM_NAME = "AI 服装设计平台";
export const DESIGN_PATH_MAX_ASSETS = 100;
export const DESIGN_DECISION_KINDS = [
  "selected",
  "rejected",
  "compare",
] as const;
export type DesignDecisionKind = (typeof DESIGN_DECISION_KINDS)[number];

export interface DesignSourceSnapshot {
  readonly elementId: string;
  readonly shapeId?: string | undefined;
  readonly role: string;
  readonly title: string;
  readonly assetId?: string | undefined;
  readonly fileAssetId?: string | undefined;
  readonly fabricId?: string | undefined;
  readonly trendItemId?: string | undefined;
  readonly text?: string | undefined;
  readonly colors?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
}

export interface DesignStepSnapshot {
  readonly version: 1;
  readonly sources: readonly DesignSourceSnapshot[];
  readonly constraints: {
    readonly palette: readonly string[];
    readonly notes: readonly string[];
    readonly avoidLabels: readonly string[];
    readonly fabricTerms: readonly string[];
  };
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
}

export interface DesignDecisionView {
  readonly id: string;
  readonly assetId: string;
  readonly kind: DesignDecisionKind;
  readonly reason: string;
  readonly createdAt: string;
}

export interface DesignPathAsset {
  readonly id: string;
  readonly url: string;
  readonly thumbnailUrl: string | null;
  readonly parentAssetId: string | null;
}

export interface DesignPathStep extends DesignStepSnapshot {
  readonly id: string;
  readonly tool: string;
  readonly actor: string;
  readonly intent: string;
  readonly createdAt: string;
  readonly status: string;
  readonly snapshotAvailable: boolean;
  readonly outputs: readonly DesignPathAsset[];
  readonly conversationId: string | null;
}

export interface DesignPathView {
  readonly assetId: string;
  readonly steps: readonly DesignPathStep[];
  readonly decisions: readonly DesignDecisionView[];
  readonly incomplete: boolean;
}
export const GENERATION_QUEUE_NAME = "generation";
export const COLLECTION_SIMILARITY_QUEUE_NAME = "collection-similarity";
export const THUMBNAIL_QUEUE_NAME = "thumbnail";
export const VLM_INFERENCE_QUEUE_NAME = "vlm-inference";
export const EXPORT_QUEUE_NAME = "export";
export const EXPORT_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const FREE_EXPORT_MAX_EDGE = 1_600;
export const STANDARD_EXPORT_MAX_EDGE = 2_048;
export const BOARD_ELEMENT_ROLES = [
  "style_ref",
  "garment_ref",
  "reference_garment",
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

export type ExportJobData =
  | {
      readonly action: "render";
      readonly exportId: string;
    }
  | {
      readonly action: "cleanup";
      readonly exportId: string;
      readonly objectKey: string;
    }
  | {
      readonly action: "sweep";
    };

export type GenerationTaskEventStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "moderation_failed"
  | "canceled";

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

export type AgentMessageRole = "user" | "assistant";
export type AgentMessageStatus = "pending" | "completed" | "failed";

export interface AgentMessageContext {
  readonly fileAssetIds: readonly string[];
  readonly shapeIds: readonly string[];
}

export interface AgentConversationSummary {
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly updatedAt: string;
}

export interface AgentMessageView {
  readonly clientRequestId: string | null;
  readonly content: string;
  readonly context: AgentMessageContext | null;
  readonly createdAt: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
  } | null;
  readonly generationTaskId: string | null;
  readonly id: string;
  readonly replyToId: string | null;
  readonly role: AgentMessageRole;
  readonly status: AgentMessageStatus;
  readonly updatedAt: string;
}

export type AgentAction =
  | { readonly type: "reply" }
  | {
      readonly type: "generate";
      readonly request: {
        readonly background?: "auto" | "opaque";
        readonly height: number;
        readonly outputCompression?: number;
        readonly outputFormat?: "jpeg" | "png" | "webp";
        readonly prompt: string;
        readonly quality?: "auto" | "high" | "low" | "medium";
        readonly shapeIds: readonly string[];
        readonly taskType: "t2i" | "i2i" | "inpaint";
        readonly width: number;
      };
    };
