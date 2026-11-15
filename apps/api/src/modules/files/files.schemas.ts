import { z } from "zod";

export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const VIDEO_MIME_TYPES = ["video/mp4", "video/webm"] as const;
export const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export const signUploadSchema = z.object({
  mimeType: z.enum([...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES], {
    error: "支持 JPG、PNG、WebP、HEIC 图片或 MP4、WebM 视频",
  }),
  name: z.string().trim().min(1).max(255),
  projectId: z.string().min(1).max(100),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, "SHA256 必须是 64 位十六进制字符串")
    .transform((value) => value.toLowerCase()),
  size: z.number().int().positive().max(MAX_VIDEO_BYTES, "视频不能超过 100MB"),
}).superRefine((input, ctx) => { if (input.mimeType.startsWith("image/") && input.size > MAX_IMAGE_BYTES) ctx.addIssue({ code: "custom", path: ["size"], message: "图片不能超过 50MB" }); });

export type SignUploadInput = z.infer<typeof signUploadSchema>;
