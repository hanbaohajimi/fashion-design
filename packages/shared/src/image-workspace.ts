import { z } from "zod";
import { imageAdjustmentsSchema } from "./image-adjustments";

/** Admission-verified private identities, kept internally with the task snapshot. */
export const imageInpaintSourceSchema = z.object({
  version: z.literal(1),
  sourceObjectKey: z.string().min(1).optional(),
  maskObjectKey: z.string().min(1).optional(),
}).strict();

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
/** Numbering follows the saved comment list, including whole-image comments. */
export const imageCommentMarkerSchema = z.object({
  number: z.number().int().min(1).max(100),
  point,
}).strict();
export type ImageCommentMarker = z.infer<typeof imageCommentMarkerSchema>;
export const imageOrientationSchema = z.object({
  rotate: z.number().min(-180).max(180),
  flipHorizontal: z.boolean(),
  flipVertical: z.boolean(),
});
export type ImageOrientation = z.infer<typeof imageOrientationSchema>;
export const imageTransformSchema = z
  .object({
    prompt: z.string().max(4000).default("调整图片尺寸"),
    width: z.number().int().min(16).max(8192),
    height: z.number().int().min(16).max(8192),
    // Crop uses the upright source coordinates. Mirror axes refer to the rotated result.
    ...imageOrientationSchema.partial().shape,
    adjustments: imageAdjustmentsSchema.optional(),
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

/** Full rotated bounds, matching Sharp/libvips' nearest-pixel rounding. */
export function rotatedImageSize(width: number, height: number, degrees: number) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  return {
    width: Math.max(1, Math.round(width * cosine + height * sine)),
    height: Math.max(1, Math.round(height * cosine + width * sine)),
  };
}

export const IMAGE_TRANSFORM_QUEUE = "image-transform";
export interface ImageTransformJob {
  attemptId: string;
}

/** Only validated primitives are serialized; never accept caller-provided SVG. */
export function imageAnnotationsSvg(
  items: readonly ImageAnnotation[],
  width: number,
  height: number,
  markers: readonly ImageCommentMarker[] = [],
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
  const radius = Math.min(Math.max(12, Math.min(width, height) * .025), 32, Math.min(width, height) / 4);
  const pins = markers.map(input => {
    const marker = imageCommentMarkerSchema.parse(input);
    const px = marker.point.x * width, py = marker.point.y * height;
    const inset = radius + 1;
    const x = Math.max(inset, Math.min(width - inset, px));
    const y = Math.max(inset, Math.min(height - inset, py));
    // Keep edge labels readable while the line retains the exact selected point.
    return `<g><path d="M${px},${py} L${x},${y}" stroke="#ffffff" stroke-width="3"/><circle cx="${x}" cy="${y}" r="${radius}" fill="#214e40" stroke="#ffffff" stroke-width="2"/><text x="${x}" y="${y + radius * .36}" text-anchor="middle" font-family="sans-serif" font-size="${radius * 1.05}" font-weight="700" fill="#ffffff">${marker.number}</text></g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shapes.join("")}${pins.join("")}</svg>`;
}
