import { canvasMediaPayloadSchema, canvasMediaUrl } from "@fashion/shared";
import type { WorkflowNode } from "./workflow-api";

export function projectCanvasMedia(node: WorkflowNode, projectId: string) {
  if (node.type !== "media") return null;
  const result = canvasMediaPayloadSchema.safeParse(node.payload);
  if (!result.success) return null;
  const media = result.data;
  if (media.mediaUrl !== canvasMediaUrl(projectId, media.mediaId)) return null;
  const compact = typeof window !== "undefined" && window.innerWidth < 768;
  const ratio = media.width && media.height ? media.width / media.height : 16 / 9;
  const maxWidth = compact ? 280 : 360;
  const w = media.mediaKind === "audio" ? (compact ? 280 : 340) : ratio < 1 ? Math.max(160, Math.round((compact ? 280 : 320) * ratio)) : maxWidth;
  const h = media.mediaKind === "audio" ? 164 : (compact ? 220 : Math.max(140, Math.min(320, Math.round(w / ratio)))) + 104;
  return {
    type: "fashion-media" as const,
    props: { w, h, title: node.title, mediaId: media.mediaId, mediaKind: media.mediaKind, mediaUrl: media.mediaUrl,
      durationMs: media.durationMs ?? 0,
      sourceHref: `/${encodeURIComponent(projectId)}/studio?tab=runway&showId=${encodeURIComponent(media.showId)}&runId=${encodeURIComponent(media.runId)}` },
  };
}

export function mediaDuration(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  const seconds = Math.round(value / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
