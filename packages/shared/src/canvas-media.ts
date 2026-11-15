import { z } from "zod";

/** Stable resource identity only; expiring storage URLs never enter a canvas snapshot. */
export const canvasMediaPayloadSchema = z.object({
  mediaId: z.string().min(1).max(200),
  fileAssetId: z.string().min(1).max(200).optional(),
  canvasCreationId: z.string().optional(),
  canvasCreationRunId: z.string().optional(),
  canvasPlacement: z.literal("manual").optional(),
  sourceNodeId: z.string().optional(),
  mediaKind: z.enum(["video", "audio"]),
  mimeType: z.string().min(1).max(100),
  mediaUrl: z.string().min(1),
  runId: z.string().max(200).default(""),
  showId: z.string().max(200).default(""),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
}).strict().refine(value => value.fileAssetId ? value.fileAssetId === value.mediaId && value.mediaKind === "video" : Boolean(value.runId && value.showId), "媒体来源不完整");
export type CanvasMediaPayload = z.infer<typeof canvasMediaPayloadSchema>;

export function canvasMediaUrl(projectId: string, mediaId: string, fileAssetId?: string): string {
  if (fileAssetId) return `/api/files/${encodeURIComponent(fileAssetId)}/content`;
  return `/api/projects/${encodeURIComponent(projectId)}/runway/media/${encodeURIComponent(mediaId)}/content`;
}
