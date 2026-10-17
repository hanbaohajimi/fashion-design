import { z } from "zod";
import type { WorkflowConnectionPort } from "./workflow-connections";

export const WORKFLOW_TOOL_KEYS = ["analyze_brief", "generate_design", "evaluate_design", "edit_design"] as const;
export const workflowToolKeySchema = z.enum(WORKFLOW_TOOL_KEYS);
export type WorkflowToolKey = z.infer<typeof workflowToolKeySchema>;
export const WORKFLOW_TOOL_VERSION = "1" as const;
export const WORKFLOW_REFERENCE_ROLES = ["style_ref", "fabric_texture", "palette_ref", "silhouette_ref", "detail_ref"] as const;
const localId = z.string().trim().min(1).max(128).regex(/^[\p{L}\p{N}_.-]+$/u, "只能引用实际资产或节点编号，不能使用网址或路径");
export const workflowReferenceParameterSchema = z.object({
  nodeId: localId,
  role: z.enum(WORKFLOW_REFERENCE_ROLES).describe("参考图的作用；不改变素材本身"),
  weight: z.number().min(0).max(1).default(0.7).describe("仅作为提示词中的参考强度引导，不保证模型提供精确权重控制"),
}).strict();
export const workflowMaskParameterSchema = z.object({ assetId: localId.optional(), fileAssetId: localId.optional() }).strict().refine(
  (value) => Boolean(value.assetId) !== Boolean(value.fileAssetId), "蒙版必须且只能引用一个实际 assetId 或 fileAssetId",
);
const promptSchema = z.string().trim().min(1).max(4_000).describe("本次工具的具体任务及保留要求");
const commonGenerationShape = {
  prompt: promptSchema,
  negativePrompt: z.string().trim().max(3_000).default("").describe("避免出现的视觉内容"),
  count: z.number().int().min(1).max(4).default(1).describe("一次主动执行产生的候选数量，1 至 4 张"),
  width: z.number().int().min(256).max(2_048).multipleOf(8).default(768),
  height: z.number().int().min(256).max(2_048).multipleOf(8).default(1024),
  quality: z.enum(["auto", "low", "medium", "high"]).default("high"),
  referenceInputs: z.array(workflowReferenceParameterSchema).max(16).default([]).describe("只配置明确连接至 reference 槽位的节点；不添加隐含执行输入"),
};
export const workflowToolParametersSchema = z.object({
  ...commonGenerationShape,
  taskType: z.enum(["t2i", "i2i", "inpaint"]).default("t2i"),
  mask: workflowMaskParameterSchema.nullable().default(null),
  palette: z.array(z.object({ hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/u), name: z.string().trim().min(1).max(48) }).strict()).min(1).max(12).optional(),
}).strict();
const textParametersSchema = z.object({ prompt: promptSchema }).strict();
const generateParametersSchema = z.object({ ...commonGenerationShape, count: commonGenerationShape.count.default(2), taskType: z.literal("t2i").default("t2i") }).strict();
const editParametersSchema = workflowToolParametersSchema.extend({ taskType: z.enum(["i2i", "inpaint"]).default("i2i") }).superRefine((value, context) => {
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
  readonly output: { readonly type: "constraint" | "candidate" | "evaluation"; readonly description: string };
  readonly limits: readonly string[];
}
const referenceTypes = ["reference_text", "reference_image", "swatch", "sketch", "trend", "fabric", "legacy", "candidate"] as const;
const referenceSlot: WorkflowToolInputSlot = { port: "reference", min: 0, max: 16, assetTypes: referenceTypes, description: "用户明确指定的相关参考素材" };
const constraintSlot: WorkflowToolInputSlot = { port: "constraint", min: 1, max: 1, assetTypes: ["constraint"], description: "本分支唯一的设计约束" };
const generationDefaults = { negativePrompt: "", count: 1, width: 768, height: 1024, quality: "high", referenceInputs: [] };
export const WORKFLOW_TOOL_CATALOG: readonly WorkflowToolContract[] = [
  { key: "analyze_brief", name: "需求分析", version: WORKFLOW_TOOL_VERSION, description: "整理有证据的需求、保留项、改变项和未知项", tags: ["understand", "brief"], inputSlots: [{ port: "goal", min: 1, max: 1, assetTypes: ["brief", "reference_text"], description: "唯一设计目标，或通过 newObjective 创建新需求" }, referenceSlot], parameterSchema: textParametersSchema, defaults: {}, output: { type: "constraint", description: "有来源的结构化设计简报" }, limits: ["不生成图片，不预定整条工具链"] },
  { key: "generate_design", name: "方案生成", version: WORKFLOW_TOOL_VERSION, description: "按约束及明确参考创建服装候选", tags: ["create", "image", "t2i"], inputSlots: [constraintSlot, referenceSlot], parameterSchema: generateParametersSchema, defaults: { ...generationDefaults, count: 2, taskType: "t2i" }, output: { type: "candidate", description: "一至四个真实图片候选" }, limits: ["接受建议不生成；用户主动执行才创建任务", "参考角色和强度通过提示词引导，不保证模型精确控制"] },
  { key: "evaluate_design", name: "服装评估", version: WORKFLOW_TOOL_VERSION, description: "观察真实候选是否符合明确约束并解释问题", tags: ["inspect", "evaluate", "image"], inputSlots: [constraintSlot, { port: "candidate", min: 1, max: 4, assetTypes: ["candidate"], description: "明确比较的候选集合" }], parameterSchema: textParametersSchema, defaults: {}, output: { type: "evaluation", description: "逐项评价和未知项" }, limits: ["图片不能确认纤维成分、精确尺寸或生产性能", "跨约束分支比较必须明确指定本次约束"] },
  { key: "edit_design", name: "局部修改", version: WORKFLOW_TOOL_VERSION, description: "以唯一候选图或上传的参考图片为母图，保留要求并修改指定内容", tags: ["revise", "image", "i2i", "inpaint"], inputSlots: [{ port: "source", min: 1, max: 1, assetTypes: ["candidate", "reference_image"], description: "唯一实际母图，可直接使用上传的参考图片或候选图" }, { ...constraintSlot, min: 0 }, referenceSlot], parameterSchema: editParametersSchema, defaults: { ...generationDefaults, taskType: "i2i", mask: null }, output: { type: "candidate", description: "从真实母图派生的新候选" }, limits: ["图片输入含母图合计最多16张；超过时需明确减少参考，不会静默丢图", "存在上游设计约束时必须保留该约束输入", "局部重绘只使用已归属当前用户的实际蒙版资产", "参考权重仅为提示词引导，不保证模型提供精确控制"] },
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
  return WORKFLOW_TOOL_CATALOG.map(({ parameterSchema, ...contract }) => ({ ...contract, parameterSchema: z.toJSONSchema(parameterSchema, { io: "input" }) }));
}
