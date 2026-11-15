import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  assistantCanvasEnvelopeSchema,
  assistantCanvasResultSchema,
  assistantShapeStamp,
  emptyCanvasCreationDraft,
  type AssistantCanvasAction,
} from "@fashion/shared";
import { AssistantCanvasActionsService } from "./assistant-canvas-actions.service";

function harness(action: AssistantCanvasAction, runCount = 0) {
  const record = {
    id: "shape:source",
    typeName: "shape",
    type: "fashion-image",
    parentId: "page:page",
    x: 0,
    y: 0,
    props: { w: 300, h: 400, title: "实际保存的参考图" },
    meta: {},
  };
  const envelope = assistantCanvasEnvelopeSchema.parse({
    id: randomUUID(),
    projectId: "project",
    conversationId: "chat",
    messageId: "message",
    clientId: randomUUID(),
    intentEpoch: 1,
    action,
    state: "applying",
    observation: {
      clientId: randomUUID(),
      sequence: 1,
      revision: 1,
      selectedIds: [],
      objects: [
        {
          id: record.id,
          type: record.type,
          title: "请求时的旧名称",
          nodeId: null,
          creationId: null,
          stamp: assistantShapeStamp(record),
          locked: false,
          hidden: false,
          parentId: record.parentId,
          bounds: { x: 0, y: 0, w: 300, h: 400 },
        },
      ],
      omitted: 0,
      viewport: { x: 0, y: 0, w: 1000, h: 800 },
    },
  });
  const inputs = [{ id: "input", nodeId: "source" }];
  const message = {
    id: "message",
    conversationId: "chat",
    role: "ASSISTANT",
    context: { canvasAction: envelope, canvasActionData: { inputs } },
  };
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    ...message,
    ...data,
  }));
  const tx = {
    agentMessage: { updateMany: vi.fn(async () => ({ count: 1 })), update },
  };
  const database = {
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
      work(tx),
    ),
    agentMessage: { findFirst: vi.fn(async () => message) },
    canvasMutation: { findUnique: vi.fn(async () => ({ result: {} })) },
  };
  const canvas = {
    read: vi.fn(async () => ({
      snapshot: { store: { [record.id]: record } },
      bindings: [],
    })),
  };
  const creations = {
    read: vi.fn(async () => ({
      id: "target",
      title: "实际下游名称",
      draft: { ...emptyCanvasCreationDraft(), inputs },
      currentResultNodeId: null,
      runs: Array.from({ length: runCount }, () => ({
        status: "failed",
        results: [],
      })),
    })),
  };
  const service = new AssistantCanvasActionsService(
    database as never,
    { require: vi.fn(async () => ({})) } as never,
    canvas as never,
    {} as never,
    creations as never,
    {} as never,
  );
  return { envelope, record, service, update, creations, canvas };
}

describe("仅对核实后的回执输出展示事实", () => {
  it("无生成记录的目标确认连接后才输出尚未开始生成", async () => {
    const h = harness({
      type: "connect_inputs",
      targetCreationId: "target",
      sourceShapeIds: ["shape:source"],
    });
    const message = await h.service.finish(
      "user",
      "chat",
      "message",
      h.envelope.clientId,
      "succeeded",
      { shapes: [], removedShapeIds: [] },
    );
    const context = message.context as Record<string, unknown>;
    expect(
      assistantCanvasResultSchema.parse(context.canvasActionResult),
    ).toMatchObject({
      actionId: h.envelope.id,
      destination: { id: "target", title: "实际下游名称" },
      generation: "not_started",
      targets: [{ title: "实际保存的参考图" }],
    });
  });
  it("已有失败生成也不能显示尚未开始生成", async () => {
    const h = harness(
      {
        type: "connect_inputs",
        targetCreationId: "target",
        sourceShapeIds: ["shape:source"],
      },
      1,
    );
    const message = await h.service.finish(
      "user",
      "chat",
      "message",
      h.envelope.clientId,
      "succeeded",
      { shapes: [], removedShapeIds: [] },
    );
    expect(
      assistantCanvasResultSchema.parse(
        (message.context as Record<string, unknown>).canvasActionResult,
      ).generation,
    ).toBe("not_triggered");
  });
  it("未核实保存结果时不会写入可展示的成功事实", async () => {
    const h = harness({
      type: "move_objects",
      shapeIds: ["shape:source"],
      offset: { x: 80, y: 0 },
    });
    await expect(
      h.service.finish(
        "user",
        "chat",
        "message",
        h.envelope.clientId,
        "succeeded",
        { shapes: [], removedShapeIds: [] },
      ),
    ).rejects.toThrow("缺少目标对象");
    expect(h.update).not.toHaveBeenCalled();
  });
  it("失败不读取或捏造生成状态", async () => {
    const h = harness({
      type: "connect_inputs",
      targetCreationId: "target",
      sourceShapeIds: ["shape:source"],
    });
    const message = await h.service.finish(
      "user",
      "chat",
      "message",
      h.envelope.clientId,
      "failed",
      { shapes: [], removedShapeIds: [] },
      "目标版本已变化",
    );
    expect(
      (message.context as Record<string, unknown>).canvasActionResult,
    ).toBeUndefined();
    expect(h.creations.read).not.toHaveBeenCalled();
    expect(h.canvas.read).not.toHaveBeenCalled();
  });
});
