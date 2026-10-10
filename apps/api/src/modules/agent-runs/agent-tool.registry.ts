import type { AgentPlanStepSpec } from "@fashion/shared";
import { createHash } from "node:crypto";

export const AGENT_TOOL_REGISTRY = {
  generate_design: {
    label: "新建设计",
    taskType: "t2i",
    requiresSource: false,
  },
  edit_design: { label: "编辑设计", taskType: "i2i", requiresSource: true },
} as const satisfies Record<
  AgentPlanStepSpec["tool"],
  { label: string; taskType: "t2i" | "i2i"; requiresSource: boolean }
>;

export function agentAttemptTaskId(
  userId: string,
  executionKey: string,
): string {
  return createHash("sha256")
    .update(`${userId}\0${executionKey}`)
    .digest("hex");
}
