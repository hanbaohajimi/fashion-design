import { z } from "zod";

const id = z.string().min(1).max(128);
const name = z.string().trim().min(1).max(120);
const requestKey = z.string().min(8).max(200);
export const WARDROBE_CATEGORIES = [
  "top",
  "outerwear",
  "bottom",
  "onepiece",
  "shoes",
  "bag",
  "hat",
  "scarf",
  "belt",
  "accessory",
] as const;
export const wardrobeCategorySchema = z.enum(WARDROBE_CATEGORIES);
export type WardrobeCategory = z.infer<typeof wardrobeCategorySchema>;
export const wardrobeDisplaySchema = z.enum([
  "hanger",
  "clips",
  "hook",
  "shelf",
]);
export type WardrobeDisplay = z.infer<typeof wardrobeDisplaySchema>;
export const wardrobeAnchorSchema = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
  .strict();
export const wardrobeSourceKindSchema = z.enum([
  "isolated",
  "worn",
  "sketch",
  "outfit",
]);
export type WardrobeSourceKind = z.infer<typeof wardrobeSourceKindSchema>;
export const wardrobeRegionSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .refine(
    (region) =>
      region.x + region.width <= 1.000001 &&
      region.y + region.height <= 1.000001,
    "框选范围必须位于图片内",
  );
export const wardrobePrepareSchema = z
  .object({
    requestKey,
    sourceAssetId: id,
    styleRevisionId: id.optional(),
    name,
    category: wardrobeCategorySchema,
    sourceKind: wardrobeSourceKindSchema,
    mode: z.enum(["existing", "extract", "complete"]),
    referenceAssetIds: z.array(id).max(8).default([]),
    notes: z.string().trim().max(1500).default(""),
    region: wardrobeRegionSchema.optional(),
    presentation: z
      .object({
        view: z.literal("side"),
        revisionId: id,
        orientation: z.enum(["left", "right"]),
        repairPreparationId: id.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const wardrobeConfirmSchema = z
  .object({
    requestKey,
    preparationId: id,
    assetId: id,
    name,
    category: wardrobeCategorySchema,
    display: wardrobeDisplaySchema,
    anchor: wardrobeAnchorSchema.default({ x: 0.5, y: 0.08 }),
    reviewed: z.literal(true),
    itemId: id.optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();
export const wardrobeMaterialOperationSchema = z.enum([
  "transparency",
  "correction",
]);
export type WardrobeMaterialOperation = z.infer<
  typeof wardrobeMaterialOperationSchema
>;
export const wardrobeMaterialMaskSchema = z
  .object({
    requestKey,
    operation: wardrobeMaterialOperationSchema.optional(),
    sourceAssetId: id,
    maskId: z.uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type WardrobeMaterialMaskInput = z.input<
  typeof wardrobeMaterialMaskSchema
>;
export const wardrobeMaterialProbeSchema = z
  .object({
    requestKey,
    operation: wardrobeMaterialOperationSchema.optional(),
    sourceAssetId: id,
    maskAssetId: id,
    detailRegion: wardrobeRegionSchema.optional(),
    name,
    category: wardrobeCategorySchema,
    notes: z.string().trim().max(1000).default(""),
  })
  .strict()
  .refine(
    (input) => input.operation !== "correction" || input.notes.length > 0,
    { path: ["notes"], message: "局部细节修正必须填写明确说明" },
  );
export const wardrobeMaterialAlphaSchema = z
  .object({
    requestKey,
    operation: wardrobeMaterialOperationSchema.optional(),
    sourceAssetId: id,
    rawAssetId: id,
    maskAssetId: id,
    sidePreparationId: id.optional(),
    name,
    category: wardrobeCategorySchema,
  })
  .strict();
export type WardrobeMaterialProbeInput = z.input<
  typeof wardrobeMaterialProbeSchema
>;
export type WardrobeMaterialAlphaInput = z.input<
  typeof wardrobeMaterialAlphaSchema
>;
interface WardrobeProcessingSources {
  sourceAssetId: string;
  rawAssetId: string;
  maskAssetId: string;
  sourceSha256: string;
  rawSha256: string;
  maskSha256: string;
  derivedSha256: string;
}
export type WardrobeMaterialProcessing = WardrobeProcessingSources &
  (
    | { kind: "material-alpha"; algorithm: "green-dominance-original-rgb-v1" }
    | {
        kind: "masked-edit";
        algorithm: "masked-provider-rgb-preserve-alpha-v1";
      }
    | {
        kind: "masked-edit";
        algorithm: "masked-provider-rgb-interior-v2";
        alphaThreshold: 240;
        interiorRadius: 2;
      }
  );
export const wardrobeArchiveSchema = z
  .object({
    requestKey,
    expectedVersion: z.number().int().positive(),
    archived: z.boolean(),
  })
  .strict();
/** Display-only revisions never replace the confirmed front used for try-on. */
export const wardrobePresentationSchema = z
  .object({
    requestKey,
    expectedVersion: z.number().int().positive(),
    revisionId: id,
    frontAnchor: wardrobeAnchorSchema.optional(),
    supportWidthRatio: z.number().min(0.15).max(1.2).optional(),
    shelfDepthRatio: z.number().min(0.08).max(0.5).optional(),
    sideDisplay: z
      .object({
        preparationId: id,
        assetId: id,
        anchor: wardrobeAnchorSchema,
        reviewed: z.literal(true),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
export type WardrobePresentationInput = z.input<
  typeof wardrobePresentationSchema
>;
export const outfitSelectionSchema = z
  .object({
    revisionId: id,
    layer: z.number().int().min(0).max(20),
    wearNote: z.string().trim().max(300).default(""),
  })
  .strict();
export const outfitSaveSchema = z
  .object({
    requestKey,
    outfitId: id.optional(),
    expectedVersion: z.number().int().positive().optional(),
    name,
    layeringConfirmed: z.boolean().default(false),
    items: z.array(outfitSelectionSchema).min(1).max(12),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.items.map((item) => item.revisionId)).size !==
      value.items.length
    )
      context.addIssue({
        code: "custom",
        message: "同一单品修订不能重复加入搭配",
      });
    if (value.outfitId && !value.expectedVersion)
      context.addIssue({ code: "custom", message: "更新搭配需要版本号" });
  });
export const outfitReferenceSchema = z.object({ requestKey }).strict();
export const outfitTrialSchema = z
  .object({
    requestKey,
    name,
    baseSnapshotId: id.optional(),
    layeringConfirmed: z.boolean().default(false),
    items: z.array(outfitSelectionSchema).min(1).max(12),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.items.map((item) => item.revisionId)).size ===
      value.items.length,
    "同一单品修订不能重复加入搭配",
  );
export type OutfitTrialInput = z.input<typeof outfitTrialSchema>;
export const outfitTryOnSchema = z
  .object({ requestKey, snapshotId: id, modelAssetId: id })
  .strict();
export type WardrobePrepareInput = z.input<typeof wardrobePrepareSchema>;
export type WardrobeConfirmInput = z.input<typeof wardrobeConfirmSchema>;
export type OutfitSaveInput = z.input<typeof outfitSaveSchema>;
/** Original image pixels and the bounding box of pixels whose alpha exceeds 16. */
export interface WardrobeImageBounds {
  width: number;
  height: number;
  x: number;
  y: number;
  contentWidth: number;
  contentHeight: number;
}
export interface WardrobeRevisionView {
  id: string;
  itemId: string;
  version: number;
  sourceAssetId: string;
  assetId: string;
  styleRevisionId?: string;
  name: string;
  category: WardrobeCategory;
  display: WardrobeDisplay;
  anchor: { x: number; y: number };
  imageBounds?: WardrobeImageBounds;
  presentation?: WardrobePresentation;
  reviewed: boolean;
  sourceKind: WardrobeSourceKind;
  generatedCompletion: boolean;
  materialProcessing?: WardrobeMaterialProcessing;
  url: string;
  createdAt: string;
}
export interface WardrobePresentation {
  /** Width of physical support relative to the visible front garment, not PNG padding. */
  supportWidthRatio?: number;
  /** Backward depth of the shelf surface relative to the full hardware width. */
  shelfDepthRatio?: number;
  sideDisplay?: {
    assetId: string;
    url: string;
    imageBounds: WardrobeImageBounds;
    anchor: { x: number; y: number };
    orientation: "left" | "right";
    source: "generated" | "uploaded";
    preparationId: string;
    reviewed: true;
    materialProcessing?: WardrobeMaterialProcessing;
  };
}
export interface WardrobeItemView {
  id: string;
  projectId: string;
  name: string;
  archived: boolean;
  version: number;
  currentRevision: WardrobeRevisionView;
  revisions: WardrobeRevisionView[];
}
export interface WardrobePreparationView {
  id: string;
  projectId: string;
  sourceAssetId: string;
  name: string;
  category: WardrobeCategory;
  sourceKind: WardrobeSourceKind;
  mode: "existing" | "extract" | "complete";
  materialProcessing?: WardrobeMaterialProcessing;
  presentation?: {
    view: "side";
    revisionId: string;
    orientation: "left" | "right";
    repairPreparationId?: string;
  };
  status: "queued" | "running" | "ready" | "failed" | "canceled";
  taskId: string | null;
  error: string | null;
  candidates: {
    assetId: string;
    url: string;
    imageBounds?: WardrobeImageBounds;
  }[];
  createdAt: string;
}
export interface OutfitSnapshotItem extends WardrobeRevisionView {
  layer: number;
  wearNote: string;
}
export interface OutfitSnapshotView {
  layeringConfirmed: boolean;
  id: string;
  outfitId: string;
  projectId: string;
  version: number;
  name: string;
  items: OutfitSnapshotItem[];
  referenceAssetId?: string;
  referenceUrl?: string;
  prompt: string;
  createdAt: string;
}
export interface OutfitView {
  id: string;
  projectId: string;
  name: string;
  version: number;
  currentSnapshot: OutfitSnapshotView;
  snapshots: OutfitSnapshotView[];
}
export interface WardrobeTryOnView {
  id: string;
  snapshotId: string;
  modelAssetId: string;
  taskId: string | null;
  status: "queued" | "running" | "ready" | "failed" | "canceled";
  error: string | null;
  results: { assetId: string; url: string }[];
  createdAt: string;
}
export interface WardrobeCapabilities {
  generationUnavailableReason?: string;
  enabled: boolean;
  preparationEnabled: boolean;
  staticTryOnEnabled: boolean;
  realtimeOutfitEnabled: boolean;
  realtimeMultiItemVerified: boolean;
  realtimeCategories: WardrobeCategory[];
}
export interface WardrobeSummary {
  projectId: string;
  canEdit: boolean;
  capabilities: WardrobeCapabilities;
  items: WardrobeItemView[];
  preparations: WardrobePreparationView[];
  outfits: OutfitView[];
  tryOns: WardrobeTryOnView[];
}
