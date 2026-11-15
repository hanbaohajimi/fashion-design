import { workspaceRoute } from "../../modules/workspace-route";
export const GUIDE_SURFACES = ["home", "assets", "projects", "workspace", "studio", "fabrics", "trends"] as const;
export type GuideSurface = typeof GUIDE_SURFACES[number];
export type GuideStatus = "viewed" | "skipped" | "completed";

export interface GuideStep {
  readonly id: string;
  readonly anchors: readonly string[];
  readonly title: string;
  readonly description: string;
}

export interface GuideDefinition {
  readonly surface: GuideSurface;
  readonly steps: readonly GuideStep[];
}

export interface ResolvedGuideStep extends GuideStep {
  readonly target: HTMLElement;
}

export const GUIDE_DEFINITIONS: Record<GuideSurface, GuideDefinition> = {
  home: {
    surface: "home",
    steps: [
      { id: "create", anchors: ["home-create"], title: "从空白画布开始", description: "点击后创建一个未命名项目，直接进入独立画布。可以在画布底部的“全部功能”中修改项目名称。" },
      { id: "shortcuts", anchors: ["home-shortcuts"], title: "用一个功能开始新项目", description: "点击色料实验、印花、展示或试穿等入口，会直接创建新项目，进入画布并展开对应功能。关闭后可以继续这张画布。已有项目从下方项目卡片打开。" },
      { id: "recent", anchors: ["home-recent"], title: "继续最近的设计", description: "这里显示最近更新的项目。点击进入画布，查看全部可管理、搜索和归档项目。" },
    ],
  },
  assets: {
    surface: "assets",
    steps: [
      { id: "filters", anchors: ["assets-filters"], title: "跨项目查找创作文件", description: "按图片、视频、音频和文档浏览，也可以搜索名称或筛选生成、上传与交付文件。" },
      { id: "rating", anchors: ["assets-rating"], title: "用星级整理自己的资产", description: "在卡片或预览中设置个人评级，再按评级筛选或排序。你的评级不会改变其他成员的选择。" },
    ],
  },
  projects: {
    surface: "projects",
    steps: [
      { id: "navigation", anchors: ["projects-navigation"], title: "从这里找到各个工作区", description: "项目库收纳你的设计项目，面料库和趋势档案提供创作参考。进入项目后，还能打开设计工作台与款式资料。" },
      { id: "create", anchors: ["projects-create"], title: "为设计创建一个项目", description: "一个项目可以集中保存参考素材、设计想法和生成方案。在这里新建，之后可以随时重命名。" },
      { id: "search", anchors: ["projects-search"], title: "找回之前的设计", description: "按项目名称搜索，或切换进行中与已归档项目。归档的项目仍可恢复。" },
      { id: "help", anchors: ["guide-help"], title: "随时重新查看指引", description: "打开账号菜单，选择“功能指引”，就能再次查看当前页面的功能介绍。" },
    ],
  },
  workspace: {
    surface: "workspace",
    steps: [
      { id: "connections", anchors: ["workspace-connections"], title: "在同一画布连接创作", description: "连接素材与创作目标，准备本次输入。这个开关只隐藏连线和端口，素材位置、草稿和输入都会保留；点击生成才会执行。" },
      { id: "functions", anchors: ["workspace-functions"], title: "从全部功能开始", description: "创作工具、衣橱、交付评审与项目资料集中在这里，也可以查看项目任务、生成文件或导出画布。有选中的图片时，图片工具使用该图片作为输入。" },
      { id: "creation", anchors: ["workspace-creation"], title: "选择参考，写下要求", description: "单击图片即可打开创作框。上传或引用素材，输入本次要求，再点击生成或按 Ctrl+Enter。系统不自动添加用途权重或额外提示词。" },
      { id: "materials", anchors: ["workspace-materials"], title: "把创作参考放在这里", description: "从这里添加图片、面料等参考资料。素材保留在项目中，可以用于后续讨论和设计。" },
      { id: "assistant", anchors: ["workspace-assistant"], title: "和设计助手一起创作", description: "描述想法，或点击麦克风说出需求，再次点击结束，核对草稿后发送。浮窗与右侧停靠切换时保留草稿和引用。" },
      { id: "reference", anchors: ["workspace-reference"], title: "添加本次创作的参考", description: "点击加号或输入 @ 添加素材。悬停缩略图查看大图，双击定位，点击角上的 @ 插入图号；手机点击查看。普通选择不会自动加入引用。" },
    ],
  },
  studio: {
    surface: "studio",
    steps: [
      { id: "navigation", anchors: ["studio-navigation"], title: "返回项目画布", description: "返回画布继续创作，也可以从底部“全部功能”打开项目的其他工具与资料。离开前会检查未保存的修改。" },
      { id: "object", anchors: ["studio-object"], title: "确认正在查看的资料", description: "这里显示当前功能或资料的名称与说明，先确认当前内容，再继续操作。" },
      { id: "actions", anchors: ["studio-actions"], title: "留意保存与提交状态", description: "当前页面的保存或提交操作在这里。修改后查看状态提示，本机暂存与正式保存是不同的状态。" },
    ],
  },
  fabrics: {
    surface: "fabrics",
    steps: [
      { id: "filters", anchors: ["fabrics-filters"], title: "找到合适的面料参考", description: "展开规格筛选，可按分类、成分、供应商和克重缩小范围。搜索框还可查名称、标签或编号。" },
      { id: "preview", anchors: ["fabrics-preview"], title: "点击翻面，查看面料规格", description: "点击面料图片翻到背面，查看核心规格；再次点击卡片可返回图片，完整资料在背面的“完整档案”中查看。图片与 AI 描述用于设计参考，实际物性和色准仍需核对实物。" },
      { id: "add", anchors: ["fabrics-add"], title: "把面料加入当前项目", description: "通过这个入口把面料作为项目参考。加入后可回到工作台，在讨论设计时引用。" },
    ],
  },
  trends: {
    surface: "trends",
    steps: [
      { id: "filters", anchors: ["trends-filters"], title: "按主题寻找设计线索", description: "搜索标题、摘要或关键词，也可以按主题查看趋势资料。" },
      { id: "preview", anchors: ["trends-preview"], title: "摘要与原始来源一起看", description: "摘要帮助快速浏览，来源用于进一步核对。趋势资料保留原始链接和已知日期。" },
      { id: "add", anchors: ["trends-add"], title: "把趋势留作项目参考", description: "从这里选择存入位置，将趋势摘要、代表图与配色加入项目工作流。加入后的资料仍保留来源，可供后续讨论引用。" },
    ],
  },
};

export function guideStepCopy(
  surface: GuideSurface,
  step: GuideStep,
  metadata: {
    readonly variant?: string | undefined;
    readonly moduleName?: string | undefined;
    readonly hasObjectSwitcher: boolean;
    readonly hasRevision: boolean;
  },
): Pick<GuideStep, "title" | "description"> {
  if (step.id === "navigation" && metadata.variant === "collapsed") {
    return { title: step.title, description: "点击这里展开目录，访问项目、资产库、衣橱、面料库和发现。项目工具集中在画布底部的“全部功能”中。" };
  }
  if (surface === "workspace" && step.id === "assistant") {
    let description = step.description;
    switch (metadata.variant) {
      case "collapsed":
        description = "点击画布中的织芽或助手入口展开对话，再描述你的设计想法。";
        break;
      case "mobile":
        description = "从画布中的织芽进入对话；完成后可返回画布继续创作。";
        break;
      case "history":
        description = "当前为只读历史，可查看已有消息。使用顶部“新建对话”继续设计。";
        break;
      case "paused":
        description = "本项目设计助手已暂停，当前可查看历史。点击输入区的“恢复设计助手”继续讨论。";
        break;
    }
    return { title: step.title, description };
  }
  if (surface === "studio" && step.id === "object") {
    return {
      title: metadata.moduleName ? `当前功能：${metadata.moduleName}` : step.title,
      description: [
        step.description,
        metadata.hasObjectSwitcher ? "从这里切换要查看的资料。" : "",
        metadata.hasRevision ? "修订号对应一次已保存的版本。" : "",
      ].filter(Boolean).join(""),
    };
  }
  return { title: step.title, description: step.description };
}

export function guideSurfaceForPath(pathname: string): GuideSurface | null {
  if (pathname === "/") return "home";
  if (pathname === "/projects") return "projects";
  if (pathname === "/assets") return "assets";
  if (pathname === "/fabrics") return "fabrics";
  if (pathname === "/trends") return "trends";
  if (/^\/(?:login|auth|share|prototypes)(?:\/|$)/u.test(pathname)) return null;
  const route = workspaceRoute(pathname);
  if (route.studio) return "studio";
  if (route.canvas) return "workspace";
  return null;
}

export function guideStorageKey(accountId: string, surface: GuideSurface): string {
  return `fashion:feature-guide:v1:${accountId}:${surface}`;
}

/** Also retains the preference when browser storage is unavailable. */
export class GuidePreferences {
  private readonly memory = new Map<string, GuideStatus>();
  private readonly volatile = new Set<string>();

  read(accountId: string, surface: GuideSurface): GuideStatus | null {
    const key = guideStorageKey(accountId, surface);
    if (this.volatile.has(key)) return this.memory.get(key) ?? null;
    try {
      const value = localStorage.getItem(key);
      if (value === "viewed" || value === "skipped" || value === "completed") {
        this.memory.set(key, value);
        return value;
      }
    } catch { /* In-memory preferences remain available. */ }
    return this.memory.get(key) ?? null;
  }

  write(accountId: string, surface: GuideSurface, status: GuideStatus): void {
    const key = guideStorageKey(accountId, surface);
    this.memory.set(key, status);
    try { localStorage.setItem(key, status); this.volatile.delete(key); }
    catch { this.volatile.add(key); }
  }
}
