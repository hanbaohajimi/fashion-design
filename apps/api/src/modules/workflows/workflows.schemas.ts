import { z } from "zod";

export const workflowAssetTypes = [
  "brief",
  "reference_text",
  "reference_image",
  "swatch",
  "sketch",
  "constraint",
  "candidate",
  "evaluation",
  "trend",
  "fabric",
  "legacy",
] as const;

export const workflowToolTypes = [
  "transform_image",
  "analyze_brief",
  "generate_design",
  "evaluate_design",
  "edit_design",
  "restore_version",
] as const;

export const workflowNodeStatuses = [
  "ready",
  "pending",
  "running",
  "completed",
  "failed",
] as const;

const idSchema = z.string().trim().min(1).max(100);
const pointSchema = z.number().finite().min(-1_000_000).max(1_000_000);
const payloadSchema = z.record(z.string(), z.unknown());
const nodeBaseSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(200),
  payload: payloadSchema,
  status: z.enum(workflowNodeStatuses).optional(),
  x: pointSchema,
  y: pointSchema,
});

export const workflowNodeInputSchema = z.discriminatedUnion("kind", [
  nodeBaseSchema.extend({
    kind: z.literal("asset"),
    type: z.enum(workflowAssetTypes),
  }),
  nodeBaseSchema.extend({
    kind: z.literal("tool"),
    type: z.enum(workflowToolTypes),
  }),
]);

export const workflowEdgeInputSchema = z.object({
  id: idSchema,
  sourceNodeId: idSchema,
  targetNodeId: idSchema,
  sourcePort: z.literal("out"),
  targetPort: z.enum([
    "goal",
    "reference",
    "constraint",
    "candidate",
    "source",
  ]),
});

const semanticOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add_node"), node: workflowNodeInputSchema }),
  z.object({
    type: z.literal("update_node"),
    nodeId: idSchema,
    title: z.string().trim().min(1).max(200).optional(),
    payload: payloadSchema.optional(),
    status: z.enum(workflowNodeStatuses).optional(),
  }),
  z.object({ type: z.literal("remove_node"), nodeId: idSchema }),
  z.object({ type: z.literal("add_edge"), edge: workflowEdgeInputSchema }),
  z.object({ type: z.literal("remove_edge"), edgeId: idSchema }),
  z.object({
    type: z.literal("link_collection"),
    nodeId: idSchema,
    collectionId: idSchema,
  }),
]);

export const workflowSemanticPatchSchema = z
  .object({
    mode: z.literal("semantic"),
    mutationId: z.string().uuid(),
    baseRevision: z.number().int().nonnegative(),
    operations: z.array(semanticOperationSchema).min(1).max(100),
  })
  .superRefine((value, context) => {
    value.operations.forEach((operation, index) => {
      if (
        operation.type === "update_node" &&
        operation.title === undefined &&
        operation.payload === undefined &&
        operation.status === undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["operations", index],
          message: "节点更新至少包含一项变更",
        });
      }
    });
  });

export const workflowLayoutPatchSchema = z.object({
  mode: z.literal("layout"),
  mutationId: z.string().uuid(),
  baseLayoutRevision: z.number().int().nonnegative(),
  positions: z
    .array(z.object({ nodeId: idSchema, x: pointSchema, y: pointSchema }))
    .min(1)
    .max(300),
});

export const workflowPatchSchema = z
  .union([workflowSemanticPatchSchema, workflowLayoutPatchSchema])
  .superRefine((value, context) => {
    if (JSON.stringify(value).length > 1_000_000) {
      context.addIssue({ code: "custom", message: "工作流变更不能超过 1MB" });
    }
  });

export type WorkflowNodeInput = z.infer<typeof workflowNodeInputSchema>;
export type WorkflowEdgeInput = z.infer<typeof workflowEdgeInputSchema>;
export type WorkflowSemanticPatchInput = z.infer<
  typeof workflowSemanticPatchSchema
>;
export type WorkflowLayoutPatchInput = z.infer<
  typeof workflowLayoutPatchSchema
>;
export type WorkflowPatchInput = z.infer<typeof workflowPatchSchema>;
