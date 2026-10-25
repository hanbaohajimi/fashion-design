export type Direction = "archive" | "gallery" | "relay";
export type Screen = "projects" | "workbench" | "tech";
export type Scenario =
  | "normal"
  | "loading"
  | "error"
  | "empty"
  | "long"
  | "image-error"
  | "readonly";
export type Chapter = "overview" | "measurements" | "materials" | "review";

export const directions = [
  {
    id: "archive",
    name: "织物档案",
    subtitle: "对象清楚，资料在手边",
    description: "固定项目导航，方案并排，右侧资料与助手随当前作品切换。",
    risk: "信息集中，初次使用需要辨认区域。",
    letter: "A",
  },
  {
    id: "gallery",
    name: "作品展台",
    subtitle: "先看作品，再做决定",
    description: "顶部轻导航，大图与联系表主导；编辑、资料在同一作品旁展开。",
    risk: "大图更直观，密集资料需要切换查看。",
    letter: "B",
  },
  {
    id: "relay",
    name: "任务接力",
    subtitle: "下一步始终明确",
    description:
      "按待办推进，任务列表、当前操作和对象摘要并列，跨阶段保持上下文。",
    risk: "任务路径明确，自由探索需要主动切换。",
    letter: "C",
  },
] as const;

export const projects = [
  {
    id: "commute",
    name: "秋冬通勤系列",
    season: "2026 秋冬",
    summary: "从城市通勤出发，探索宽松廓形与克制的细节。",
    image: "coat-original.png",
    count: "2 个方案 · 1 项修改待确认",
    updated: "今天 14:20",
    stage: "方案探索",
  },
  {
    id: "capsule",
    name: "轻装胶囊系列",
    season: "2027 春夏",
    summary: "轻量外套与通勤衣橱，先从现有廓形开展面料实验。",
    image: "coat-cuff.png",
    count: "2 个方案 · 待选定款式",
    updated: "昨天 16:45",
    stage: "款式筛选",
  },
  {
    id: "new",
    name: "新的设计想法",
    season: "未设季节",
    summary: "留给下一次灵感。",
    image: null,
    count: "暂无方案",
    updated: "昨天 10:10",
    stage: "尚未开始",
  },
] as const;

export const candidates = [
  {
    id: "original",
    name: "双排扣长风衣",
    image: "coat-original.png",
    revision: "探索 01",
    detail: "宽松廓形 · 翻领 · 藏蓝",
    difference: "保留原始袖袢与双排扣结构。",
  },
  {
    id: "cuff",
    name: "袖口修改版",
    image: "coat-cuff.png",
    revision: "探索 02",
    detail: "同一母图 · 袖口局部修改",
    difference: "来自同一母图的局部编辑，需放大核对袖口细节。",
  },
] as const;

export const materials = [
  {
    id: "fabric",
    name: "藏蓝棉混纺",
    detail: "面料参考 · 物性待核实",
    color: "#263950",
  },
  {
    id: "palette",
    name: "城市中性色",
    detail: "藏蓝 / 雾灰 / 暖白",
    color: "#b7b5aa",
  },
  {
    id: "brief",
    name: "秋冬通勤设计要求",
    detail: "宽松廓形，保留双排扣",
    color: "#ede7d8",
  },
] as const;

export const chapters: { id: Chapter; label: string }[] = [
  { id: "overview", label: "基本资料" },
  { id: "measurements", label: "尺寸与公差" },
  { id: "materials", label: "面料与辅料" },
  { id: "review", label: "复核与交付" },
];

export interface Trial {
  screen: Screen;
  projectId: string;
  candidateId: string;
  chapter: Chapter;
  references: string[];
  prompt: string;
  proposal: boolean;
  running: boolean;
  generated: boolean;
  compare: boolean;
  savedStyle: boolean;
  savedCandidateId: string;
  styleRevision: number;
  packTitle: string;
  length: string;
  tolerance: string;
  materialNote: string;
  savedPack: {
    title: string;
    length: string;
    tolerance: string;
    materialNote: string;
  };
  checked: boolean;
  published: boolean;
  exportState: "idle" | "ready";
  message: string;
  steps: string[];
}

export function createTrial(): Trial {
  return {
    screen: "projects",
    projectId: "commute",
    candidateId: "original",
    chapter: "overview",
    references: [],
    prompt: "",
    proposal: false,
    running: false,
    generated: false,
    compare: false,
    savedStyle: false,
    savedCandidateId: "original",
    styleRevision: 0,
    packTitle: "通勤风衣技术包",
    length: "112",
    tolerance: "1",
    materialNote: "藏蓝棉混纺；成分、克重与供应商信息待实物核实。",
    savedPack: {
      title: "通勤风衣技术包",
      length: "112",
      tolerance: "1",
      materialNote: "藏蓝棉混纺；成分、克重与供应商信息待实物核实。",
    },
    checked: false,
    published: false,
    exportState: "idle",
    message: "",
    steps: [],
  };
}

export function isDirty(trial: Trial): boolean {
  return (
    trial.packTitle !== trial.savedPack.title ||
    trial.length !== trial.savedPack.length ||
    trial.tolerance !== trial.savedPack.tolerance ||
    trial.materialNote !== trial.savedPack.materialNote
  );
}

export function assetUrl(name: string): string {
  return `/prototype-assets/impeccable/${name}`;
}
