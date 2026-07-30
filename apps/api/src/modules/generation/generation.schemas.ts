import { aiGenerationRequestSchema } from "@fashion/ai";
import { z } from "zod";

export const generationCreateRequestSchema = z.intersection(
  aiGenerationRequestSchema,
  z.object({
    parentAssetId: z.string().min(1).max(128).optional(),
    projectId: z.string().min(1).max(128).optional(),
    shapeIds: z.array(z.string().min(1).max(128)).max(100).optional(),
  }),
);

export type GenerationCreateRequest = z.infer<
  typeof generationCreateRequestSchema
>;

export const generationListQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  projectId: z.string().trim().min(1).max(128),
});

export type GenerationListQuery = z.infer<typeof generationListQuerySchema>;
