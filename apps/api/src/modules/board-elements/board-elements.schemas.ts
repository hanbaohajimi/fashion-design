import { BOARD_ELEMENT_ROLES } from "@fashion/shared";
import { z } from "zod";

export const projectIdSchema = z.string().min(1).max(100);
export const shapeIdSchema = z.string().min(1).max(200);
export const inferRoleSchema = z.object({
  fileId: z.string().min(1).max(100),
});
const jsonObjectSchema = z.record(z.string(), z.unknown());
export const bindSketchReferenceSchema = z
  .object({
    fileId: z.string().min(1).max(100),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    record: jsonObjectSchema,
  })
  .superRefine((value, context) => {
    const meta = value.record.meta;
    const sketchMeta =
      meta && !Array.isArray(meta) && typeof meta === "object"
        ? (meta as Record<string, unknown>)
        : null;
    const props = value.record.props;
    const sketchProps =
      props && !Array.isArray(props) && typeof props === "object"
        ? (props as Record<string, unknown>)
        : null;
    if (
      value.record.typeName !== "shape" ||
      value.record.type !== "fashion-image" ||
      sketchMeta?.fashionSketch !== true ||
      sketchMeta.fashionSketchImage !== true ||
      sketchMeta.sketchStatus !== "ready" ||
      sketchMeta.sketchDirty !== false ||
      sketchMeta.sketchFingerprint !== value.fingerprint ||
      sketchProps?.fileId !== value.fileId ||
      sketchProps.role !== "silhouette_ref" ||
      sketchProps.roleSource !== "manual" ||
      sketchProps.roleInferenceState !== "ready" ||
      sketchProps.roleLabel !== "fashion_sketch" ||
      typeof sketchProps.url !== "string" ||
      sketchProps.url.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "草图记录必须是已完成且与渲染内容一致的廓形图片",
        path: ["record"],
      });
    }
    if (JSON.stringify(value.record).length > 1_000_000) {
      context.addIssue({
        code: "custom",
        message: "草图图片记录不能超过 1MB",
        path: ["record"],
      });
    }
  });
export const setElementRolesSchema = z.object({
  role: z.enum(BOARD_ELEMENT_ROLES),
  shapeIds: z.array(shapeIdSchema).min(1).max(100),
});

export type SetElementRolesInput = z.infer<typeof setElementRolesSchema>;
export type BindSketchReferenceInput = z.infer<
  typeof bindSketchReferenceSchema
>;
