import { z } from "zod";

const point = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  pressure: z.number().min(0).max(1).default(0.5),
});
export const sketchDocumentSchema = z
  .object({
    version: z.literal(1),
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096),
    baseFileAssetId: z.string().min(1).optional(),
    strokes: z.array(
      z.object({
        id: z.string().min(1),
        color: z.string().regex(/^#[\da-f]{6}$/i),
        width: z.number().positive().max(100),
        opacity: z.number().min(0).max(1),
        points: z.array(point).min(1),
      }),
    ),
  })
  .superRefine((value, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(value)).length > 512 * 1024)
      ctx.addIssue({
        code: "custom",
        message: "草图笔画超过 512 KiB，请减少笔画后保存",
      });
  });
export type SketchDocumentV1 = z.infer<typeof sketchDocumentSchema>;
export const swatchColorsSchema = z
  .array(
    z.object({
      hex: z.string().regex(/^#[\da-f]{6}$/i),
      name: z.string().trim().min(1).max(48),
    }),
  )
  .min(1)
  .max(12);
export function readSwatchColors(
  payload: Readonly<Record<string, unknown>>,
  title: string,
) {
  const parsed = swatchColorsSchema.safeParse(payload.colors);
  if (parsed.success) return parsed.data;
  return typeof payload.color === "string" &&
    /^#[\da-f]{6}$/i.test(payload.color)
    ? [{ hex: payload.color, name: title.slice(0, 48) || "色彩" }]
    : [];
}
