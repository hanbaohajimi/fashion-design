import { z } from "zod";

const point = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
  .strict();
export const imageAnnotationSchema = z
  .object({
    id: z.string().min(1).max(128),
    kind: z.enum(["pen", "rectangle", "arrow", "text"]),
    points: z.array(point).min(1).max(4000),
    color: z.string().regex(/^#[\da-f]{6}$/iu),
    width: z.number().min(1).max(80),
    text: z.string().max(500).default(""),
  })
  .strict();
export const imageCommentSchema = z
  .object({
    id: z.string().min(1).max(128),
    text: z.string().trim().min(1).max(2000),
    point: point.nullable(),
    annotationIds: z.array(z.string().max(128)).max(100).default([]),
  })
  .strict();
export const imageFeedbackSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    annotations: z.array(imageAnnotationSchema).max(100),
    comments: z.array(imageCommentSchema).max(100),
  })
  .strict();
export type ImageAnnotation = z.infer<typeof imageAnnotationSchema>;
export type ImageComment = z.infer<typeof imageCommentSchema>;
export type ImageFeedback = z.infer<typeof imageFeedbackSchema>;
export const imageTransformSchema = z
  .object({
    prompt: z.string().max(4000).default("调整图片尺寸"),
    width: z.number().int().min(16).max(8192),
    height: z.number().int().min(16).max(8192),
    crop: z
      .object({
        left: z.number().int().nonnegative(),
        top: z.number().int().nonnegative(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (v) => v.width * v.height <= 32_000_000,
    "输出图片不能超过 3200 万像素",
  );
export const imageOutpaintSchema = z
  .object({
    width: z.number().int().min(256).max(2048).multipleOf(16),
    height: z.number().int().min(256).max(2048).multipleOf(16),
    left: z.number().int().nonnegative(),
    top: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (v) =>
      v.width * v.height >= 655360 &&
      Math.max(v.width, v.height) / Math.min(v.width, v.height) <= 3,
    "扩图尺寸需至少 655360 像素，长宽比不超过 3:1",
  );
export type ImageTransform = z.infer<typeof imageTransformSchema>;
export const IMAGE_TRANSFORM_QUEUE = "image-transform";
export interface ImageTransformJob {
  attemptId: string;
}

/** Only validated primitives are serialized; never accept caller-provided SVG. */
export function imageAnnotationsSvg(
  items: readonly ImageAnnotation[],
  width: number,
  height: number,
): string {
  const escape = (s: string) =>
    s.replace(
      /[&<>"']/gu,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c] ?? c,
    );
  const shapes = items.map((input) => {
    const a = imageAnnotationSchema.parse(input);
    const p = a.points.map((v) => ({ x: v.x * width, y: v.y * height }));
    const start = p[0];
    const end = p[p.length - 1];
    if (!start || !end) return "";
    const attributes = `stroke="${a.color}" stroke-width="${a.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
    if (a.kind === "text")
      return `<text x="${start.x}" y="${start.y}" fill="${a.color}" font-family="sans-serif" font-size="${Math.max(18, a.width * 5)}">${escape(a.text)}</text>`;
    if (a.kind === "rectangle")
      return `<rect x="${Math.min(start.x, end.x)}" y="${Math.min(start.y, end.y)}" width="${Math.abs(end.x - start.x)}" height="${Math.abs(end.y - start.y)}" ${attributes}/>`;
    if (a.kind === "arrow") {
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const length = Math.max(16, a.width * 4);
      return `<path d="M${start.x},${start.y} L${end.x},${end.y} M${end.x - length * Math.cos(angle - 0.5)},${end.y - length * Math.sin(angle - 0.5)} L${end.x},${end.y} L${end.x - length * Math.cos(angle + 0.5)},${end.y - length * Math.sin(angle + 0.5)}" ${attributes}/>`;
    }
    return `<polyline points="${p.map((v) => `${v.x},${v.y}`).join(" ")}" ${attributes}/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shapes.join("")}</svg>`;
}
