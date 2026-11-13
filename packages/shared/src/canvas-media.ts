import { z } from "zod";

/** Stable resource identity only; expiring storage URLs never enter a canvas snapshot. */
export const canvasMediaPayloadSchema = z.object({
  mediaId: z.string().min(1).max(200),
  mediaKind: z.enum(["video", "audio"]),
  mimeType: z.string().min(1).max(100),
  mediaUrl: z.string().min(1),
  runId: z.string().min(1).max(200),
  showId: z.string().min(1).max(200),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
}).strict();
export type CanvasMediaPayload = z.infer<typeof canvasMediaPayloadSchema>;

export function canvasMediaUrl(projectId: string, mediaId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/runway/media/${encodeURIComponent(mediaId)}/content`;
}
