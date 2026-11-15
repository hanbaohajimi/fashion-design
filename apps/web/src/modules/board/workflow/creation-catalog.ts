import type { CanvasCreationModule } from "@fashion/shared";
import { imageToolEntries, type ImageToolEntry } from "./image-tool-entry";

export const creationCatalog: readonly { id: string; title: string; description: string; category: string; module: CanvasCreationModule; mode?: "color" | "material" | "detail" | "presentation"; imageAction?: ImageToolEntry }[] = [
  { id: "image", title: "图片创作", description: "输入要求，连接参考，生成新作品", category: "图片", module: "image" },
  { id: "color", title: "换色实验", description: "围绕同一设计比较配色方案", category: "实验", module: "experiments", mode: "color" },
  { id: "material", title: "换面料", description: "选择真实面料，比较材质效果", category: "实验", module: "experiments", mode: "material" },
  { id: "detail", title: "改款实验", description: "探索领型、细节与版型变化", category: "实验", module: "experiments", mode: "detail" },
  { id: "patterns", title: "印花工作台", description: "设计印花、排布与重复图案", category: "工作台", module: "patterns" },
  { id: "presentation", title: "商品展示", description: "创建展示图与展示包", category: "工作台", module: "presentation" },
  { id: "collections", title: "系列工作台", description: "定义设计方向、安排款式规划与扩展系列", category: "工作台", module: "collections" },
  { id: "trends", title: "时尚趋势", description: "查阅趋势，保留资料来源", category: "研究", module: "trends" },
  ...imageToolEntries.map((entry) => ({ id: `image-${entry.action}`, title: entry.label, description: "选择图片，打开对应编辑界面", category: "图片", module: "image" as const, imageAction: entry.action })),
];
