import { z } from "zod";

const id = z.string().trim().min(1).max(128);

export const assistantSkillScopeSchema = z.enum(["PERSONAL", "WORKSPACE"]);
export const assistantSkillInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(200).default(""),
    prompt: z.string().trim().min(1).max(4_000),
    scope: assistantSkillScopeSchema.default("PERSONAL"),
  })
  .strict();
export const assistantSkillViewSchema = assistantSkillInputSchema
  .extend({
    id,
    ownerId: id,
    workspaceId: id.nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export type AssistantSkillInput = z.infer<typeof assistantSkillInputSchema>;
export type AssistantSkillView = z.infer<typeof assistantSkillViewSchema>;

