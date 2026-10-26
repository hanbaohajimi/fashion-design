/** Existing URL values are a public navigation contract. */
export const STUDIO_GROUPS = [
  {
    label: "创作",
    items: [
      { value: "tasks", label: "开始任务" },
      { value: "styles", label: "款式档案" },
      { value: "experiments", label: "色料实验" },
      { value: "patterns", label: "印花工作台" },
      { value: "presentation", label: "商品展示" },
      { value: "runway", label: "服装秀" },
    ],
  },
  {
    label: "交付",
    items: [
      { value: "planning", label: "系列规划" },
      { value: "tech", label: "技术包" },
      { value: "samples", label: "样衣反馈" },
      { value: "team", label: "团队评审" },
    ],
  },
  {
    label: "资料",
    items: [
      { value: "trends", label: "趋势简报" },
      { value: "brand", label: "品牌资料" },
    ],
  },
] as const;

export const STUDIO_TABS = STUDIO_GROUPS.flatMap((group) => [...group.items]);
export type StudioTab = (typeof STUDIO_TABS)[number]["value"];
export function isStudioTab(value: string | undefined): value is StudioTab {
  return STUDIO_TABS.some((item) => item.value === value);
}
