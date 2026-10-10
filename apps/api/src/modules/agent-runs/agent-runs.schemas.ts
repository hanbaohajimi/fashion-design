import { z } from "zod";
import { AGENT_PLAN_MAX_STEPS, AGENT_TOOL_NAMES } from "@fashion/shared";

const id = z.string().trim().min(1).max(128);

export const agentPlanStepSchema = z
  .object({
    key: id.regex(/^[a-zA-Z0-9_-]+$/),
    tool: z.enum(AGENT_TOOL_NAMES),
    title: z.string().trim().min(1).max(100),
    instruction: z.string().trim().min(1).max(2000),
    prompt: z.string().trim().min(1).max(4000),
    negativePrompt: z.string().trim().max(3000),
    sourceAssetId: id.nullable(),
    sourceStepKey: id.nullable(),
  })
  .strict();

export const agentPlanSchema = z
  .array(agentPlanStepSchema)
  .min(1)
  .max(AGENT_PLAN_MAX_STEPS)
  .superRefine((steps, context) => {
    const seen = new Set<string>();
    for (const [index, step] of steps.entries()) {
      if (seen.has(step.key))
        context.addIssue({
          code: "custom",
          message: "节点 key 必须唯一",
          path: [index, "key"],
        });
      if (step.sourceStepKey && !seen.has(step.sourceStepKey))
        context.addIssue({
          code: "custom",
          message: "仅可引用前序节点",
          path: [index, "sourceStepKey"],
        });
      const sources =
        Number(step.sourceAssetId !== null) +
        Number(step.sourceStepKey !== null);
      if (
        (step.tool === "generate_design" && sources !== 0) ||
        (step.tool === "edit_design" && sources !== 1)
      ) {
        context.addIssue({
          code: "custom",
          message: "编辑节点必须指定一个来源，新建节点不能指定编辑来源",
          path: [index],
        });
      }
      seen.add(step.key);
    }
  });

export const agentRunRevisionSchema = z
  .object({ revision: z.number().int().nonnegative() })
  .strict();
export const updateAgentRunStepSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    prompt: z.string().trim().min(1).max(4000),
    negativePrompt: z.string().trim().max(3000),
    title: z.string().trim().min(1).max(100).optional(),
    instruction: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();
export const reviewAgentRunSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    assetId: id,
    reason: z.string().trim().max(1000).default(""),
  })
  .strict();
export type UpdateAgentRunStepInput = z.infer<typeof updateAgentRunStepSchema>;
export type ReviewAgentRunInput = z.infer<typeof reviewAgentRunSchema>;
