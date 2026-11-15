import { STUDIO_GROUPS, type StudioTab } from "../studio/studio-navigation";

export type ProjectDestination = "canvas" | StudioTab | "wardrobe" | "realtime";
const GROUP_NAMES = {
  创作: { id: "creation", label: "创作工具" },
  交付: { id: "delivery", label: "交付管理" },
  资料: { id: "reference", label: "项目资料" },
};
export const WORKSPACE_TOOL_GROUPS = STUDIO_GROUPS.map((group) => ({
  ...GROUP_NAMES[group.label],
  items: [
    ...(group.label === "创作"
      ? [{ value: "canvas" as const, label: "画布创作" }]
      : []),
    ...group.items,
  ],
}));
export const HOME_SHORTCUTS = [
  { value: "experiments", label: "色料实验", canvasEntry: "color" },
  { value: "patterns", label: "印花工作台", canvasEntry: "patterns" },
  { value: "presentation", label: "商品展示", canvasEntry: "presentation" },
  { value: "wardrobe", label: "衣橱", canvasEntry: "project-wardrobe" },
  { value: "realtime", label: "实时试穿", canvasEntry: "project-realtime" },
  { value: "runway", label: "服装秀", canvasEntry: "project-runway" },
] as const;
export type HomeShortcut = (typeof HOME_SHORTCUTS)[number]["value"];
export function homeShortcut(value: string | null) {
  return HOME_SHORTCUTS.find(item => item.value === value) ?? null;
}
export function canvasShortcutHref(projectId: string, shortcut: HomeShortcut) {
  return `/${encodeURIComponent(projectId)}?openTool=${shortcut}`;
}
export function projectDestinationHref(
  projectId: string,
  destination: ProjectDestination,
) {
  const base = `/${encodeURIComponent(projectId)}`;
  if (destination === "canvas") return base;
  if (destination === "wardrobe") return `/wardrobe?projectId=${encodeURIComponent(projectId)}`;
  if (destination === "realtime")
    return `${base}/studio?tab=presentation&mode=${destination}`;
  return `${base}/studio?tab=${destination}`;
}
export function destinationLabel(destination: ProjectDestination) {
  return (
    [
      ...HOME_SHORTCUTS,
      ...WORKSPACE_TOOL_GROUPS.flatMap((group) => group.items),
    ].find((item) => item.value === destination)?.label ?? "画布创作"
  );
}
