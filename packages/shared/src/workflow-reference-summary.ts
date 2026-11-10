import { z } from "zod";

const referenceNodeSchema = z.object({
  nodeId: z.string().min(1),
  title: z.string().max(200).nullable(),
}).strict();

/** Facts recorded for one turn, not a claim about the model's reasoning. */
export const workflowReferenceSummarySchema = z.object({
  version: z.literal(1),
  explicit: z.array(referenceNodeSchema).max(64),
  discussion: z.array(referenceNodeSchema).max(64),
  // At most five planner requests, each with up to 64 object-to-image bindings.
  images: z.array(referenceNodeSchema).max(320),
}).strict();

export type WorkflowReferenceSummary = z.infer<typeof workflowReferenceSummarySchema>;
