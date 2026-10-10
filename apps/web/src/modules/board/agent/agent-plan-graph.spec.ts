import type { AgentPlanStepSpec, AgentRunView } from "@fashion/shared";
import { describe, expect, it } from "vitest";
import {
  connectPlanSteps,
  editablePlanKeys,
  movePlanStep,
  planGraphLayout,
  removePlanStep,
  validatePlanDraft,
} from "./agent-plan-graph";

function node(
  key: string,
  sourceStepKey: string | null = null,
): AgentPlanStepSpec {
  return {
    key,
    tool: sourceStepKey ? "edit_design" : "generate_design",
    title: key,
    instruction: "设计说明",
    prompt: "design",
    negativePrompt: "",
    sourceAssetId: null,
    sourceStepKey,
  };
}
describe("agent-plan-graph", () => {
  it("拒绝自连接、未来来源与循环，仅把目标改为单来源编辑节点", () => {
    const steps = [node("a"), node("b"), node("c")];
    expect(() => connectPlanSteps(steps, "b", "a")).toThrow("前序节点");
    expect(() => connectPlanSteps(steps, "a", "a")).toThrow("前序节点");
    expect(connectPlanSteps(steps, "a", "c")[2]).toEqual({
      ...node("c", "a"),
      sourceAssetId: null,
    });
    expect(steps[2]?.tool).toBe("generate_design");
  });
  it("删除来源节点必须先解除依赖，独立节点可删除", () => {
    const steps = [node("a"), node("b", "a"), node("c")];
    expect(() => removePlanStep(steps, "a")).toThrow("先重新连接");
    expect(removePlanStep(steps, "c").map((step) => step.key)).toEqual([
      "a",
      "b",
    ]);
    expect(() => removePlanStep([node("a")], "a")).toThrow("至少保留");
  });
  it("排序保留依赖拓扑与历史位置", () => {
    const steps = [node("a"), node("b", "a"), node("c")];
    expect(() => movePlanStep(steps, "a", 1, new Set(["a", "b", "c"]))).toThrow(
      "前序节点",
    );
    expect(() => movePlanStep(steps, "b", -1, new Set(["b", "c"]))).toThrow(
      "未执行节点",
    );
    expect(
      movePlanStep(steps, "c", -1, new Set(["b", "c"])).map((step) => step.key),
    ).toEqual(["a", "c", "b"]);
  });
  it("拒绝后pending有attempt的节点仍锁结构，仅无历史后缀可编辑", () => {
    const run = {
      status: "ready",
      steps: [
        {
          ...node("a"),
          status: "pending",
          attempts: [{ id: "old" }],
          generationTaskId: null,
          selectedAssetId: null,
        },
        {
          ...node("b", "a"),
          status: "pending",
          attempts: [],
          generationTaskId: null,
          selectedAssetId: null,
        },
      ],
    } as unknown as AgentRunView;
    expect([...editablePlanKeys(run)]).toEqual(["b"]);
  });
  it("自动布局为分支产生不同位置，边随真实来源变化", () => {
    const layout = planGraphLayout([node("a"), node("b", "a"), node("c", "a")]);
    const a = layout.nodes.find((item) => item.key === "a");
    const b = layout.nodes.find((item) => item.key === "b");
    const c = layout.nodes.find((item) => item.key === "c");
    expect(b?.x).toBeGreaterThan(a?.x ?? 0);
    expect(b?.x).toBe(c?.x);
    expect(c?.y).toBeGreaterThan(b?.y ?? 0);
  });
  it("修改节点必须恰一来源，完整计划不能超过上限", () => {
    expect(
      validatePlanDraft([{ ...node("a"), tool: "edit_design" }]),
    ).toContain("一个输入来源");
    expect(
      validatePlanDraft(
        Array.from({ length: 7 }, (_, index) => node(String(index))),
      ),
    ).toContain("最多");
  });
});
