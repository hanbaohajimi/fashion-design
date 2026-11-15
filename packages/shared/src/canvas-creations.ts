import { z } from "zod";
import { parseWorkflowToolParameters, workflowToolKeySchema } from "./workflow-tools";

const id = z.string().trim().min(1).max(200);
const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();

export const CANVAS_CREATION_MODULES = [
  "image", "text", "video", "experiments", "patterns", "presentation", "collections", "trends", "analysis", "evaluation",
] as const;
export const canvasCreationModuleSchema = z.enum(CANVAS_CREATION_MODULES);
export type CanvasCreationModule = z.infer<typeof canvasCreationModuleSchema>;

/** An input identifies real content. Its use belongs to this request's text. */
export const creationInputBindingSchema = z.object({
  id,
  nodeId: id.optional(),
  creationId: id.optional(),
  nodeVersionId: id.optional(),
  assetId: id.optional(),
}).strict().refine((input) => Boolean(input.nodeId || input.creationId), "请选择实际素材或创作节点");
export type CreationInputBinding = z.infer<typeof creationInputBindingSchema>;

export const canvasCreationDraftSchema = z.object({
  prompt: z.string().max(4_000).default(""),
  textMode: z.enum(["manual", "ai"]).optional(),
  textContent: z.string().max(12000).optional(),
  textBaseNodeId: id.optional(),
  inputs: z.array(creationInputBindingSchema).max(16).default([]),
  basedOnInputId: id.nullable().default(null),
  operation: z.object({ toolKey: workflowToolKeySchema, parameters: z.record(z.string(), z.unknown()) }).strict().optional(),
  parameters: z.object({
    width: z.number().int().positive().max(16384).default(768),
    height: z.number().int().positive().max(16384).default(1024),
    quality: z.enum(["auto", "low", "medium", "high"]).default("high"),
    count: z.number().int().min(1).max(4).default(1),
    negativePrompt: z.string().max(3000).default(""),
  }).strict().default({ width: 768, height: 1024, quality: "high", count: 1, negativePrompt: "" }),
}).strict().superRefine((draft, context) => {
  if (draft.operation) {
    try { parseWorkflowToolParameters(draft.operation.toolKey, draft.operation.parameters); }
    catch { context.addIssue({ code: "custom", path: ["operation"], message: "图片工具参数不合法，请重新打开对应工具" }); }
  }
  if (draft.operation?.toolKey !== "transform_image" && [draft.parameters.width, draft.parameters.height].some((value) => value < 256 || value > 2048 || value % 8 !== 0)) context.addIssue({ code: "custom", path: ["parameters"], message: "生成尺寸须为256至2048之间的8倍数" });
  if (new Set(draft.inputs.map((input) => input.id)).size !== draft.inputs.length) {
    context.addIssue({ code: "custom", path: ["inputs"], message: "引用编号不能重复" });
  }
  if (draft.basedOnInputId && !draft.inputs.some((input) => input.id === draft.basedOnInputId)) {
    context.addIssue({ code: "custom", path: ["basedOnInputId"], message: "继续创作的图片必须在本次引用中" });
  }
});
export type CanvasCreationDraft = z.infer<typeof canvasCreationDraftSchema>;

export const createCanvasCreationSchema = z.object({
  mutationId: z.uuid(),
  id: z.uuid(),
  module: canvasCreationModuleSchema.default("image"),
  title: z.string().trim().min(1).max(160).default("新图片"),
  draft: canvasCreationDraftSchema.default({ prompt: "", inputs: [], basedOnInputId: null, parameters: { width: 1536, height: 864, quality: "high", count: 1, negativePrompt: "" } }),
  position: point.optional(),
}).strict();
export type CreateCanvasCreationInput = z.infer<typeof createCanvasCreationSchema>;

export const updateCanvasCreationSchema = z.object({
  mutationId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(160).optional(),
  draft: canvasCreationDraftSchema.optional(),
  currentResultNodeId: id.nullable().optional(),
  removed: z.boolean().optional(),
  publishText: z.boolean().optional(),
  mediaNodeId: id.optional(),
  resource: z.object({ kind: z.enum(["experiment", "pattern", "presentation", "collection", "trend"]), id }).strict().nullable().optional(),
  conversationId: id.optional(),
}).strict();
export type UpdateCanvasCreationInput = z.infer<typeof updateCanvasCreationSchema>;

export const runCanvasCreationSchema = z.object({
  mutationId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  conversationId: id.optional(),
}).strict();
export type RunCanvasCreationInput = z.infer<typeof runCanvasCreationSchema>;

export interface CreationResultView {
  readonly sourceNodeId?: string;
  readonly media?: { readonly url: string; readonly mimeType: string; readonly durationMs: number | null };
  readonly nodeId: string;
  readonly assetId: string | null;
  readonly title: string;
  readonly imageUrl: string | null;
  readonly text: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface CreationRunView {
  readonly id: string;
  readonly creationId: string;
  readonly executionId: string | null;
  readonly toolNodeId: string | null;
  readonly conversationId: string | null;
  readonly status: "draft" | "preparing" | "queued" | "running" | "completed" | "partial_failed" | "failed" | "canceled";
  readonly draft: CanvasCreationDraft;
  readonly inputSnapshot: readonly CreationInputBinding[];
  readonly results: readonly CreationResultView[];
  readonly error: string | null;
  readonly createdAt: string;
  readonly moduleRecord?: {
    readonly kind: string;
    readonly recordId: string;
    readonly title: string;
    readonly revision: number;
    readonly requirements: readonly string[];
    readonly values: readonly { readonly label: string; readonly value: string }[];
  };
}

export interface CanvasCreation {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly module: CanvasCreationModule;
  readonly revision: number;
  readonly draft: CanvasCreationDraft;
  readonly position: { readonly x: number; readonly y: number } | null;
  readonly currentResultNodeId: string | null;
  readonly currentResult: CreationResultView | null;
  readonly runs: readonly CreationRunView[];
  readonly resource: { readonly kind: "experiment" | "pattern" | "presentation" | "collection" | "trend"; readonly id: string } | null;
  readonly removed: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function emptyCanvasCreationDraft(): CanvasCreationDraft {
  return canvasCreationDraftSchema.parse({});
}

export const creationActivitySchema = z.object({
  creationId: id,
  runId: id.nullable(),
  event: z.enum(["submitted", "completed", "adopted", "module_saved"]),
  task: z.boolean().optional(),
  title: z.string().max(160),
  prompt: z.string().max(4000),
  inputNodeIds: z.array(id).max(16),
  resultNodeId: id.nullable(),
  status: z.enum(["draft", "preparing", "queued", "running", "completed", "partial_failed", "failed", "canceled", "unconfirmed"]).optional(),
  resultNodeIds: z.array(id).optional(),
  updatedAt: z.iso.datetime().optional(),
}).strict();
export type CreationActivity = z.infer<typeof creationActivitySchema>;

/** Editor-local text drafts never belong in the shared layout document. */
export function stripCanvasTransientDrafts(snapshot: Record<string, unknown>): Record<string, unknown> {
  const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const clean = (value: unknown) => {
    const row = object(value); if (row.type !== "fashion-creation" || !Object.hasOwn(object(row.props), "draftText")) return value;
    const props = { ...object(row.props) }; delete props.draftText; return { ...row, props };
  };
  const store = (value: unknown) => Object.fromEntries(Object.entries(object(value)).map(([id, row]) => [id, clean(row)]));
  return { ...snapshot, ...(snapshot.document ? { document: { ...object(snapshot.document), store: store(object(snapshot.document).store) } } : {}), ...(snapshot.store ? { store: store(snapshot.store) } : {}), ...(Array.isArray(snapshot.legacyRecords) ? { legacyRecords: snapshot.legacyRecords.map(clean) } : {}) };
}
