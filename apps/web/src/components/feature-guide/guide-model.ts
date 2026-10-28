export const GUIDE_SURFACES = ["projects", "workspace", "studio", "fabrics", "trends"] as const;
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
      { id: "views", anchors: ["workspace-views"], title: "作品与流程，两种查看方式", description: "设计工作台集中展示作品；流程画布可以查看工具、连接和参数。切换视图会保留当前项目。" },
      { id: "materials", anchors: ["workspace-materials"], title: "把创作参考放在这里", description: "从这里添加图片、面料等参考资料。素材保留在项目中，可以用于后续讨论和设计。" },
      { id: "assistant", anchors: ["workspace-assistant"], title: "和设计助手讨论想法", description: "在这里描述设计想法。助手会先整理需求，生成前再请你确认。" },
      { id: "reference", anchors: ["workspace-reference"], title: "明确告诉助手参考什么", description: "添加本次讨论要引用的作品或资料。选中作品与引用给助手是两个独立动作。" },
      { id: "tasks", anchors: ["project-tasks"], title: "在这里查看项目任务", description: "生成、导出等任务的进展集中在这里。可以查看真实状态、失败原因和当前可用的处理操作。" },
    ],
  },
  studio: {
    surface: "studio",
    steps: [
      { id: "navigation", anchors: ["studio-navigation"], title: "按需要切换功能", description: "款式、色料实验、技术包和展示等功能都在这个目录中。按当前工作需要选择，不必依次完成。" },
      { id: "object", anchors: ["studio-object"], title: "确认正在查看的资料", description: "这里显示当前功能或资料的名称与说明，先确认当前内容，再继续操作。" },
      { id: "actions", anchors: ["studio-actions"], title: "留意保存与提交状态", description: "当前页面的保存或提交操作在这里。修改后查看状态提示，本机暂存与正式保存是不同的状态。" },
    ],
  },
  fabrics: {
    surface: "fabrics",
    steps: [
      { id: "filters", anchors: ["fabrics-filters"], title: "找到合适的面料参考", description: "展开规格筛选，可按分类、成分、供应商和克重缩小范围。搜索框还可查名称、标签或编号。" },
      { id: "preview", anchors: ["fabrics-preview"], title: "先看面料，再看资料", description: "从这里查看面料图片和档案。图片与 AI 描述用于设计参考，实际物性和色准仍需核对实物。" },
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
  if (surface === "workspace" && step.id === "assistant") {
    let description = step.description;
    switch (metadata.variant) {
      case "collapsed":
        description = "点击“设计助手”展开对话区，再描述你的设计想法。";
        break;
      case "mobile":
        description = "切换到“助手”视图，即可查看对话和输入设计需求。";
        break;
      case "history":
        description = "当前为只读历史，可查看已有消息。使用顶部“新建对话”继续设计。";
        break;
      case "paused":
        description = "本项目设计助手已暂停，当前可查看历史。在顶部“助手设置”中选择“恢复设计助手”后继续讨论。";
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
  if (pathname === "/") return "projects";
  if (pathname === "/fabrics") return "fabrics";
  if (pathname === "/trends") return "trends";
  if (/^\/(?:login|auth|share|prototypes)(?:\/|$)/u.test(pathname)) return null;
  if (/^\/[^/]+\/studio\/?$/u.test(pathname)) return "studio";
  if (/^\/[^/]+\/?$/u.test(pathname)) return "workspace";
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
