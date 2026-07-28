import { z } from "zod";

const dnaTermSchema = z.string().trim().min(1).max(64);

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
});

export const collectionVariationAxisSchema = z.enum([
  "silhouette",
  "fabric",
  "color",
  "detail",
  "styling",
]);

export const createCollectionLookSchema = z
  .object({
    parameters: z
      .object({
        cfg: z.number().min(0).max(30).optional(),
        height: z.number().int().min(256).max(2_048).multipleOf(8).optional(),
        seed: z.number().int().min(0).max(4_294_967_295).optional(),
        steps: z.number().int().min(1).max(100).optional(),
        width: z.number().int().min(256).max(2_048).multipleOf(8).optional(),
      })
      .strict()
      .optional(),
    prompt: z.string().trim().max(800).optional(),
    variationAxis: collectionVariationAxisSchema,
  })
  .strict();

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
    palette: z.array(paletteColorSchema).max(12).optional(),
    referenceFileIds: z.array(z.string().min(1).max(128)).max(24).optional(),
    silhouettes: z.array(dnaTermSchema).max(12).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少需要更新一个 DNA 字段",
  });

export type DnaDraft = z.infer<typeof dnaDraftSchema>;
export type CreateCollectionLookInput = z.infer<
  typeof createCollectionLookSchema
>;
export type UpdateDnaInput = z.infer<typeof updateDnaSchema>;
