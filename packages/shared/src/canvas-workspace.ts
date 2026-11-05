import { z } from "zod";
import { workflowToolKeySchema } from "./workflow-tools";

const id = z.string().trim().min(1).max(200);
const payload = z.record(z.string(), z.unknown());
export const canvasMaterialTypeSchema = z.enum([
  "brief",
  "reference_text",
  "reference_image",
  "swatch",
  "sketch",
  "trend",
  "fabric",
  "legacy",
  "candidate",
]);
const common = {
  mutationId: z.uuid(),
  baseGraphRevision: z.number().int().nonnegative().optional(),
};
export const canvasInputBindingSchema = z
  .object({
    nodeId: id,
    port: z.enum(["goal", "reference", "constraint", "candidate", "source"]),
  })
  .strict();
export const canvasCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...common,
      type: z.literal("create_material"),
      clientMaterialId: id.optional(),
      materialType: canvasMaterialTypeSchema,
      title: z.string().trim().min(1).max(200),
      payload,
      shapeId: id.optional(),
      position: z
        .object({ x: z.number().finite(), y: z.number().finite() })
        .optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("update_material"),
      nodeId: id,
      title: z.string().trim().min(1).max(200).optional(),
      payload,
      shapeId: id.optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("run_tool"),
      toolKey: workflowToolKeySchema,
      title: z.string().trim().min(1).max(120),
      parameters: payload,
      inputs: z.array(canvasInputBindingSchema).max(20),
      newObjective: z.string().trim().min(1).max(4_000).optional(),
      conversationId: id.optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("configure_tool"),
      nodeId: id,
      parameters: payload,
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("execute_tool"),
      nodeId: id,
      conversationId: id.optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("decide"),
      nodeId: id,
      assetId: id,
      kind: z.enum(["selected", "rejected", "compare"]),
      reason: z.string().trim().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("restore"),
      sourceNodeId: id,
      assetId: id,
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("link_collection"),
      nodeId: id,
      collectionId: id,
    })
    .strict(),
]);
export type CanvasCommand = z.infer<typeof canvasCommandSchema>;
export const canvasSaveSchema = z
  .object({
    mutationId: z.uuid(),
    baseRevision: z.number().int().nonnegative(),
    snapshot: payload,
    bindings: z
      .array(z.object({ shapeId: id, nodeId: id }).strict())
      .max(2_000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 4_000_000)
      ctx.addIssue({
        code: "custom",
        message: "白板内容超过单次保存的 4MB 限制，请保留草稿并减少内容",
      });
    if (
      new Set(value.bindings.map((binding) => binding.shapeId)).size !==
      value.bindings.length
    )
      ctx.addIssue({
        code: "custom",
        message: "同一个白板对象不能绑定多个素材",
      });
  });
export type CanvasSave = z.infer<typeof canvasSaveSchema>;
export interface CanvasBinding {
  readonly shapeId: string;
  readonly nodeId: string;
  readonly removed: boolean;
}
export interface CanvasDocumentView {
  readonly projectId: string;
  readonly revision: number;
  readonly formatVersion: number;
  readonly snapshot: Record<string, unknown>;
  readonly bindings: readonly CanvasBinding[];
  readonly initializedFrom: string;
  readonly mode: "node" | "canvas";
  readonly canEdit: boolean;
}
export interface CanvasReferenceSnapshot {
  readonly nodeId: string;
  readonly nodeVersionId: string;
  readonly assetId: string | null;
}
