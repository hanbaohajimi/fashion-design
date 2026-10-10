import {
  AGENT_PLAN_MAX_STEPS,
  type AgentPlanStepSpec,
  type AgentRunView,
} from "@fashion/shared";

export function attemptStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: "等待生成",
    running: "生成中",
    waiting_review: "等待采用",
    succeeded: "已完成",
    rejected: "已否决",
    failed: "失败",
    moderation_failed: "未通过审核",
    canceled: "已取消",
  };
  return labels[status.toLowerCase()] ?? status;
}

export function planSpecs(run: AgentRunView): AgentPlanStepSpec[] {
  return run.steps.map(
    ({
      key,
      tool,
      title,
      instruction,
      prompt,
      negativePrompt,
      sourceAssetId,
      sourceStepKey,
    }) => ({
      key,
      tool,
      title,
      instruction,
      prompt,
      negativePrompt,
      sourceAssetId,
      sourceStepKey,
    }),
  );
}

export function editablePlanKeys(run: AgentRunView): ReadonlySet<string> {
  if (!["ready", "paused", "failed"].includes(run.status)) return new Set();
  const lastLocked = run.steps.findLastIndex(
    (step) =>
      step.status !== "pending" ||
      Boolean(step.generationTaskId) ||
      Boolean(step.selectedAssetId) ||
      Boolean(step.attempts?.length),
  );
  return new Set(run.steps.slice(lastLocked + 1).map((step) => step.key));
}

export function validatePlanDraft(
  steps: readonly AgentPlanStepSpec[],
): string | null {
  if (!steps.length) return "计划至少需要一个节点";
  if (steps.length > AGENT_PLAN_MAX_STEPS)
    return `计划最多包含 ${AGENT_PLAN_MAX_STEPS} 个节点`;
  const keys = new Set<string>();
  for (const step of steps) {
    if (keys.has(step.key)) return "节点标识重复，请重新加载计划";
    if (!step.title.trim() || !step.instruction.trim() || !step.prompt.trim())
      return "请填写节点标题、设计说明与提示词";
    if (step.prompt.length > 4_000 || step.negativePrompt.length > 3_000)
      return "节点提示词或避免内容超过长度限制";
    if (step.title.length > 100 || step.instruction.length > 2000)
      return "节点标题或设计说明超过长度限制";
    if (
      step.tool === "generate_design" &&
      (step.sourceAssetId || step.sourceStepKey)
    )
      return "生成节点不应连接设计资产来源";
    if (
      step.tool === "edit_design" &&
      Boolean(step.sourceAssetId) === Boolean(step.sourceStepKey)
    )
      return "修改节点需要且只能选择一个输入来源";
    if (step.sourceStepKey && !keys.has(step.sourceStepKey))
      return "来源必须是前序节点，不能形成循环或向前连接";
    keys.add(step.key);
  }
  return null;
}

export function connectPlanSteps(
  steps: readonly AgentPlanStepSpec[],
  sourceKey: string,
  targetKey: string,
): AgentPlanStepSpec[] {
  const source = steps.findIndex((step) => step.key === sourceKey);
  const target = steps.findIndex((step) => step.key === targetKey);
  if (source < 0 || target < 0 || source >= target)
    throw new Error("来源必须是前序节点，不能形成循环或向前连接");
  return steps.map((step) =>
    step.key === targetKey
      ? {
          ...step,
          tool: "edit_design",
          sourceAssetId: null,
          sourceStepKey: sourceKey,
        }
      : step,
  );
}

export function movePlanStep(
  steps: readonly AgentPlanStepSpec[],
  key: string,
  direction: -1 | 1,
  editable: ReadonlySet<string>,
): AgentPlanStepSpec[] {
  const index = steps.findIndex((step) => step.key === key);
  const target = index + direction;
  const current = steps[index];
  const neighbor = steps[target];
  if (
    !current ||
    !neighbor ||
    !editable.has(current.key) ||
    !editable.has(neighbor.key)
  )
    throw new Error("只能调整未执行节点的顺序");
  const moved = [...steps];
  moved[index] = neighbor;
  moved[target] = current;
  const error = validatePlanDraft(moved);
  if (error) throw new Error(error);
  return moved;
}

export function removePlanStep(
  steps: readonly AgentPlanStepSpec[],
  key: string,
): AgentPlanStepSpec[] {
  if (steps.some((step) => step.sourceStepKey === key))
    throw new Error("有节点正在使用此来源，请先重新连接后再删除");
  if (steps.length === 1) throw new Error("计划至少保留一个节点");
  return steps.filter((step) => step.key !== key);
}

export function planGraphLayout(steps: readonly AgentPlanStepSpec[]) {
  const levels = new Map<string, number>();
  const rows = new Map<number, number>();
  const nodes = steps.map((step) => {
    const level = step.sourceStepKey
      ? (levels.get(step.sourceStepKey) ?? 0) + 1
      : 0;
    const row = rows.get(level) ?? 0;
    levels.set(step.key, level);
    rows.set(level, row + 1);
    return { key: step.key, x: 32 + level * 278, y: 32 + row * 188 };
  });
  return {
    nodes,
    width: Math.max(500, ...nodes.map((node) => node.x + 270)),
    height: Math.max(390, ...nodes.map((node) => node.y + 184)),
  };
}
