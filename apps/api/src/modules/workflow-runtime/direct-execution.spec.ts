import { describe, expect, it } from "vitest";
import { allowsDirectExecution, directMutationId } from "./direct-execution";
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
