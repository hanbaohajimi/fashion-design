import { aiGenerationRequestSchema } from "@fashion/ai";
import { z } from "zod";

export const generationCreateRequestSchema = z.intersection(
  aiGenerationRequestSchema,
  z.object({
    projectId: z.string().min(1).max(128).optional(),
  }),
);

export type GenerationCreateRequest = z.infer<
  typeof generationCreateRequestSchema
>;

