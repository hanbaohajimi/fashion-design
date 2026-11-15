import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  assistantCanvasActionSchema,
  assistantShapeStamp,
  emptyCanvasCreationDraft,
  type AssistantCanvasAction,
  type AssistantCanvasObservation,
} from "@fashion/shared";
import {
  actionShapeIds,
  allowsAssistantCanvasAction,
  canvasRecordProtected,
  canvasShapeRecords,
  readAssistantCanvasContext,
} from "./canvas-action-context";
import {
  activePlannerDecisionSchema,
  parsePlannerDecision,
} from "./workflow-planner";

describe("助手画布工具的独立契约与授权边界", () => {
  const swatch: AssistantCanvasAction = {
    type: "create_swatch",
    title: "秋冬通勤配色",
    colors: [{ hex: "#2d4a3e", name: "墨绿" }],
  };
  it.each([
    "帮我做张秋冬通勤用的四色色卡，分别用墨绿、亚麻米、暖白和酒红，名字叫「秋冬通勤配色」。不要生图。",
    "做一张墨绿配色卡，不要生成图片。",
    "我需要一张秋冬色卡。",
  ])("真实模型理解后的口语色卡请求可以落地：%s", (request) => {
    expect(allowsAssistantCanvasAction(request, request, swatch)).toBe(true);
  });
  it.each(["把面料库调出来，我想看看有哪些面料。", "我想看看面料库。"])(
    "口语面板请求可以执行：%s",
    (request) => {
      expect(
        allowsAssistantCanvasAction(request, request, {
          type: "open_panel",
          panel: "fabrics",
        }),
      ).toBe(true);
    },
  );
  it.each([
    "别帮我做色卡",
    "假如我想做张色卡",
    "我昨天做过一张色卡",
    "我不需要做色卡",
  ])("口语兼容仍拒绝否定、假设与陈述：%s", (request) => {
    expect(allowsAssistantCanvasAction(request, request, swatch)).toBe(false);
  });
  it("调出面板不授权排版，否定调出不执行，查看图片不误授权打开面板", () => {
    expect(
      allowsAssistantCanvasAction("把面料库调出来", "把面料库调出来", {
        type: "move_objects",
        shapeIds: ["shape:a"],
        offset: { x: 100, y: 0 },
      }),
    ).toBe(false);
    expect(
      allowsAssistantCanvasAction("先别调出面料库", "先别调出面料库", {
        type: "open_panel",
        panel: "fabrics",
      }),
    ).toBe(false);
    expect(
      allowsAssistantCanvasAction(
        "我想看看图片里的面料",
        "我想看看图片里的面料",
        { type: "open_panel", panel: "fabrics" },
      ),
    ).toBe(false);
  });
  it("礼貌请求仍可执行，兼容网关字符串化动作且不会退回旧协议", () => {
    const action: AssistantCanvasAction = {
      type: "open_panel",
      panel: "fabrics",
    };
    const content = "能否帮我打开面料库";
    expect(allowsAssistantCanvasAction(content, content, action)).toBe(true);
    expect(
      parsePlannerDecision({
        kind: "canvas",
        message: "等待执行",
        canvasQuote: content,
        canvasAction: JSON.stringify(action),
      }).canvasAction,
    ).toEqual(action);
  });
  const move: AssistantCanvasAction = {
    type: "move_objects",
    shapeIds: ["shape:a"],
    offset: { x: 80, y: 0 },
  };
  it.each([
    "假如我让你移动图片",
    "不要移动图片，先解释",
    "如果移动图片会怎么样",
    "How do I move this?",
    "Don't move the picture",
  ])("讨论和否定不执行：%s", (request) => {
    expect(allowsAssistantCanvasAction(request, request, move)).toBe(false);
  });
  it("只接受本条完整指令，打开面板不授权移动，解组不误执行组合", () => {
    const negative = "不要\n修改这张色卡";
    expect(
      allowsAssistantCanvasAction(negative, negative, {
        type: "update_swatch",
        shapeId: "shape:swatch",
        colors: [{ hex: "#205b43", name: "深绿" }],
      }),
    ).toBe(false);
    expect(
      allowsAssistantCanvasAction("移除输入连接", "移除输入连接", move),
    ).toBe(false);
    expect(
      allowsAssistantCanvasAction(
        "打开面料库，不要生成",
        "打开面料库，不要生成",
        { type: "open_panel", panel: "fabrics" },
      ),
    ).toBe(true);
    expect(
      allowsAssistantCanvasAction("请移动这张图片", "移动这张图片", move),
    ).toBe(false);
    expect(allowsAssistantCanvasAction("打开面料库", "打开面料库", move)).toBe(
      false,
    );
    expect(
      allowsAssistantCanvasAction(
        "请把图片向右移动80",
        "请把图片向右移动80",
        move,
      ),
    ).toBe(true);
    expect(
      allowsAssistantCanvasAction("取消组合", "取消组合", {
        type: "ungroup_objects",
        shapeIds: ["shape:group"],
      }),
    ).toBe(true);
    expect(
      allowsAssistantCanvasAction("取消组合", "取消组合", {
        type: "group_objects",
        shapeIds: ["shape:a", "shape:b"],
      }),
    ).toBe(false);
    expect(
      allowsAssistantCanvasAction("取消连接", "取消连接", {
        type: "disconnect_inputs",
        targetCreationId: "target",
        inputIds: ["input"],
      }),
    ).toBe(true);
    expect(
      allowsAssistantCanvasAction("取消连接", "取消连接", {
        type: "connect_inputs",
        targetCreationId: "target",
        sourceShapeIds: ["shape:a"],
      }),
    ).toBe(false);
  });
  it("限制真实参数范围，画布动作不能混入图片生成或旧提案", () => {
    expect(
      assistantCanvasActionSchema.safeParse({
        ...move,
        offset: { x: Infinity, y: 0 },
      }).success,
    ).toBe(false);
    expect(
      assistantCanvasActionSchema.safeParse({
        type: "align_objects",
        shapeIds: ["shape:a"],
        alignment: "left",
      }).success,
    ).toBe(false);
    expect(
      assistantCanvasActionSchema.safeParse({
        type: "create_swatch",
        title: "配色",
        colors: [],
      }).success,
    ).toBe(false);
    expect(
      assistantCanvasActionSchema.safeParse({
        type: "open_panel",
        panel: "analysis",
      }).success,
    ).toBe(false);
    expect(
      activePlannerDecisionSchema.parse({
        kind: "canvas",
        message: "等待画布执行",
        canvasAction: move,
        canvasQuote: "移动图片",
      }).execution.requested,
    ).toBe(false);
    expect(
      activePlannerDecisionSchema.safeParse({
        kind: "canvas",
        message: "移动并生成",
        canvasAction: move,
        execution: {
          requested: true,
          operation: "generate_design",
          sourceQuote: "生成",
          parameters: {},
        },
      }).success,
    ).toBe(false);
    expect(
      activePlannerDecisionSchema.safeParse({
        kind: "reply",
        message: "假装完成",
        canvasAction: move,
      }).success,
    ).toBe(false);
  });
  it("锁定与隐藏继承父组，签名忽略加载状态但能检测几何和身份变化", () => {
    const shape = {
      id: "shape:a",
      typeName: "shape",
      type: "fashion-image",
      parentId: "shape:group",
      x: 10,
      y: 30,
      props: { w: 200, h: 300, status: "ready" },
    };
    const records = canvasShapeRecords({
      document: {
        store: {
          [shape.id]: shape,
          "shape:group": {
            typeName: "shape",
            id: "shape:group",
            isLocked: true,
          },
          page: { typeName: "page" },
        },
      },
    });
    expect(Object.keys(records)).toHaveLength(2);
    expect(canvasRecordProtected(records, shape.id)).toBe(true);
    expect(
      assistantShapeStamp({
        ...shape,
        props: { ...shape.props, status: "loading" },
      }),
    ).toBe(assistantShapeStamp(shape));
    expect(assistantShapeStamp({ ...shape, x: 11 })).not.toBe(
      assistantShapeStamp(shape),
    );
    expect(actionShapeIds(move)).toEqual([shape.id]);
  });
  it("过滤未保存对象，并提供目标真实输入编号与有权使用的面料", async () => {
    const record = {
      id: "shape:a",
      typeName: "shape",
      type: "fashion-creation",
      parentId: "page:a",
      x: 10,
      y: 30,
      props: { w: 200, h: 300, creationId: "target" },
      meta: { canvasNodeId: "" },
    };
    const observation: AssistantCanvasObservation = {
      clientId: randomUUID(),
      sequence: 1,
      revision: 0,
      selectedIds: [record.id, "shape:foreign"],
      omitted: 0,
      viewport: { x: 0, y: 0, w: 1000, h: 800 },
      objects: [record.id, "shape:foreign"].map((id) => ({
        id,
        type: record.type,
        title: "对象",
        parentId: record.parentId,
        nodeId: null,
        creationId: "forged",
        locked: false,
        hidden: false,
        bounds: { x: 10, y: 30, w: 200, h: 300 },
        stamp: assistantShapeStamp({ ...record, id }),
      })),
    };
    const database = {
      canvasDocument: {
        findUnique: vi.fn(async () => ({
          revision: 7,
          snapshot: { store: { [record.id]: record } },
        })),
      },
      canvasObjectBinding: { findMany: vi.fn(async () => []) },
      fabric: {
        findMany: vi.fn(async () => [
          { id: "linen", details: { name: "亚麻" }, tags: ["自然"] },
        ]),
      },
      canvasCreation: {
        findMany: vi.fn(async () => [
          {
            id: "target",
            title: "夹克",
            revision: 4,
            module: "image",
            draft: {
              ...emptyCanvasCreationDraft(),
              inputs: [{ id: "real-input", nodeId: "source" }],
            },
            currentResultNodeId: null,
          },
        ]),
      },
    };
    const context = await readAssistantCanvasContext(
      database as never,
      "user",
      "project",
      observation,
    );
    expect(context).toMatchObject({
      revision: 7,
      selectedIds: [record.id],
      omitted: 1,
      objects: [{ creationId: "target", nodeId: null }],
      creations: [{ inputs: [{ id: "real-input" }] }],
      availableFabrics: [{ id: "linen", name: "亚麻" }],
    });
    expect(database.fabric.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "active",
          OR: [{ scope: "PRESET" }, { ownerId: "user", scope: "USER" }],
        },
      }),
    );
  });
});
