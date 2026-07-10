// 能力面板数据源 — 6 个生图能力，按创作阶段分组。
// 后端 services/design/server.py 的 TOOLS 已支持任意组合调用，本文件只描述前端 UI。
// IMPORTANT: id / needs / promptTemplate 不能修改 — 后端 NLP 路由依赖这些字段。

export type CapabilityId =
  | 'text_to_image'
  | 'draw_sketch'
  | 'edit_image'
  | 'transfer_pattern'
  | 'generate_model'
  | 'try_on';

export type CapabilityGroup = 'create' | 'edit' | 'showcase';

export interface CapabilityDef {
  id: CapabilityId;
  /** lucide-react 图标组件名，渲染端按需映射 */
  iconName: 'Sparkles' | 'Wand2' | 'Palette' | 'Layers' | 'UserCircle' | 'Shirt';
  /** 原始 UI 标题（保留兼容性） */
  title: string;
  /** 用户友好的操作式标题（goal.txt 规范）*/
  displayTitle: string;
  /** 分组标题内简短描述 */
  subtitle: string;
  /** 能力详情描述 */
  description: string;
  /** 点击后填入输入框的模板 prompt（已含意图说明，AI 收到即调对应工具）*/
  promptTemplate: string;
  /** Composer 输入框 placeholder */
  placeholder: string;
  /** 发送按钮旁辅助文案 */
  submitLabel: string;
  /** 画布空状态提示文字（当此能力被选中时显示）*/
  emptyStateText: string;
  /** 需要哪类底图：dress=服装, model=模特, pattern=图案, []=不需要 */
  needs: Array<'dress' | 'model' | 'pattern'>;
  /** 需要的素材说明（用于 blocked 状态提示）*/
  requiredMaterialsText: string;
  /** 所属创作阶段分组 */
  group: CapabilityGroup;
}

export const CAPABILITIES: CapabilityDef[] = [
  {
    id: 'text_to_image',
    iconName: 'Sparkles',
    title: '文生图',
    displayTitle: '生成成衣效果图',
    subtitle: '描述即可生成完整服装效果图',
    description: '根据文字描述生成完整服装或成衣效果图',
    promptTemplate: '生成一张：',
    placeholder: '描述服装类型、风格、颜色、面料和使用场景……',
    submitLabel: '生成效果图',
    emptyStateText: '在右侧描述想设计的服装，\n生成结果将自动出现在这里。',
    needs: [],
    requiredMaterialsText: '',
    group: 'create',
  },
  {
    id: 'draw_sketch',
    iconName: 'Wand2',
    title: '设计草图',
    displayTitle: '生成设计草图',
    subtitle: '生成黑白或专业款式线稿',
    description: '根据设计描述生成黑白或专业服装款式草图',
    promptTemplate: '画一张服装款式线稿：',
    placeholder: '描述服装廓形、结构、剪裁和设计细节……',
    submitLabel: '生成草图',
    emptyStateText: '描述服装结构和设计细节，\n生成的草图将出现在画布中。',
    needs: [],
    requiredMaterialsText: '',
    group: 'create',
  },
  {
    id: 'edit_image',
    iconName: 'Palette',
    title: '修改图片',
    displayTitle: '编辑已有图片',
    subtitle: '修改颜色、面料、版型或细节',
    description: '修改当前服装图片的颜色、面料、版型或细节',
    promptTemplate: '把这张图修改为：',
    placeholder: '描述需要修改的内容，例如更换颜色、面料或版型……',
    submitLabel: '应用修改',
    emptyStateText: '拖入一张服装图片，或点击上传图片开始。',
    needs: ['dress'],
    requiredMaterialsText: '需要一张已上传或已在画布中选中的服装图片',
    group: 'edit',
  },
  {
    id: 'transfer_pattern',
    iconName: 'Layers',
    title: '图案迁移',
    displayTitle: '将图案应用到服装',
    subtitle: '把花纹、Logo 应用到服装图片',
    description: '把花纹、Logo 或图案应用到服装图片上',
    promptTemplate: '把图案迁移到服装上：',
    placeholder: '描述图案在服装上的位置、大小和排列方式……',
    submitLabel: '应用图案',
    emptyStateText: '先添加服装图片和图案图片。',
    needs: ['dress', 'pattern'],
    requiredMaterialsText: '需要一张服装图片和一张图案图片',
    group: 'edit',
  },
  {
    id: 'generate_model',
    iconName: 'UserCircle',
    title: '生成模特',
    displayTitle: '生成模特形象',
    subtitle: '根据文字生成独立模特图',
    description: '根据文字描述生成独立模特形象图。不会自动使用当前服装图片，请在描述中说明服装特征。',
    promptTemplate: '生成一位模特：',
    placeholder: '描述模特性别、体型、姿势、服装特征、背景和风格……',
    submitLabel: '生成模特形象',
    emptyStateText: '描述想要的模特风格和服装特征，\n生成的模特图将出现在画布中。',
    needs: [],
    requiredMaterialsText: '',
    group: 'showcase',
  },
  {
    id: 'try_on',
    iconName: 'Shirt',
    title: '虚拟试穿',
    displayTitle: '虚拟试穿',
    subtitle: '将服装穿到指定人物身上',
    description: '将服装穿到指定人物或模特身上',
    promptTemplate: '把服装穿到模特身上展示。',
    placeholder: '描述试穿效果、搭配方式或需要保留的细节……',
    submitLabel: '开始虚拟试穿',
    emptyStateText: '先添加人物图片和服装图片。',
    needs: ['dress', 'model'],
    requiredMaterialsText: '需要一张人物图片和一张服装图片',
    group: 'showcase',
  },
];

export const CAPABILITY_GROUPS: Array<{
  id: CapabilityGroup;
  label: string;
  capabilityIds: CapabilityId[];
}> = [
  {
    id: 'create',
    label: '从零开始',
    capabilityIds: ['text_to_image', 'draw_sketch'],
  },
  {
    id: 'edit',
    label: '基于现有图片',
    capabilityIds: ['edit_image', 'transfer_pattern'],
  },
  {
    id: 'showcase',
    label: '展示与试穿',
    capabilityIds: ['generate_model', 'try_on'],
  },
];

/** 默认能力 */
export const DEFAULT_CAPABILITY_ID: CapabilityId = 'text_to_image';

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

/** 资源雷达 — 返回每个能力的 ready 状态，UI 据此高亮按钮。 */
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

/** 给定能力 id，返回该能力定义（找不到返回 undefined）*/
export function getCapabilityById(id: CapabilityId): CapabilityDef | undefined {
  return CAPABILITIES.find((c) => c.id === id);
}

/** 每个能力对应的、发送给 LLM 时使用的明确任务指令前缀。
 *  后端纯 LLM routing，没有 capability_id 字段，此前缀确保 LLM 能稳定路由到正确工具。 */
const CAPABILITY_LLM_INSTRUCTION: Record<CapabilityId, string> = {
  text_to_image: '请生成一张服装或成衣效果图（调用 text_to_image 工具）。',
  draw_sketch: '请绘制一张服装款式线稿（调用 draw_sketch 工具）。',
  edit_image: '请编辑/修改现有服装图片（调用 edit_image 工具）。',
  transfer_pattern: '请将图案迁移到服装上（调用 transfer_pattern 工具）。',
  generate_model: '请生成一张模特展示图（调用 generate_model 工具）。',
  try_on: '请将服装穿到模特身上进行虚拟试穿（调用 try_on 工具）。',
};

/** 角色标签对应的中文描述，用于拼入消息让 LLM 识别各图片的用途 */
const ROLE_LABEL_ZH: Record<string, string> = {
  dress: '服装图',
  pattern: '图案图',
  model: '人物/模特图',
  reference: '参考图',
};

export interface AttachedImageInfo {
  /** 1-based 编号，与后端 assets_context_block「第N张」一致 */
  index: number;
  role?: 'dress' | 'pattern' | 'model' | 'reference';
  displayName?: string;
  /** 来自画布的参考图（pendingFromCanvas） */
  isCanvasRef?: boolean;
}

/**
 * 构造发送给后端的最终消息文本。
 *
 * 规则：
 * 1. 总是在开头附加能力任务指令前缀，让 LLM 稳定路由到正确工具。
 * 2. 如果有带 role 的图片，在前缀中用中文说明哪张图是什么角色，
 *    以便 LLM 能正确把路径填入 target_dress_path / pattern_ref_path / model_path 等参数。
 * 3. 如果用户输入非空，拼在最后；如果为空，省略（工具调用不依赖用户文本）。
 */
export function buildCapabilityMessage(
  capabilityId: CapabilityId,
  userText: string,
  attachedImages: AttachedImageInfo[],
): string {
  const instruction = CAPABILITY_LLM_INSTRUCTION[capabilityId];
  const lines: string[] = [instruction];

  // 对有 role 的图片，逐一说明用途
  const namedImages = attachedImages.filter(img => img.role && img.role !== 'reference');
  if (namedImages.length > 0) {
    for (const img of namedImages) {
      const roleZh = img.role ? (ROLE_LABEL_ZH[img.role] ?? img.role) : '';
      const label = img.isCanvasRef ? '画布图片' : (img.displayName || `第${img.index}张图`);
      lines.push(`${roleZh}：${label}（第${img.index}张）`);
    }
  }

  if (userText.trim()) {
    lines.push(userText.trim());
  }

  return lines.join('\n');
}
