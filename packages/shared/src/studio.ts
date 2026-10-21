import { z } from "zod";

const text = z.string().trim().max(2000);
const name = z.string().trim().min(1).max(120);
const id = z.string().min(1).max(128);
const tags = z.array(name).max(60).default([]);
export const studioRequestKeySchema = z.string().min(8).max(200);
export const studioRoleSchema = z.enum([
  "OWNER",
  "EDITOR",
  "REVIEWER",
  "VIEWER",
]);
export const studioStyleStatusSchema = z.enum([
  "DESIGNING",
  "REVIEW",
  "APPROVED",
  "SAMPLING",
  "ARCHIVED",
]);
export const studioViewSchema = z
  .object({
    kind: z.enum(["front", "back", "detail"]),
    assetId: id,
    label: text.default(""),
    reviewed: z.boolean().default(false),
  })
  .strict();
export const studioColorSchema = z
  .object({
    name,
    hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    reviewed: z.boolean().default(false),
  })
  .strict();
export const studioStyleSchema = z
  .object({
    name,
    code: z.string().trim().min(1).max(60),
    category: name,
    season: text.default(""),
    description: text.default(""),
    sourceAssetId: id,
    views: z.array(studioViewSchema).max(20).default([]),
    status: studioStyleStatusSchema.default("DESIGNING"),
    changeNote: text.default(""),
  })
  .strict();
export const createStudioStyleSchema = studioStyleSchema.extend({
  requestKey: studioRequestKeySchema,
});
export const updateStudioStyleSchema = createStudioStyleSchema.extend({
  expectedVersion: z.number().int().positive(),
});
const provenance = z.enum(["manual", "supplier", "measured", "ai"]);
export const studioBrandImportSchema = z
  .object({ revisionId: id, requestKey: studioRequestKeySchema })
  .strict();
export const studioBrandSchema = z
  .object({
    name,
    colors: z
      .array(studioColorSchema.omit({ reviewed: true }))
      .max(30)
      .default([]),
    silhouettes: tags,
    signatureDetails: tags,
    fabricPreferences: tags,
    avoid: tags,
    notes: text.default(""),
    referenceAssetIds: z.array(id).max(20).default([]),
    copiedFromRevisionId: id.optional(),
  })
  .strict();
export const studioSlotSchema = z
  .object({
    name,
    collectionId: id,
    category: name,
    role: z.enum(["HERO", "CORE", "EXPERIMENTAL"]).default("CORE"),
    status: z
      .enum(["PLANNED", "DESIGNING", "REVIEW", "DONE"])
      .default("PLANNED"),
    styleRevisionId: id.optional(),
    notes: text.default(""),
  })
  .strict();
export const studioBomSchema = z
  .object({
    name,
    material: text.default(""),
    quantity: z.number().finite().positive().nullable().default(null),
    unit: name,
    supplier: text.default(""),
    reviewed: z.boolean().default(false),
    source: provenance.default("manual"),
  })
  .strict();
export const studioPomSchema = z
  .object({
    name,
    value: z.number().finite().positive().nullable().default(null),
    unit: z.enum(["cm", "mm", "in"]).default("cm"),
    tolerance: z.number().finite().nonnegative().nullable().default(null),
    reviewed: z.boolean().default(false),
    source: provenance.default("manual"),
  })
  .strict();
export const studioAnnotationSchema = z
  .object({
    assetId: id,
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    text: name,
    reviewed: z.boolean().default(false),
  })
  .strict();
export const studioTechPackSchema = z
  .object({
    name,
    styleRevisionId: id,
    status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
    views: z.array(studioViewSchema).max(20).default([]),
    annotations: z.array(studioAnnotationSchema).max(100).default([]),
    bom: z.array(studioBomSchema).max(100).default([]),
    pom: z.array(studioPomSchema).max(100).default([]),
    colors: z.array(studioColorSchema).max(30).default([]),
    constructionNotes: text.default(""),
    reviewConfirmed: z.boolean().default(false),
  })
  .strict();
export function studioPublishIssues(
  payload: z.infer<typeof studioTechPackSchema>,
): string[] {
  const issues: string[] = [];
  if (!payload.reviewConfirmed) issues.push("请确认人工复核");
  if (
    !["front", "back"].every((kind) =>
      payload.views.some((view) => view.kind === kind && view.reviewed),
    )
  )
    issues.push("正背视图需要人工复核");
  if (
    !payload.bom.length ||
    payload.bom.some(
      (row) =>
        !row.reviewed ||
        row.quantity === null ||
        !row.material ||
        row.source === "ai",
    )
  )
    issues.push("BOM 需要已复核的材料和用量");
  if (
    !payload.pom.length ||
    payload.pom.some(
      (row) =>
        !row.reviewed ||
        row.value === null ||
        row.tolerance === null ||
        row.source === "ai",
    )
  )
    issues.push("POM 需要已复核的尺寸和公差");
  if (!payload.colors.length || payload.colors.some((row) => !row.reviewed))
    issues.push("配色需要人工复核");
  if (payload.annotations.some((row) => !row.reviewed))
    issues.push("工艺标注需要人工复核");
  return issues;
}
export const studioSampleIssueSchema = z
  .object({
    id,
    assetId: id,
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    category: z.enum([
      "FIT",
      "COLOR",
      "FABRIC",
      "CONSTRUCTION",
      "MEASUREMENT",
      "TRIM",
      "PRINT",
    ]),
    text: name,
    status: z.enum(["OPEN", "FIXED", "VERIFIED"]).default("OPEN"),
    resolution: text.default(""),
    assigneeId: id.optional(),
  })
  .strict();
export const studioSampleSchema = z
  .object({
    name,
    techPackRevisionId: id,
    round: z.number().int().positive().max(1000),
    photoAssetIds: z.array(id).min(1).max(30),
    issues: z.array(studioSampleIssueSchema).max(100).default([]),
    notes: text.default(""),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.issues.map((issue) => issue.id)).size !==
      value.issues.length
    )
      context.addIssue({ code: "custom", message: "问题编号重复" });
    if (
      value.issues.some((issue) => !value.photoAssetIds.includes(issue.assetId))
    )
      context.addIssue({ code: "custom", message: "问题必须锚定本轮样衣图片" });
    if (
      value.issues.some((issue) => issue.status !== "OPEN" && !issue.resolution)
    )
      context.addIssue({
        code: "custom",
        message: "解决或复核问题需要处理依据",
      });
  });
export const studioCommentSchema = z
  .object({
    name,
    targetType: z.enum(["STYLE", "TECH_PACK"]),
    targetRevisionId: id,
    assetId: id.optional(),
    x: z.number().min(0).max(1).optional(),
    y: z.number().min(0).max(1).optional(),
    text: z.string().trim().min(1).max(2000),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.x !== undefined || value.y !== undefined) &&
      (!value.assetId || value.x === undefined || value.y === undefined)
    )
      context.addIssue({
        code: "custom",
        message: "定位批注必须指定图片和完整坐标",
      });
  });
export const studioReviewSchema = z
  .object({
    name,
    targetType: z.enum(["STYLE", "TECH_PACK"]),
    targetRevisionId: id,
    decision: z.enum(["APPROVED", "CHANGES_REQUESTED"]),
    text: z.string().trim().min(1).max(2000),
  })
  .strict();
export const studioPrintPatternSchema = z
  .object({
    name,
    sourceAssetId: id,
    scale: z.number().min(0.1).max(5).default(1),
    rotation: z.number().min(0).max(360).default(0),
    brightness: z.number().min(0.2).max(2).default(1),
    offsetX: z.number().min(-1).max(1).default(0),
    offsetY: z.number().min(-1).max(1).default(0),
    tileWidthCm: z.number().finite().positive().optional(),
    tileHeightCm: z.number().finite().positive().optional(),
    reviewed: z.boolean().default(false),
    notes: text.default(""),
  })
  .strict();
export const studioPresentationSchema = z
  .object({
    name,
    styleRevisionId: id,
    status: z.enum(["DRAFT", "READY"]).default("DRAFT"),
    channel: z
      .enum(["marketplace", "social", "lookbook"])
      .default("marketplace"),
    items: z
      .array(
        z
          .object({
            assetId: id,
            kind: z.enum(["front", "back", "detail", "scene"]),
            label: text.default(""),
            reviewed: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    notes: text.default(""),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.items.map((item) => item.assetId)).size !==
      value.items.length
    )
      context.addIssue({ code: "custom", message: "展示图片不能重复" });
    if (value.status === "READY" && value.items.some((item) => !item.reviewed))
      context.addIssue({
        code: "custom",
        message: "交付前请逐张人工核对商品外观",
      });
  });
const mutation = {
  requestKey: studioRequestKeySchema,
  documentId: id.optional(),
  expectedVersion: z.number().int().positive().optional(),
};
export const studioDocumentInputSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        ...mutation,
        type: z.literal("PRESENTATION_SET"),
        payload: studioPresentationSchema,
      })
      .strict(),
    z
      .object({
        ...mutation,
        type: z.literal("BRAND_PROFILE"),
        payload: studioBrandSchema,
      })
      .strict(),
    z
      .object({
        ...mutation,
        type: z.literal("COLLECTION_SLOT"),
        payload: studioSlotSchema,
      })
      .strict(),
    z
      .object({
        ...mutation,
        type: z.literal("TECH_PACK"),
        payload: studioTechPackSchema,
      })
      .strict(),
    z
      .object({
        ...mutation,
        type: z.literal("SAMPLE_ROUND"),
        payload: studioSampleSchema,
      })
      .strict(),
    z
      .object({
        ...mutation,
        type: z.literal("COMMENT"),
        payload: studioCommentSchema,
      })
      .strict(),
    z
      .object({
        ...mutation,
        type: z.literal("REVIEW"),
        payload: studioReviewSchema,
      })
      .strict(),
    z
      .object({
        ...mutation,
        type: z.literal("PRINT_PATTERN"),
        payload: studioPrintPatternSchema,
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (Boolean(value.documentId) !== Boolean(value.expectedVersion))
      context.addIssue({
        code: "custom",
        message: "更新文档必须携带 documentId 和 expectedVersion",
      });
  });
export const studioMemberCreateSchema = z
  .object({
    email: z.email().max(254),
    role: z.enum(["EDITOR", "REVIEWER", "VIEWER"]),
    requestKey: studioRequestKeySchema,
  })
  .strict();
export const studioMemberUpdateSchema = z
  .object({
    role: z.enum(["EDITOR", "REVIEWER", "VIEWER"]),
    expectedVersion: z.number().int().positive(),
    requestKey: studioRequestKeySchema,
  })
  .strict();
export const studioMemberDeleteSchema = studioMemberUpdateSchema.omit({
  role: true,
});
export type StudioRole = z.infer<typeof studioRoleSchema>;
export type StudioStyleInput = z.infer<typeof studioStyleSchema>;
export type StudioDocumentInput = z.infer<typeof studioDocumentInputSchema>;
export type StudioDocumentPayload = StudioDocumentInput["payload"];
export type StudioTechPack = z.infer<typeof studioTechPackSchema>;
export interface StudioAssetView {
  id: string;
  url: string;
  thumbnailUrl: string | null;
}
export interface StudioStyleRevisionView {
  id: string;
  revision: number;
  payload: StudioStyleInput;
  views: (z.infer<typeof studioViewSchema> & {
    url: string;
    thumbnailUrl: string | null;
  })[];
  createdAt: string;
}
export interface StudioStyleView {
  id: string;
  code: string;
  name: string;
  category: string;
  season: string;
  status: StudioStyleInput["status"];
  version: number;
  currentRevision: StudioStyleRevisionView;
  revisions: StudioStyleRevisionView[];
}
export interface StudioDocumentRevisionView {
  createdById?: string | null;
  id: string;
  revision: number;
  payload: StudioDocumentPayload;
  createdAt: string;
}
export interface StudioDocumentView {
  id: string;
  type: StudioDocumentInput["type"];
  version: number;
  currentRevision: StudioDocumentRevisionView;
  revisions: StudioDocumentRevisionView[];
}
export interface StudioMemberView {
  id: string;
  userId: string;
  email: string;
  role: StudioRole;
  version: number;
}
export interface StudioSummary {
  role: StudioRole;
  capabilities: { edit: boolean; review: boolean; manageMembers: boolean };
  styles: StudioStyleView[];
  brandProfiles: StudioDocumentView[];
  slots: StudioDocumentView[];
  techPacks: StudioDocumentView[];
  samples: StudioDocumentView[];
  comments: StudioDocumentView[];
  reviews: StudioDocumentView[];
  patterns: StudioDocumentView[];
  presentationSets: StudioDocumentView[];
  members: StudioMemberView[];
  collections: { id: string; name: string }[];
  assets: StudioAssetView[];
}
