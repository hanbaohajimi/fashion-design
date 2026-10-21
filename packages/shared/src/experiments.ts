import { z } from "zod";

export const experimentModeSchema = z.enum([
  "color",
  "material",
  "detail",
  "presentation",
]);
export const experimentCreateSchema = z
  .object({
    sourceAssetId: z.string().min(1).max(128),
    mode: experimentModeSchema,
    prompt: z.string().trim().min(1).max(2000),
    preserve: z.string().trim().min(1).max(1000),
    colors: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(48),
            hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          })
          .strict(),
      )
      .max(6)
      .default([]),
    fabricIds: z.array(z.string().min(1).max(128)).max(4).default([]),
    variations: z.array(z.string().trim().min(1).max(500)).max(6).default([]),
    width: z.number().int().min(256).max(2048).multipleOf(8).default(1024),
    height: z.number().int().min(256).max(2048).multipleOf(8).default(1024),
    quality: z.enum(["low", "medium", "high"]).default("high"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === "color" && !value.colors.length)
      ctx.addIssue({
        code: "custom",
        path: ["colors"],
        message: "请至少选择一种颜色",
      });
    if (value.mode === "material" && !value.fabricIds.length)
      ctx.addIssue({
        code: "custom",
        path: ["fabricIds"],
        message: "请至少选择一种面料",
      });
    if (
      (value.mode === "detail" || value.mode === "presentation") &&
      !value.variations.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["variations"],
        message: "请至少填写一种修改方案",
      });
    if (
      Math.max(1, value.colors.length) *
        Math.max(1, value.fabricIds.length) *
        Math.max(1, value.variations.length) >
      12
    )
      ctx.addIssue({ code: "custom", message: "一批最多12个方案，请减少组合" });
    if (new Set(value.fabricIds).size !== value.fabricIds.length)
      ctx.addIssue({
        code: "custom",
        path: ["fabricIds"],
        message: "面料不能重复",
      });
  });
export type ExperimentCreateInput = z.infer<typeof experimentCreateSchema>;
export type ExperimentState =
  | "draft"
  | "dispatching"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "not_admitted"
  | "canceled";
export interface ExperimentItemView {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly status: ExperimentState;
  readonly attempt: number;
  readonly taskId: string | null;
  readonly error: string | null;
  readonly color: { readonly name: string; readonly hex: string } | null;
  readonly fabric: {
    readonly id: string;
    readonly tags: readonly string[];
    readonly details: unknown;
  } | null;
  readonly assets: readonly {
    readonly id: string;
    readonly url: string;
    readonly thumbnailUrl: string | null;
  }[];
}
export interface ExperimentView {
  readonly id: string;
  readonly projectId: string;
  readonly sourceAssetId: string;
  readonly version: number;
  readonly mode: ExperimentCreateInput["mode"];
  readonly preserve: string;
  readonly createdAt: string;
  readonly items: readonly ExperimentItemView[];
}
export const experimentActionSchema = z
  .object({
    itemIds: z.array(z.string().min(1).max(128)).min(1).max(12),
    action: z.enum(["submit", "retry", "cancel"]),
  })
  .strict();
export const DESIGN_CAPABILITIES = {
  referenceEditing: {
    available: true,
    verified: false,
    note: "使用已有参考图编辑；结果需人工检查",
  },
  maskedRecolor: {
    available: true,
    verified: false,
    note: "支持母图、蒙版和色卡",
  },
  maskedReferenceEditing: {
    available: false,
    verified: false,
    note: "当前接口未支持蒙版与额外参考图同时输入",
  },
  physicalFit: {
    available: false,
    verified: false,
    note: "图片展示不能验证尺寸与真实合体性",
  },
} as const;
