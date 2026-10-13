import type {
  AgentPlanStepSpec,
  FashionDesignDimension,
} from "@fashion/shared";
import { createHash } from "node:crypto";

export const AGENT_TOOL_REGISTRY = {
  generate_design: {
    label: "新建设计",
    version: "1",
    description:
      "把明确的服装设计目标和已选上下文转为新的视觉方案，结果须由用户选择。",
    input: "设计提示词、负向提示词及同项目选中的配色、面料、廓形和细节参考。",
    output: "真实生成任务与候选设计图片，不输出生产版型或实测参数。",
    supportedDimensions: [
      "silhouette",
      "structure",
      "material",
      "color",
      "style",
      "function",
      "presentation",
    ],
    limitations: [
      "无法验证面料成分或物理性能",
      "无法验证实际尺寸与合体性",
      "不提供生产打版或制造可行性保证",
    ],
    taskType: "t2i",
    requiresSource: false,
  },
  edit_design: {
    label: "编辑设计",
    version: "1",
    description:
      "以同项目真实设计或前序用户采用的结果为来源，在保留目标约束下进行视觉修改。",
    input: "一个真实来源设计、明确的修改目标、保留要求与提示词。",
    output:
      "与来源关联的实际编辑任务和候选图片，用户确认后才能供后续节点引用。",
    supportedDimensions: [
      "silhouette",
      "structure",
      "material",
      "color",
      "style",
      "function",
      "presentation",
    ],
    limitations: [
      "生成模型不能保证所有未指定细节完全不变",
      "未提供局部蒙版工具",
      "无法验证实际尺寸、面料成分或物理性能",
      "不提供生产打版",
    ],
    taskType: "i2i",
    requiresSource: true,
  },
} as const satisfies Record<
  AgentPlanStepSpec["tool"],
  {
    label: string;
    version: string;
    description: string;
    input: string;
    output: string;
    supportedDimensions: readonly FashionDesignDimension[];
    limitations: readonly string[];
    taskType: "t2i" | "i2i";
    requiresSource: boolean;
  }
>;

export function agentAttemptTaskId(
  userId: string,
  executionKey: string,
): string {
  return createHash("sha256")
    .update(`${userId}\0${executionKey}`)
    .digest("hex");
}
