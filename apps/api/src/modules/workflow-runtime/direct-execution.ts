import { createHash } from "node:crypto";
import { isRetiredWorkflowTool } from "@fashion/shared";
import type { PlannerDecision } from "./workflow-planner";

export function allowsCanvasPreparation(request: string, decision: PlannerDecision): boolean {
  if (!decision.prepareOnly || decision.execution.requested || !decision.action || decision.kind !== "propose" || decision.preparationQuote?.trim() !== request.trim()) return false;
  if (/(如何|怎么|是否|能否|假如|如果|(?:不要|别|取消).{0,6}(?:创建|新建|建立|连接|修改))/u.test(request)) return false;
  return /(?:创建|新建|建立|添加).{0,24}(?:节点|目标)|连接|连到|接到|断开|(?:修改|更新|保存|配置).{0,16}(?:要求|提示词|输入|节点|参数)|作为.{0,12}输入/u.test(request);
}

/** Structured intent is necessary but insufficient: negative/hypothetical requests fail closed. */
export function allowsDirectExecution(
  request: string,
  decision: PlannerDecision,
): boolean {
  const intent = decision.execution;
  if (
    !intent?.requested ||
    !intent.operation ||
    !decision.action ||
    decision.kind !== "propose" ||
    decision.understanding.openQuestions.length
  )
    return false;
  if (intent.sourceQuote?.trim() !== request.trim()) return false;
  if (isRetiredWorkflowTool(intent.operation) || isRetiredWorkflowTool(decision.action.toolKey)) return false;
  if (
    /((?:不要|别|不用|不需要|不必|禁止|暂不|先不|无需|不想)[^，。；;\n]{0,10}(?:生成|生图|执行|修改|画|调整|改成|改为|换成|去除|移除|擦除|去背景|扩图|裁剪|缩放|评价|评估|分析|起草|编写|改写)|如果|假如|假设|是否|能否|要不要|可不可以|怎么样|如何|怎么|会怎样|会不会|解释|举例|翻译|复述|的含义|\b(?:don't|do not|not yet|if|suppose|whether|how|could|would|explain|translate)\b)/iu.test(
      request,
    )
  )
    return false;
  if (
    !(decision.action.toolKey === "generate_text" && /起草|编写|改写|\b(?:draft|write|rewrite)\b/iu.test(request)) && !/(生成|生图|画出|绘制|改成|改为|修改|调整|换成|去除|移除|擦除|去背景|扩图|裁剪|缩放|\b(?:generate|create|draw|edit|change|remove|crop|resize)\b)/iu.test(
      request,
    )
  )
    return false;
  return (
    decision.action.toolKey === intent.operation
  );
}
export function directMutationId(key: string): string {
  const hash = createHash("sha256").update(key).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export const CANVAS_EXECUTION_INSTRUCTIONS = [
  "本项目使用统一创作画布。creations 是稳定目标，runs 是冻结执行，工具是后台步骤；用户直接连接素材。只理解真实引用与历史，不根据白板坐标、名字或空间距离推断用途。",
  "focusedCreation 是发送消息时同步并核对版本的当前创作目标；讨论‘当前要求／当前引用’时以它的 draft.prompt、draft.inputs 和 parameters 为准，空输入表示已清空，不沿用旧会话引用。同步草稿只提供上下文，本身不构成执行授权。",
  "execution 表达本轮用户的执行授权：明确要求立即生成、修改或变换时 requested=true，operation 为最终工具，sourceQuote 必须逐字复制当前整条用户消息，parameters 为该最终工具的合法参数。",
  "讨论、询问可行性、比较、假设、否定表达、引用文字、助手主动建议和后台 observation 一律 requested=false，operation/sourceQuote=null，parameters={}。未决输入或需求不明确时 clarify。",
  "明确执行时仍用 kind=propose/action 提交下一步合法业务操作，系统将直接校验执行，无需用户确认提案或手动运行节点。message 表述正在筹备，不声称任务已经完成。",
  "图片生成只使用 generate_design 直接提交用户确认的文字、参考和参数；不得调用analyze_brief/evaluate_design或安排需求分析、方案规划、评估前置步骤。分析、比较与评价在对话中回答，不创建分析或评估节点。提示词增强仅由输入框独立按钮发起，普通发送不得自动增强。",
  "文本节点的明确起草、编写和改写使用generate_text，保存真实文字成果及版本；读取当前文字与明确引用，不套用图片尺寸或生成图片。视频节点目前仅导入与播放，不提出视频生成操作。",
  "面向用户将普通图片称为设计图、生成图或图片，不使用候选图、候选节点等内部分类。比较多个设计时可称方案1、方案2。执行回复简洁说明当前动作；提交和内部保存不等于完成，不重复逐条播报后台记录。",
  "用户要求重新生成已有目标时，canvasTarget={creationId,revision,mode:'regenerate'}，复用目标身份并追加结果；基于某个结果继续时 mode='branch'，action.inputs.source 必须是明确选定的真实结果版本。无准确目标身份就澄清，不猜测。输入顺序通过parameters.referenceInputs保持，输入用途只写在本次prompt中，不读取、推断、继承旧role或默认权重。",
  "生图只使用设计师本次明确输入的提示词、选择的参考和参数。禁止自动补写风格、保留项、面料或色卡强制约束、人物/展示方式、负向词和质量形容词。单纯重新生成沿用目标中原有的提示词；不要替用户优化、扩写或加入其他要求。",
  "用户明确要求创建空目标、接线或保存要求而不生成时，prepareOnly=true、preparationQuote逐字复制整条消息、execution.requested=false；使用action的真实输入和参数准备目标。空目标parameters.prompt可以为空。修改既有目标必须给出canvasTarget.creationId和revision。仅提出建议或讨论时prepareOnly=false，不能擅自改画布。",
  "有现成约束时直接生成。图片修改必须有明确母图；蒙版编辑必须有真实蒙版，不能捏造。实际输入只绑定本轮需要的素材，不能把全项目上下文当作输入。",
].join("\n");
