import { z } from "zod";

const jsonObjectSchema = z.record(z.string(), z.unknown());
const shapeIdSchema = z.string().min(1).max(200);

const upsertPatchSchema = z.object({
  deleted: z.literal(false).optional(),
  record: jsonObjectSchema,
  role: z.string().trim().min(1).max(64),
  roleConfidence: z.number().min(0).max(1).nullable().optional(),
  roleInferenceState: z.enum(["none", "pending", "ready", "failed"]).optional(),
  roleLabel: z.string().trim().min(1).max(64).nullable().optional(),
  roleSource: z.enum(["default", "inferred", "manual"]).optional(),
  shapeId: shapeIdSchema,
  shapeType: z.string().trim().min(1).max(100),
});

const deletePatchSchema = z.object({
  deleted: z.literal(true),
  shapeId: shapeIdSchema,
});

export const boardPatchSchema = z
  .object({
    baseRevision: z.number().int().nonnegative(),
    batchId: z.string().uuid(),
    patches: z
      .array(
        z.discriminatedUnion("deleted", [
          upsertPatchSchema.extend({ deleted: z.literal(false) }),
          deletePatchSchema,
        ]),
      )
      .max(500),
    snapshot: jsonObjectSchema,
  })
  .superRefine((value, context) => {
    const serializedSize = JSON.stringify(value).length;

    if (serializedSize > 4_000_000) {
      context.addIssue({
        code: "custom",
        message: "画布批次不能超过 4MB",
      });
    }
  });

export type BoardPatchInput = z.infer<typeof boardPatchSchema>;
