import { z } from "zod";

const qualitySchema = z.enum(["standard", "high"]).default("standard");

const assetExportSchema = z
  .object({
    assetId: z.string().min(1).max(100),
    format: z.enum(["png", "jpg"]),
    quality: qualitySchema,
    sourceType: z.literal("asset"),
  })
  .strict();

const collectionExportSchema = z
  .object({
    collectionId: z.string().min(1).max(100),
    format: z.literal("pdf"),
    quality: z.literal("standard").default("standard"),
    sourceType: z.literal("collection"),
  })
  .strict();

export const createExportSchema = z.discriminatedUnion("sourceType", [
  assetExportSchema,
  collectionExportSchema,
]);

export type CreateExportInput = z.infer<typeof createExportSchema>;
