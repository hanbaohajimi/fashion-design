import { z } from "zod";

const id = z.string().min(1).max(200);
export const workflowResultImageSchema = z
  .object({
    assetId: id,
    nodeId: id.nullable(),
    title: z.string().min(1).max(200),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
  })
  .strict();

/** The output identities of one terminal execution, independent of later graph edits. */
export const workflowExecutionResultSchema = z
  .object({
    version: z.literal(1),
    executionId: id,
    toolNodeId: id,
    status: z.enum([
      "completed",
      "partial_failed",
      "failed",
      "canceled",
      "moderation_failed",
    ]),
    completedAt: z.string().datetime().nullable(),
    attempts: z
      .object({
        completed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        canceled: z.number().int().nonnegative(),
      })
      .strict(),
    images: z.array(workflowResultImageSchema).max(128),
  })
  .strict();

export type WorkflowResultImage = z.infer<typeof workflowResultImageSchema>;
export type WorkflowExecutionResult = z.infer<
  typeof workflowExecutionResultSchema
>;
