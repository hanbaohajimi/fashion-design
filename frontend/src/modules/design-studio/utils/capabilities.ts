// 能力面板数据源 — 6 个生图能力对等定义，无线性顺序假设。
// 后端 services/design/server.py 的 TOOLS 已支持任意组合调用，本文件只描述前端 UI。

export type CapabilityId =
  | 'text_to_image'
  | 'draw_sketch'
  | 'edit_image'
  | 'transfer_pattern'
  | 'generate_model'
  | 'try_on';

export interface CapabilityDef {
  id: CapabilityId;
  /** lucide-react 图标组件名，渲染端按需映射 */
  iconName: 'Sparkles' | 'Wand2' | 'Palette' | 'Layers' | 'UserCircle' | 'Shirt';
  title: string;
  subtitle: string;
  /** 点击后填入输入框的模板 prompt（已含意图说明，AI 收到即调对应工具）*/
  promptTemplate: string;
  /** 需要哪类底图：dress=服装, model=模特, pattern=图案, []=不需要 */
  needs: Array<'dress' | 'model' | 'pattern'>;
}

export const CAPABILITIES: CapabilityDef[] = [
  {
    id: 'text_to_image',
    iconName: 'Sparkles',
    title: '文生图',
    subtitle: '描述即可生成成衣照片或概念图',
    promptTemplate: '生成一张：',
    needs: [],
  },
  {
    id: 'draw_sketch',
    iconName: 'Wand2',
    title: '设计草图',
    subtitle: '生成黑白款式线稿',
    promptTemplate: '画一张服装款式线稿：',
    needs: [],
  },
  {
    id: 'edit_image',
    iconName: 'Palette',
    title: '修改图片',
    subtitle: '对任意已有图做改色或微调',
    promptTemplate: '把这张图修改为：',
    needs: ['dress'],
  },
  {
    id: 'transfer_pattern',
    iconName: 'Layers',
    title: '图案迁移',
    subtitle: '把花纹 / Logo 应用到服装',
    promptTemplate: '把图案迁移到服装上：',
    needs: ['dress', 'pattern'],
  },
  {
    id: 'generate_model',
    iconName: 'UserCircle',
    title: '生成模特',
    subtitle: '男 / 女模特展示图',
    promptTemplate: '生成一位模特：',
    needs: [],
  },
  {
    id: 'try_on',
    iconName: 'Shirt',
    title: '虚拟试穿',
    subtitle: '服装 + 模特合成展示',
    promptTemplate: '把服装穿到模特身上展示。',
    needs: ['dress', 'model'],
  },
];

/** Session 当前可用的图像资源 — 用于资源雷达决定哪些能力可一键直接用 */
export interface SessionResources {
  /** 是否有已生成或上传的服装类图片（text_to_image / draw_sketch / edit_image / transfer_pattern / try_on 产出皆算）*/
  hasDress: boolean;
  /** 是否有已生成的模特图（generate_model 产出）*/
  hasModel: boolean;
  /** 是否有用户上传或参考的图案图（来自 attachedAssets）*/
  hasPattern: boolean;
}

export interface CapabilityHint {
  /** 能力是否「资源齐全可一键启动」 */
  ready: boolean;
  /** 缺什么资源（用于按钮 tooltip / picker 引导）*/
  missing: Array<'dress' | 'model' | 'pattern'>;
}

/** 资源雷达 — 替代旧 getContextSuggestions 的线性「下一步」逻辑。
 *  返回每个能力的 ready 状态，UI 据此高亮按钮，但不再注入 prompt 文字。 */
export function getCapabilityHints(state: SessionResources): Record<CapabilityId, CapabilityHint> {
  const hints = {} as Record<CapabilityId, CapabilityHint>;
  for (const cap of CAPABILITIES) {
    const missing = cap.needs.filter((n) => {
      if (n === 'dress') return !state.hasDress;
      if (n === 'model') return !state.hasModel;
      if (n === 'pattern') return !state.hasPattern;
      return false;
    });
    hints[cap.id] = { ready: missing.length === 0, missing };
  }
  return hints;
}

/** 给定 session 内所有图片的 type 列表，推断当前可用资源。
 *  类型来自后端 tool 调用 image_type 标记（services/design/server.py 各 tool 函数 `record_image` 调用处）。 */
export function deriveResourcesFromImages(imageTypes: string[], hasUploadedPattern: boolean): SessionResources {
  const dressTypes = new Set(['text_to_image', 'draw_sketch', 'edit_image', 'transfer_pattern', 'try_on']);
  return {
    hasDress: imageTypes.some((t) => dressTypes.has(t)),
    hasModel: imageTypes.includes('generate_model'),
    hasPattern: hasUploadedPattern,
  };
}
