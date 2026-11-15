import { z } from "zod";
import { imageTransformSchema, imageOutpaintSchema } from "./image-workspace";
import { imageTextEditsSchema } from "./image-text";
import type { WorkflowConnectionPort } from "./workflow-connections";

export const WORKFLOW_TOOL_KEYS = ["analyze_brief", "generate_text", "generate_design", "evaluate_design", "edit_design", "transform_image"] as const;
export const workflowToolKeySchema = z.enum(WORKFLOW_TOOL_KEYS);
export type WorkflowToolKey = z.infer<typeof workflowToolKeySchema>;
// Legacy keys remain parseable for persisted history and already-submitted executions.
export const ACTIVE_WORKFLOW_TOOL_KEYS = ["generate_text", "generate_design", "edit_design", "transform_image"] as const;
export const activeWorkflowToolKeySchema = z.enum(ACTIVE_WORKFLOW_TOOL_KEYS);
export function isRetiredWorkflowTool(key: string) { return key === "analyze_brief" || key === "evaluate_design"; }
export const WORKFLOW_TOOL_VERSION = "1" as const;
const localId = z.string().trim().min(1).max(128).regex(/^[\p{L}\p{N}_.-]+$/u, "只能引用实际资产或节点编号，不能使用网址或路径");
export const workflowReferenceParameterSchema = z.object({
  nodeId: localId,
});
export const workflowMaskParameterSchema = z.object({ assetId: localId.optional(), fileAssetId: localId.optional() }).strict().refine(
  (value) => Boolean(value.assetId) !== Boolean(value.fileAssetId), "蒙版必须且只能引用一个实际 assetId 或 fileAssetId",
);
const promptSchema = z.string().trim().min(1).max(4_000).describe("本次工具的具体任务及保留要求");
const commonGenerationShape = {
  prompt: promptSchema,
  negativePrompt: z.string().trim().max(3_000).default("").describe("避免出现的视觉内容"),
  count: z.number().int().min(1).max(4).default(1).describe("一次主动执行产生的生成数量，1 至 4 张"),
  width: z.number().int().min(256).max(2_048).multipleOf(8).default(768),
  height: z.number().int().min(256).max(2_048).multipleOf(8).default(1024),
  quality: z.enum(["auto", "low", "medium", "high"]).default("high"),
  referenceInputs: z.array(workflowReferenceParameterSchema).max(16).default([]).describe("按用户看到的顺序列出明确连接的图片、文字、色卡等输入；用途只由本次文字要求表达"),
};
export const workflowToolParametersSchema = z.object({
  intent: z.enum(["edit", "feedback", "erase", "remove_background", "outpaint"]).default("edit"),
  outpaint: imageOutpaintSchema.optional(),
  textEdits: imageTextEditsSchema.optional().describe("图片内文字替换；需使用inpaint并提供覆盖对应文字区域的实际蒙版，original/replacement按字面呈现"),
  feedbackRevision: z.number().int().nonnegative().optional(),
  commentIds: z.array(z.string().max(128)).max(100).optional(),
  ...commonGenerationShape,
  taskType: z.enum(["t2i", "i2i", "inpaint"]).default("t2i"),
  mask: workflowMaskParameterSchema.nullable().default(null),
  palette: z.array(z.object({ hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/u), name: z.string().trim().min(1).max(48) }).strict()).min(1).max(12).optional(),
}).strict();
const textParametersSchema = z.object({ prompt: promptSchema }).strict();
const generateParametersSchema = z.object({ ...commonGenerationShape, count: commonGenerationShape.count.default(2), taskType: z.literal("t2i").default("t2i") }).strict();
const editParametersSchema = workflowToolParametersSchema.extend({ taskType: z.enum(["i2i", "inpaint"]).default("i2i") }).superRefine((value, context) => {
  if (value.textEdits && (value.taskType !== "inpaint" || value.intent !== "edit")) context.addIssue({ code: "custom", path: ["textEdits"], message: "文字修改必须使用局部重绘和对应蒙版" });
  if (value.intent === "outpaint" && !value.outpaint) context.addIssue({ code: "custom", path: ["outpaint"], message: "扩图需要目标画布" });
  if (value.intent === "erase" && value.taskType !== "inpaint") context.addIssue({ code: "custom", path: ["taskType"], message: "擦除需要蒙版" });
  if (value.taskType === "inpaint" && !value.mask) context.addIssue({ code: "custom", path: ["mask"], message: "局部重绘必须引用实际蒙版" });
  if (value.taskType !== "inpaint" && (value.mask || value.palette)) context.addIssue({ code: "custom", path: ["mask"], message: "蒙版与调色板只用于局部重绘" });
  if (value.taskType === "inpaint" && value.referenceInputs.length) context.addIssue({ code: "custom", path: ["referenceInputs"], message: "当前局部重绘只接受母图、蒙版和可选调色板" });
});
export type WorkflowToolParameters = z.infer<typeof workflowToolParametersSchema>;
export interface WorkflowToolInputSlot { readonly port: WorkflowConnectionPort; readonly min: number; readonly max: number; readonly assetTypes: readonly string[]; readonly description: string }
export interface WorkflowToolContract {
  readonly key: WorkflowToolKey;
  readonly name: string;
  readonly version: typeof WORKFLOW_TOOL_VERSION;
  readonly description: string;
  readonly tags: readonly string[];
  readonly inputSlots: readonly WorkflowToolInputSlot[];
  readonly parameterSchema: z.ZodType;
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly output: { readonly type: "constraint" | "candidate" | "evaluation" | "reference_text"; readonly description: string };
  readonly limits: readonly string[];
}
const referenceTypes = ["brief", "constraint", "evaluation", "reference_text", "reference_image", "swatch", "sketch", "trend", "fabric", "legacy", "candidate"] as const;
const referenceSlot: WorkflowToolInputSlot = { port: "reference", min: 0, max: 16, assetTypes: referenceTypes, description: "用户明确指定的相关参考素材" };
const constraintSlot: WorkflowToolInputSlot = { port: "constraint", min: 1, max: 1, assetTypes: ["constraint"], description: "本分支唯一的设计约束" };
const generationDefaults = { negativePrompt: "", count: 1, width: 768, height: 1024, quality: "high", referenceInputs: [] };
export const WORKFLOW_TOOL_CATALOG: readonly WorkflowToolContract[] = [
  { key: "generate_text", name: "文本起草", version: WORKFLOW_TOOL_VERSION, description: "根据本次要求和明确引用起草或改写文本，产物可编辑并作为后续输入", tags: ["text"], inputSlots: [referenceSlot], parameterSchema: textParametersSchema, defaults: {}, output: { type: "reference_text", description: "真实生成的文本" }, limits: ["只使用本次明确提供的内容", "不自动执行图片或视频生成"] },
  { key: "transform_image", name: "调整图片", version: WORKFLOW_TOOL_VERSION, description: "裁剪、旋转、镜像、缩放或调整图片色彩与明暗，保存新版本，不消耗生图额度。先按正向原图坐标裁剪，再顺时针旋转（负值为逆时针），沿旋转结果的水平/垂直轴镜像，缩放为 width × height，最后应用 adjustments；width/height 是最终输出尺寸。adjustments 的 brightness、contrast、saturation、warmth 均为 -100 至 100，0 保持原值；用于整张图片，不用于替换指定衣服或局部颜色", tags: ["image", "resize", "crop", "rotate", "flip", "color"], inputSlots: [{ port: "source", min: 1, max: 1, assetTypes: ["candidate", "reference_image", "sketch"], description: "待调整的图片" }], parameterSchema: imageTransformSchema, defaults: { width: 1024, height: 1024 }, output: { type: "candidate", description: "调整后的图片" }, limits: ["输出最多 3200 万像素", "旋转角度 -180° 至 180°，旋转空白处透明", "色彩调整应用于整张图片，透明度保留"] },
  { key: "analyze_brief", name: "需求分析", version: WORKFLOW_TOOL_VERSION, description: "整理有证据的需求、保留项、改变项和未知项", tags: ["understand", "brief"], inputSlots: [{ port: "goal", min: 1, max: 1, assetTypes: ["brief", "reference_text"], description: "唯一设计目标，或通过 newObjective 创建新需求" }, referenceSlot], parameterSchema: textParametersSchema, defaults: {}, output: { type: "constraint", description: "有来源的结构化设计简报" }, limits: ["不生成图片，不预定整条工具链"] },
  { key: "generate_design", name: "图片生成", version: WORKFLOW_TOOL_VERSION, description: "直接使用用户确认的提示词、明确参考和参数生成图片，无需求分析或方案规划前置步骤", tags: ["create", "image", "t2i"], inputSlots: [{ ...constraintSlot, min: 0 }, referenceSlot], parameterSchema: generateParametersSchema, defaults: { ...generationDefaults, count: 2, taskType: "t2i" }, output: { type: "candidate", description: "一至四张真实生成图片" }, limits: ["只有明确生成指令才创建任务", "普通发送不增强提示词；只使用已确认文字与明确引用"] },
  { key: "evaluate_design", name: "服装评估", version: WORKFLOW_TOOL_VERSION, description: "观察真实生成图是否符合明确约束并解释问题", tags: ["inspect", "evaluate", "image"], inputSlots: [{ ...constraintSlot, min: 0 }, { port: "candidate", min: 1, max: 4, assetTypes: ["candidate", "reference_image", "sketch"], description: "明确比较的生成图集合" }], parameterSchema: textParametersSchema, defaults: {}, output: { type: "evaluation", description: "逐项评价和未知项" }, limits: ["图片不能确认纤维成分、精确尺寸或生产性能", "跨约束分支比较必须明确指定本次约束"] },
  { key: "edit_design", name: "局部修改", version: WORKFLOW_TOOL_VERSION, description: "以唯一设计图或上传的参考图片为母图，保留要求并修改指定内容", tags: ["revise", "image", "i2i", "inpaint"], inputSlots: [{ port: "source", min: 1, max: 1, assetTypes: ["candidate", "reference_image", "sketch"], description: "唯一实际母图，可直接使用上传的参考图片或设计图" }, { ...constraintSlot, min: 0 }, referenceSlot], parameterSchema: editParametersSchema, defaults: { ...generationDefaults, taskType: "i2i", mask: null }, output: { type: "candidate", description: "从真实母图派生的新设计图" }, limits: ["图片输入含母图合计最多16张；超过时需明确减少参考，不会静默丢图", "局部重绘只使用已归属当前用户的实际蒙版资产", "输入用途仅由本次明确指令表达"] },
];

export function getWorkflowToolContract(key: WorkflowToolKey): WorkflowToolContract {
  const contract = WORKFLOW_TOOL_CATALOG.find((tool) => tool.key === key);
  if (!contract) throw new Error("未知工作流工具");
  return contract;
}
export function parseWorkflowToolParameters(key: WorkflowToolKey, value: unknown): Record<string, unknown> {
  return getWorkflowToolContract(key).parameterSchema.parse(value) as Record<string, unknown>;
}
/** Public and model-safe projection: schemas are JSON, never executable validators or URLs. */
export function getWorkflowToolCatalog() {
  return ACTIVE_WORKFLOW_TOOL_KEYS.map((key) => {
    const { parameterSchema, ...contract } = getWorkflowToolContract(key);
    return { ...contract, inputSlots: contract.inputSlots.filter(slot => slot.port !== "constraint"), parameterSchema: z.toJSONSchema(parameterSchema, { io: "input" }) };
  });
}
