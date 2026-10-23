export const PLATFORM_NAME = "AI 服装设计平台";
export * from "./visual-context";
export * from "./workflow-tools";
export { workflowInputPorts, isWorkflowInputPort, workflowInputConnectionError, type WorkflowConnectionPort } from "./workflow-connections";
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

export const AGENT_PLAN_MAX_STEPS = 6;
export const AGENT_RUN_STATUSES = [
  "planning",
  "ready",
  "running",
  "waiting_review",
  "paused",
  "completed",
  "failed",
  "canceled",
] as const;
export const AGENT_RUN_STEP_STATUSES = [
  "pending",
  "running",
  "waiting_review",
  "succeeded",
  "failed",
  "canceled",
] as const;
export const AGENT_TOOL_NAMES = ["generate_design", "edit_design"] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];
export type AgentRunStepStatus = (typeof AGENT_RUN_STEP_STATUSES)[number];
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export interface AgentPlanStepSpec {
  readonly key: string;
  readonly tool: AgentToolName;
  readonly title: string;
  readonly instruction: string;
  readonly prompt: string;
  readonly negativePrompt: string;
  readonly sourceAssetId: string | null;
  readonly sourceStepKey: string | null;
}

export interface AgentRunCandidate {
  readonly assetId: string;
  readonly url: string;
  readonly thumbnailUrl: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface AgentRunAttemptView {
  readonly id: string;
  readonly ordinal: number;
  readonly status: string;
  readonly generationTaskId: string | null;
  readonly prompt: string;
  readonly negativePrompt: string;
  readonly parentAssetId: string | null;
  readonly candidates: readonly AgentRunCandidate[];
  readonly error: string | null;
  readonly createdAt: string;
}

export interface AgentRunStepView extends AgentPlanStepSpec {
  readonly id: string;
  readonly ordinal: number;
  readonly status: AgentRunStepStatus;
  readonly generationTaskId: string | null;
  readonly selectedAssetId: string | null;
  readonly candidates: readonly AgentRunCandidate[];
  readonly error: string | null;
  readonly attempts?: readonly AgentRunAttemptView[];
  readonly canEditInputs?: boolean;
}

export const FASHION_AGENT_FRAMEWORK_VERSION = "fashion-agents/1" as const;
export const FASHION_DESIGN_DIMENSIONS = [
  "silhouette",
  "structure",
  "material",
  "color",
  "style",
  "function",
  "presentation",
] as const;
export type FashionDesignDimension = (typeof FASHION_DESIGN_DIMENSIONS)[number];

export interface AgentDesignEvidence {
  readonly id: string;
  readonly kind: "intent" | "board" | "decision";
  readonly label: string;
  readonly text: string;
  readonly assetId: string | null;
}

export interface AgentDesignConstraint {
  readonly id: string;
  readonly dimension: FashionDesignDimension;
  readonly requirement: string;
  readonly mode: "require" | "preserve" | "change" | "avoid";
  readonly priority: "must" | "prefer";
  readonly origin: "explicit" | "interpretation";
  readonly verification:
    "visual" | "requires_measurement" | "requires_specification";
  readonly evidenceIds: readonly string[];
  readonly sourceQuote: string | null;
}

export interface AgentDesignBrief {
  readonly summary: string;
  readonly garmentType: string | null;
  readonly constraints: readonly AgentDesignConstraint[];
  readonly unknowns: readonly string[];
}

export interface AgentNodeRationale {
  readonly stepKey: string;
  readonly goal: string;
  readonly constraintIds: readonly string[];
  readonly acceptanceChecks: readonly string[];
}

export interface AgentPlanAudit {
  readonly coverage: readonly {
    readonly constraintId: string;
    readonly stepKeys: readonly string[];
    readonly status: "assigned" | "unassigned";
  }[];
  readonly warnings: readonly string[];
}

export interface AgentDesignEvaluation {
  readonly stepId: string;
  readonly attemptId: string;
  readonly assetId: string;
  readonly summary: string;
  readonly checks: readonly {
    readonly constraintId: string;
    readonly status: "met" | "concern" | "unknown";
    readonly observation: string;
  }[];
  readonly nextActions: readonly string[];
}

export interface AgentDesignRefinement {
  readonly stepId: string;
  readonly attemptId: string;
  readonly originalPrompt: string;
  readonly originalNegativePrompt: string;
  readonly prompt: string;
  readonly negativePrompt: string;
  readonly summary: string;
  readonly changes: readonly string[];
  readonly preserve: readonly string[];
}

export interface AgentDomainActionView {
  readonly id: string;
  readonly kind: "evaluate_candidate" | "refine_step";
  readonly stepId: string;
  readonly assetId: string | null;
  readonly status:
    "running" | "completed" | "failed" | "superseded" | "applied";
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly error: string | null;
  readonly evaluation: AgentDesignEvaluation | null;
  readonly refinement: AgentDesignRefinement | null;
}

export interface AgentDesignIntelligence {
  readonly version: typeof FASHION_AGENT_FRAMEWORK_VERSION;
  readonly evidence: readonly AgentDesignEvidence[];
  readonly brief: AgentDesignBrief;
  readonly rationales: readonly AgentNodeRationale[];
  readonly audit: AgentPlanAudit;
  readonly actions: readonly AgentDomainActionView[];
}

export interface AgentRunView {
  readonly id: string;
  readonly projectId: string;
  readonly conversationId: string;
  readonly intent: string;
  readonly status: AgentRunStatus;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly error: string | null;
  readonly steps: readonly AgentRunStepView[];
  readonly sourceAssets?: readonly AgentRunCandidate[];
  readonly intelligence?: AgentDesignIntelligence;
}

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

export * from "./studio";

export * from "./experiments";

export * from "./fabric-details";

export * from "./sketch-document";
