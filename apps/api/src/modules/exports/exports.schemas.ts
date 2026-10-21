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
  z.object({ sourceType: z.literal("presentation_set"), studioRevisionId: z.string().min(1).max(128), format: z.literal("pdf"), quality: z.literal("standard").default("standard") }).strict(),
  assetExportSchema,
  collectionExportSchema,
  z.object({ sourceType: z.literal("tech_pack"), studioRevisionId: z.string().min(1).max(128), format: z.literal("pdf"), quality: z.literal("standard").default("standard") }).strict(),
]);

export type CreateExportInput = z.infer<typeof createExportSchema>;
