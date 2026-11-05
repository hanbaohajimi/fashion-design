import { createHash } from "node:crypto";
import type { PlannerDecision } from "./workflow-planner";

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
  if (
    /((?:不要|别|不用|不需要|不必|禁止|暂不|先不|无需|不想)[^，。；;\n]{0,10}(?:生成|生图|执行|修改|画|调整|改成|改为|换成|去除|移除|擦除|去背景|扩图|裁剪|缩放|评价|评估|分析)|如果|假如|假设|是否|能否|要不要|可不可以|怎么样|如何|怎么|会怎样|会不会|解释|举例|翻译|复述|的含义|\b(?:don't|do not|not yet|if|suppose|whether|how|could|would|explain|translate)\b)/iu.test(
      request,
    )
  )
    return false;
  if (
    !/(生成|生图|画出|绘制|改成|改为|修改|调整|换成|去除|移除|擦除|去背景|扩图|裁剪|缩放|评价|评估|分析需求|\b(?:generate|create|draw|edit|change|remove|crop|resize|evaluate)\b)/iu.test(
      request,
    )
  )
    return false;
  return (
    decision.action.toolKey === intent.operation ||
    (decision.action.toolKey === "analyze_brief" &&
      intent.operation === "generate_design")
  );
}
export function directMutationId(key: string): string {
  const hash = createHash("sha256").update(key).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export const CANVAS_EXECUTION_INSTRUCTIONS = [
  "本项目使用无限白板交互。流程图只读，工具是后台步骤；用户不操作中间节点。只理解结构化节点与历史，不根据白板坐标、容器或空间距离推断设计关系。",
  "execution 表达本轮用户的执行授权：明确要求立即生成、修改、变换或评价时 requested=true，operation 为最终工具，sourceQuote 必须逐字复制当前整条用户消息，parameters 为该最终工具的合法参数。",
  "讨论、询问可行性、比较、假设、否定表达、引用文字、助手主动建议和后台 observation 一律 requested=false，operation/sourceQuote=null，parameters={}。未决输入或需求不明确时 clarify。",
  "明确执行时仍用 kind=propose/action 提交下一步合法业务操作，系统将直接校验执行，无需用户确认提案或手动运行节点。message 表述正在筹备，不声称任务已经完成。",
  "若用户要求新生成但缺少结构化约束，action=analyze_brief，并将 execution.operation=generate_design、execution.parameters 设置为本次最终生图参数；系统仅执行需求分析和这一项生图，不循环评价改图。数量、尺寸、质量和默认模型沿用工具目录。",
  "有现成约束时直接生成。图片修改必须有明确母图；蒙版编辑必须有真实蒙版，不能捏造。实际输入只绑定本轮需要的素材，不能把全项目上下文当作输入。",
].join("\n");
