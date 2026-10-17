import { z } from "zod";

const id = z.string().trim().min(1).max(128);

export const workflowProposalRequestSchema = z.object({
  content: z.string().trim().min(1).max(4_000),
  referencedNodeIds: z.array(id).max(16).default([]),
  mutationId: z.uuid(),
});

export const workflowProposalDecisionSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  mutationId: z.uuid(),
});

export const workflowExecuteSchema = z.object({ mutationId: z.uuid(), conversationId: id.optional() });
export const workflowRejectSchema = z.object({ mutationId: z.uuid(), reason: z.string().trim().min(1).max(2_000).optional() });
export const workflowRoleInferenceSchema = z.object({ mutationId: z.uuid() });

export const workflowImportAssetSchema = z.object({
  sourceNodeId: id,
  assetId: id,
  operation: z.literal("restore"),
  mutationId: z.uuid(),
});

export const workflowNodeDecisionSchema = z.object({
  assetId: id,
  kind: z.enum(["selected", "rejected", "compare"]),
  reason: z.string().trim().min(1).max(2_000),
  mutationId: z.uuid(),
});

export type WorkflowProposalRequest = z.infer<
  typeof workflowProposalRequestSchema
>;
export type WorkflowProposalDecision = z.infer<
  typeof workflowProposalDecisionSchema
>;
export type WorkflowExecuteRequest = z.infer<typeof workflowExecuteSchema>;
export type WorkflowRejectRequest = z.infer<typeof workflowRejectSchema>;
export type WorkflowRoleInferenceRequest = z.infer<typeof workflowRoleInferenceSchema>;
export type WorkflowNodeDecision = z.infer<typeof workflowNodeDecisionSchema>;
