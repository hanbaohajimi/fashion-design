import { z } from "zod";

export const FABRIC_SPEC_FIELDS = [
  "composition", "weightGsm", "widthCm", "stretch", "weave",
  "supplier", "supplierCode", "price", "unit", "currency", "quotedAt", "moq",
  "appearanceNotes",
] as const;

export const fabricSourceSchema = z.enum(["manual", "supplier", "measured", "ai_visual"]);
export const fabricProvenanceSchema = z.object({
  source: fabricSourceSchema,
  note: z.string().trim().max(500).optional(),
}).strict();

const text = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const positive = (max: number) => z.number().finite().positive().max(max).nullable().optional();
const provenanceShape = Object.fromEntries(
  FABRIC_SPEC_FIELDS.map((field) => [field, fabricProvenanceSchema.optional()]),
) as Record<(typeof FABRIC_SPEC_FIELDS)[number], z.ZodOptional<typeof fabricProvenanceSchema>>;

export const fabricDetailsSchema = z.object({
  name: text(120),
  code: text(80),
  category: text(80),
  composition: z.array(z.object({
    fiber: z.string().trim().min(1).max(60),
    percent: z.number().finite().positive().max(100),
  }).strict()).max(12).nullable().optional(),
  weightGsm: positive(10_000),
  widthCm: positive(1_000),
  stretch: text(120),
  weave: text(120),
  supplier: text(160),
  supplierCode: text(100),
  price: z.number().finite().nonnegative().max(100_000_000).nullable().optional(),
  unit: text(40),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, "币种请填写三位大写字母，例如 CNY").nullable().optional(),
  quotedAt: z.iso.date().nullable().optional(),
  moq: z.number().finite().nonnegative().max(100_000_000).nullable().optional(),
  appearanceNotes: text(1_000),
  provenance: z.object(provenanceShape).strict().optional(),
}).strict().superRefine((details, context) => {
  if (details.composition?.length) {
    const sum = details.composition.reduce((total, item) => total + item.percent, 0);
    if (Math.abs(sum - 100) > 0.01) {
      context.addIssue({ code: "custom", message: "成分比例合计必须为 100%", path: ["composition"] });
    }
    const fibers = details.composition.map((item) => item.fiber.toLocaleLowerCase());
    if (new Set(fibers).size !== fibers.length) {
      context.addIssue({ code: "custom", message: "同一成分请合并填写", path: ["composition"] });
    }
  }
  if (details.price !== undefined && details.price !== null && (!details.currency || !details.unit)) {
    context.addIssue({ code: "custom", message: "填写报价时必须同时填写计价单位与币种", path: ["price"] });
  }
  for (const field of FABRIC_SPEC_FIELDS) {
    const value = details[field];
    const populated = value !== null && value !== undefined && (!Array.isArray(value) || value.length > 0);
    if (!populated) continue;
    const source = details.provenance?.[field];
    if (!source) {
      context.addIssue({ code: "custom", message: "请注明已填写规格的资料来源", path: ["provenance", field] });
    } else if (source.source === "ai_visual" && field !== "appearanceNotes") {
      context.addIssue({ code: "custom", message: "AI 外观建议仅可用于外观说明，不能作为规格或报价依据", path: ["provenance", field] });
    }
  }
});

export type FabricDetails = z.infer<typeof fabricDetailsSchema>;
export type FabricSpecField = (typeof FABRIC_SPEC_FIELDS)[number];
export type FabricProvenance = z.infer<typeof fabricProvenanceSchema>;
