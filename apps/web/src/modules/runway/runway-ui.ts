import type {
  RunwayMediaView,
  RunwayRunView,
  RunwayStage,
  RunwayStatus,
} from "@fashion/shared";

export const RUNWAY_STAGE_LABELS: Record<RunwayStage, string> = {
  prepare: "模特、服装与背景",
  pairing: "模特与服装配对",
  tryon: "试衣核对",
  storyboard: "秀场分镜",
  video: "视频镜头",
  compose: "成片拼接",
  music: "背景音乐",
  finished: "成片与历史",
};
export const RUNWAY_STATUS_LABELS: Record<RunwayStatus, string> = {
  QUEUED: "等待执行",
  RUNNING: "正在制作",
  WAITING_INPUT: "等待你的确认",
  SUCCEEDED: "制作完成",
  FAILED: "制作失败",
  NEEDS_ATTENTION: "需要确认执行结果",
  CANCELED: "已停止后续制作",
};
export const RUNWAY_SECTIONS = [
  { label: "需求与素材", stages: ["prepare"] },
  { label: "模特与服装", stages: ["pairing"] },
  { label: "试衣与分镜", stages: ["tryon", "storyboard"] },
  { label: "视频镜头", stages: ["video"] },
  { label: "配乐与成片", stages: ["compose", "music"] },
  { label: "成果与历史", stages: ["finished"] },
] as const;
export function stageMedia(
  run: RunwayRunView,
  kind: RunwayMediaView["kind"],
): RunwayMediaView[] {
  const byStage = run.state.mediaByStage;
  const ids =
    byStage && typeof byStage === "object"
      ? (byStage as Record<string, unknown>)[kind]
      : undefined;
  return Array.isArray(ids)
    ? ids.flatMap((id) => {
        if (typeof id !== "string") return [];
        const media = run.media.find(
          (item) => item.id === id && item.kind === kind,
        );
        return media ? [media] : [];
      })
    : run.media.filter((media) => media.kind === kind);
}
export function formatRunwayDuration(durationMs: number | null) {
  if (durationMs === null) return "";
  const seconds = Math.round(durationMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
