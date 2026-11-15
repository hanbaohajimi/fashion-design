export type CanvasProjectPanel =
  | "tech"
  | "samples"
  | "team"
  | "planning"
  | "brand"
  | "realtime"
  | "runway"
  | "wardrobe"
  | "styles";

export interface CanvasProjectEntry {
  assetId?: string | undefined;
  styleRevisionId?: string | undefined;
}

export interface CanvasProjectFunction {
  id: string;
  title: string;
  description: string;
  category: string;
  panel?: CanvasProjectPanel;
  disabled?: boolean;
}

export const canvasProjectFunctions: readonly CanvasProjectFunction[] = [
  {
    id: "project-wardrobe",
    title: "衣橱",
    description: "查看当前项目的服装单品与搭配",
    category: "项目资料",
    panel: "wardrobe",
  },
  {
    id: "project-realtime",
    title: "实时试穿",
    description: "使用项目中的服装进行实时试穿",
    category: "工作台",
    panel: "realtime",
  },
  {
    id: "project-runway",
    title: "服装秀",
    description: "编排当前项目的服装秀",
    category: "工作台",
    panel: "runway",
  },
  {
    id: "project-styles",
    title: "款式档案",
    description: "查看项目款式与修订",
    category: "项目资料",
    panel: "styles",
  },
  {
    id: "project-tech",
    title: "技术包",
    description: "编辑项目技术包与交付文档",
    category: "交付与评审",
    panel: "tech",
  },
  {
    id: "project-samples",
    title: "样衣反馈",
    description: "记录样衣轮次与修改意见",
    category: "交付与评审",
    panel: "samples",
  },
  {
    id: "project-team",
    title: "团队评审",
    description: "查看评审与处理反馈",
    category: "交付与评审",
    panel: "team",
  },
  {
    id: "project-brand",
    title: "品牌资料",
    description: "维护当前项目使用的品牌资料",
    category: "项目资料",
    panel: "brand",
  },
  {
    id: "project-files",
    title: "生成文件",
    description: "查找项目生成的图片、视频和交付文件",
    category: "项目资料",
  },
  {
    id: "project-rename",
    title: "重命名项目",
    description: "修改当前项目名称",
    category: "项目管理",
  },
  {
    id: "project-tasks",
    title: "项目任务",
    description: "查看进行中任务、待处理事项和历史记录",
    category: "项目管理",
  },
  {
    id: "canvas-export",
    title: "导出画布 PNG",
    description: "导出当前画布中的可见作品",
    category: "画布管理",
  },
  {
    id: "canvas-legacy",
    title: "历史白板",
    description: "查看项目原有白板记录",
    category: "画布管理",
  },
  {
    id: "canvas-help",
    title: "画布操作说明",
    description: "查看画布操作与快捷键",
    category: "画布管理",
  },
];
