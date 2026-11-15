import { z } from "zod";

export const promptEnhancementRequestSchema = z
  .object({
    requestId: z.uuid(),
    prompt: z.string().trim().min(1).max(4000),
    referencedNodeIds: z
      .array(z.string().trim().min(1).max(128))
      .max(16)
      .default([]),
  })
  .strict();
export const promptEnhancementResultSchema = z
  .object({
    enhancedPrompt: z.string().trim().min(1).max(4000),
  })
  .strict();
export type PromptEnhancementRequest = z.infer<
  typeof promptEnhancementRequestSchema
>;
export type PromptEnhancementResult = z.infer<
  typeof promptEnhancementResultSchema
> & { requestId: string };
