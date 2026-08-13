import { z } from "zod";

const jsonObjectSchema = z.record(z.string(), z.unknown());
const shapeIdSchema = z.string().min(1).max(200);

export const RETIRED_BOARD_SHAPE_TYPE = "fashion-connector";

export function isRetiredBoardShapeType(
  value: unknown,
): value is typeof RETIRED_BOARD_SHAPE_TYPE {
  return value === RETIRED_BOARD_SHAPE_TYPE;
}

export function isRetiredBoardShapeRecord(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.typeName === "shape" && isRetiredBoardShapeType(record.type)
  );
}

export function stripRetiredBoardShapes(snapshot: unknown): unknown {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return snapshot;
  }
  const root = snapshot as Record<string, unknown>;
  const document = root.document;
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return snapshot;
  }
  const documentRecord = document as Record<string, unknown>;
  const store = documentRecord.store;
  if (!store || typeof store !== "object" || Array.isArray(store)) {
    return snapshot;
  }
  const storeRecord = store as Record<string, unknown>;
  const entries = Object.entries(storeRecord);
  const retainedEntries = entries.filter(
    ([, record]) => !isRetiredBoardShapeRecord(record),
  );
  if (retainedEntries.length === entries.length) return snapshot;
  return {
    ...root,
    document: {
      ...documentRecord,
      store: Object.fromEntries(retainedEntries),
    },
  };
}

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

export const importTrendSchema = z.object({
  position: z
    .object({
      x: z.number().finite().min(-1_000_000).max(1_000_000),
      y: z.number().finite().min(-1_000_000).max(1_000_000),
    })
    .optional(),
  trendItemId: z.string().trim().min(1).max(100),
});

export type ImportTrendInput = z.infer<typeof importTrendSchema>;
