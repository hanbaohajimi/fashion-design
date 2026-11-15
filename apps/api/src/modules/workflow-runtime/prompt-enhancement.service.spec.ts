import { expect, it, vi } from "vitest";
import { PromptEnhancementService } from "./prompt-enhancement.service";
import { promptEnhancementRequestSchema } from "@fashion/shared";

const input = () =>
  promptEnhancementRequestSchema.parse({
    requestId: "00000000-0000-4000-a000-000000000001",
    prompt: "服装设计，先不要生成",
  });
function setup() {
  const access = { require: vi.fn(async () => ({ archived: false })) };
  const workflows = {
    get: vi.fn(async () => ({
      nodes: [
        {
          id: "palette",
          kind: "asset",
          type: "swatch",
          title: "配色",
          status: "completed",
          payload: {
            colors: [
              { hex: "#205b43", name: "深绿" },
              { hex: "#b09a78", name: "亚麻" },
            ],
          },
        },
      ],
    })),
  };
  const visual = {
    enrich: vi.fn(async () => ({
      images: [],
      imageBindings: [],
      coverage: {},
    })),
  };
  const model = {
    generateJson: vi.fn(async (request: unknown) => {
      void request;
      return { enhancedPrompt: "请协助服装设计，先整理设计要求，暂不生成。" };
    }),
  };
  return {
    access,
    workflows,
    visual,
    model,
    service: new PromptEnhancementService(
      access as never,
      workflows as never,
      visual as never,
      model as never,
    ),
  };
}
it("主动增强只调用文本模型，不创建消息、节点或执行任务", async () => {
  const h = setup();
  const result = await h.service.enhance("user", "project", input());
  expect(result).toMatchObject({
    requestId: input().requestId,
    enhancedPrompt: expect.stringContaining("暂不生成"),
  });
  expect(h.workflows.get).not.toHaveBeenCalled();
  expect(h.visual.enrich).not.toHaveBeenCalled();
  expect(h.model.generateJson).toHaveBeenCalledWith(
    expect.objectContaining({
      schemaName: "assistant_prompt_enhancement",
      images: [],
    }),
  );
});
it("只附带明确引用，保持图号和多色色卡结构", async () => {
  const h = setup();
  await h.service.enhance("user", "project", {
    ...input(),
    referencedNodeIds: ["palette"],
  });
  const request = h.model.generateJson.mock.calls[0]?.[0] as unknown as {
    prompt: string;
    instructions: string;
  };
  const payload = JSON.parse(request.prompt);
  expect(payload.references).toHaveLength(1);
  expect(payload.references[0]).toMatchObject({
    number: 1,
    id: "palette",
    colors: [
      { hex: "#205b43", name: "深绿" },
      { hex: "#b09a78", name: "亚麻" },
    ],
  });
  expect(request.instructions).toContain("不擅自增加");
});
it("失效引用和权限拒绝不调用模型", async () => {
  const h = setup();
  await expect(
    h.service.enhance("user", "project", {
      ...input(),
      referencedNodeIds: ["foreign"],
    }),
  ).rejects.toThrow("引用已失效");
  expect(h.model.generateJson).not.toHaveBeenCalled();
  h.access.require.mockRejectedValue(new Error("无权限"));
  await expect(h.service.enhance("user", "project", input())).rejects.toThrow(
    "无权限",
  );
  expect(h.model.generateJson).not.toHaveBeenCalled();
});
it("超限结果拒绝交付，输入上限也不能绕过", async () => {
  const h = setup();
  h.model.generateJson.mockResolvedValue({ enhancedPrompt: "字".repeat(4001) });
  await expect(h.service.enhance("user", "project", input())).rejects.toThrow();
  expect(() =>
    promptEnhancementRequestSchema.parse({
      ...input(),
      prompt: "字".repeat(4001),
    }),
  ).toThrow();
});
