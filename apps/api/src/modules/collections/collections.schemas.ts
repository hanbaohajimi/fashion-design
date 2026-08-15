import { z } from "zod";

const dnaTermSchema = z.string().trim().min(1).max(64);

export const standardGarmentTypeSchema = z.enum([
  "jacket",
  "coat",
  "vest",
  "shirt",
  "blouse",
  "tshirt",
  "top",
  "knit",
  "pants",
  "shorts",
  "skirt",
  "dress",
  "jumpsuit",
  "custom",
]);

export const garmentTypeSchema = z
  .object({
    code: standardGarmentTypeSchema,
    label: dnaTermSchema,
  })
  .strict();

export const paletteColorSchema = z.object({
  hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  name: z.string().trim().min(1).max(40),
});

export const dnaDraftSchema = z.object({
  fabrics: z.array(dnaTermSchema).max(12),
  moodWords: z.array(dnaTermSchema).max(12),
  palette: z.array(paletteColorSchema).max(12),
  silhouettes: z.array(dnaTermSchema).max(12),
});

export const createCollectionSchema = z.object({
  heroAssetId: z.string().min(1).max(128),
  sourceGarmentType: garmentTypeSchema.optional(),
});

export const updateCollectionSchema = z
  .object({ sourceGarmentType: garmentTypeSchema.nullable() })
  .strict();

export const collectionVariationAxisSchema = z.enum([
  "silhouette",
  "fabric",
  "color",
  "detail",
  "styling",
  "garmentType",
]);

export const createCollectionLookSchema = z
  .object({
    parameters: z
      .object({
        height: z.number().int().min(256).max(2_048).multipleOf(8).optional(),
        width: z.number().int().min(256).max(2_048).multipleOf(8).optional(),
      })
      .strict()
      .optional(),
    prompt: z.string().trim().max(800).optional(),
    garmentType: garmentTypeSchema.optional(),
    slotKey: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    variationAxis: collectionVariationAxisSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.variationAxis !== "garmentType") return;
    if (!value.garmentType) {
      context.addIssue({
        code: "custom",
        message: "服装类型变化必须指定 garmentType",
        path: ["garmentType"],
      });
    }
    if (!value.slotKey) {
      context.addIssue({
        code: "custom",
        message: "服装类型变化必须指定 slotKey",
        path: ["slotKey"],
      });
    }
  });

export const forceKeepCollectionLookSchema = z
  .object({ force: z.literal(true) })
  .strict();

export const updateDnaSchema = z
  .object({
    fabrics: z.array(dnaTermSchema).max(12).optional(),
    locks: z
      .object({
        fabrics: z.boolean().optional(),
        moodWords: z.boolean().optional(),
        palette: z.boolean().optional(),
        silhouettes: z.boolean().optional(),
      })
      .strict()
      .optional(),
    moodWords: z.array(dnaTermSchema).max(12).optional(),
    signatureDetails: z.array(dnaTermSchema).max(12).optional(),
    palette: z.array(paletteColorSchema).max(12).optional(),
    referenceFileIds: z.array(z.string().min(1).max(128)).max(24).optional(),
    silhouettes: z.array(dnaTermSchema).max(12).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少需要更新一个 DNA 字段",
  });

export type DnaDraft = z.infer<typeof dnaDraftSchema>;
export type GarmentType = z.infer<typeof garmentTypeSchema>;
export type CreateCollectionLookInput = z.infer<
  typeof createCollectionLookSchema
>;
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;
export type UpdateDnaInput = z.infer<typeof updateDnaSchema>;
