export type PaintingId = "dusk" | "willow" | "irises";
export type TaskOperation =
  "generate" | "edit" | "color" | "material" | "print" | "analysis" | "export";

export const PAINTING_MEDIA = Object.fromEntries(
  ["dusk", "willow", "irises"].map((id) => [
    id,
    {
      poster: `/painting-loaders/${id}.webp`,
      webm: `/painting-loaders/${id}.webm`,
      mp4: `/painting-loaders/${id}.mp4`,
      width: 480,
      height: 480,
    },
  ]),
) as Record<
  PaintingId,
  { poster: string; webm: string; mp4: string; width: number; height: number }
>;

export function paintingFor(operation: TaskOperation): PaintingId {
  return operation === "material"
    ? "willow"
    : operation === "print"
      ? "irises"
      : "dusk";
}
