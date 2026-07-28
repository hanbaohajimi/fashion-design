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
export type UpdateDnaInput = z.infer<typeof updateDnaSchema>;
