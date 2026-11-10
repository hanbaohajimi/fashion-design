import { z } from "zod";
import { workflowExecutionResultSchema } from "./workflow-execution-result";

const id = z.string().min(1).max(200);
const count = z.number().int().nonnegative();
export const workflowExecutionProgressSchema = z
  .object({
    version: z.literal(1),
    executionId: id,
    toolNodeId: id,
    title: z.string().min(1).max(200),
    operation: z.enum(["image", "analysis", "transform", "other"]),
    status: z.enum([
      "preparing",
      "queued",
      "running",
      "processing",
      "completed",
      "partial_failed",
      "failed",
      "canceled",
      "moderation_failed",
    ]),
    updatedAt: z.string().datetime(),
    counts: z
      .object({
        total: z.number().int().positive(),
        preparing: count,
        queued: count,
        running: count,
        completed: count,
        failed: count,
        canceled: count,
      })
      .strict(),
    cancelTaskIds: z.array(id).max(128),
  })
  .strict();
export const workflowProposalExecutionSchema = z
  .object({
    version: z.literal(1),
    binding: z.enum(["linked", "not_started", "changed", "unrecorded"]),
    nodeVersionId: id.nullable(),
    canExecute: z.boolean(),
    progress: workflowExecutionProgressSchema.nullable(),
    result: workflowExecutionResultSchema.nullable(),
  })
  .strict();
export type WorkflowExecutionProgress = z.infer<
  typeof workflowExecutionProgressSchema
>;
export type WorkflowProposalExecution = z.infer<
  typeof workflowProposalExecutionSchema
>;
