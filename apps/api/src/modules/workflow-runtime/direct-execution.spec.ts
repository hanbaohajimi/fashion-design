import { describe, expect, it } from "vitest";
import { allowsCanvasPreparation, allowsDirectExecution, directMutationId } from "./direct-execution";
import { plannerDecisionSchema } from "./workflow-planner";

function decision(request: string) {
  return plannerDecisionSchema.parse({
    kind: "propose",
    message: "筹备生成",
    execution: {
      requested: true,
      operation: "generate_design",
      sourceQuote: request,
      parameters: { prompt: request },
    },
    action: {
      type: "create_tool",
      toolKey: "generate_design",
      toolVersion: "1",
      title: "生成",
      parameters: { prompt: request },
      inputs: [],
      rationale: "用户要求",
    },
  });
}
describe("direct execution authorization", () => {
  it("分析或评价本身不能授权图片生成，退役工具也不能执行", () => {
    for (const request of ["分析需求", "评价这件外套", "评估这张图片"]) expect(allowsDirectExecution(request, decision(request))).toBe(false);
    const legacy = decision("分析需求"); if (!legacy.action) throw new Error("缺少动作");
    legacy.action.toolKey = "analyze_brief"; legacy.execution.operation = "analyze_brief";
    expect(allowsDirectExecution("分析需求", legacy)).toBe(false);
  });
  it("文本起草需要明确执行指令，讨论与否定不启动模型", () => {
    const textDecision = (request: string) => {
      const value = decision(request);
      if (!value.action) throw new Error("缺少测试动作");
      value.action.toolKey = "generate_text";
      value.execution.operation = "generate_text";
      return value;
    };
    for (const request of ["起草一段春夏系列文案", "把当前文字改写得简洁一点", "Write a collection description"]) expect(allowsDirectExecution(request, textDecision(request))).toBe(true);
    for (const request of ["先不要起草", "不需要改写文字", "如何编写文案", "如果改写会怎样", "Do not write anything"]) expect(allowsDirectExecution(request, textDecision(request))).toBe(false);
    expect(allowsDirectExecution("起草一段文案", decision("起草一段文案"))).toBe(false);
  });
  it("明确创建空目标只允许准备，讨论和否定不能更改画布", () => {
    const make = (request: string) => ({ ...decision(request), prepareOnly: true, preparationQuote: request, execution: { requested: false, operation: null, sourceQuote: null, parameters: {} } });
    expect(allowsCanvasPreparation("新建一个空节点，先不要生成", make("新建一个空节点，先不要生成"))).toBe(true);
    expect(allowsCanvasPreparation("如何创建节点", make("如何创建节点"))).toBe(false);
    expect(allowsCanvasPreparation("不要创建节点", make("不要创建节点"))).toBe(false);
    expect(allowsDirectExecution("新建一个空节点，先不要生成", make("新建一个空节点，先不要生成"))).toBe(false);
  });
  it.each([
    "请生成三张方案",
    "生成一张蓝色外套",
    "请生成三张方案，不要蓝色",
    "Generate two coat designs",
  ])("accepts explicit requests: %s", (request) =>
    expect(allowsDirectExecution(request, decision(request))).toBe(true),
  );
  it.each([
    "不要生成图片",
    "如果生成三张方案会怎样",
    "如何生成更好的图片",
    "先比较，不需要生成",
    "请解释“生成三张方案”的含义",
    "Could you explain how to generate an image?",
    "I do not want to generate anything",
  ])("rejects hypothetical and negative requests: %s", (request) =>
    expect(allowsDirectExecution(request, decision(request))).toBe(false),
  );
  it("requires a complete user quote and resolved inputs", () => {
    const value = decision("请生成三张方案");
    expect(allowsDirectExecution("别执行；请生成三张方案只是例子", value)).toBe(
      false,
    );
    value.understanding.openQuestions = ["缺少母图"];
    expect(allowsDirectExecution("请生成三张方案", value)).toBe(false);
    expect(directMutationId("request-1")).toBe(directMutationId("request-1"));
    expect(directMutationId("request-1")).not.toBe(
      directMutationId("request-2"),
    );
  });
});
