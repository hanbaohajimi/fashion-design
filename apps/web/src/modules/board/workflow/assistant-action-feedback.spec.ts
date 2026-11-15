import { describe, expect, it } from "vitest";
import {
  type AssistantCanvasAction,
  type AssistantCanvasEnvelope,
  type AssistantCanvasResult,
  type CreationActivity,
} from "@fashion/shared";
import {
  canvasActionFeedback,
  creationActivityFeedback,
  followsUserRequest,
} from "./assistant-action-feedback";

const actionId = "00000000-0000-4000-a000-000000000111";
function envelope(
  action: AssistantCanvasAction,
  state: AssistantCanvasEnvelope["state"] = "succeeded",
): AssistantCanvasEnvelope {
  return {
    id: actionId,
    conversationId: "chat",
    projectId: "project",
    messageId: "reply",
    clientId: "00000000-0000-4000-a000-000000000222",
    intentEpoch: 1,
    action,
    state,
    observation: {
      clientId: "00000000-0000-4000-a000-000000000222",
      sequence: 1,
      revision: 1,
      selectedIds: [],
      omitted: 0,
      viewport: { x: 0, y: 0, w: 1000, h: 800 },
      objects: ["A", "B", "C"].map((name, index) => ({
        id: `shape:${name}`,
        title: `参考图 ${name}`,
        type: "fashion-image",
        nodeId: `node-${index}`,
        creationId: null,
        parentId: "page:page",
        locked: false,
        hidden: false,
        stamp: "saved",
        bounds: { x: index * 400, y: 0, w: 300, h: 400 },
      })),
    },
  };
}
const align: AssistantCanvasAction = {
  type: "align_objects",
  shapeIds: ["shape:A", "shape:B", "shape:C"],
  alignment: "top",
};

describe("面向设计师的真实动作反馈", () => {
  it("按确认的实际对象显示标题、范围和方式，不把用户约束当作事实", () => {
    const model = canvasActionFeedback(envelope(align), undefined);
    expect(model).toMatchObject({
      state: "succeeded",
      title: "已对齐 3 张参考图",
      names: ["参考图 A", "参考图 B", "参考图 C"],
      method: "上边缘对齐",
      block: true,
    });
    expect(model.note).toBeUndefined();
    expect(JSON.stringify(model)).not.toContain("其他对象未改变");
  });
  it("打开面料库仅一行确认，不伪造对象或重复动作入口", () => {
    expect(
      canvasActionFeedback(
        envelope({ type: "open_panel", panel: "fabrics" }),
        undefined,
      ),
    ).toEqual({
      state: "succeeded",
      title: "面料库已打开",
      names: [],
      block: false,
    });
  });
  it("连接方向和生成状态来自匹配的成功回执，旧记录不补造未生成说明", () => {
    const value = envelope({
      type: "connect_inputs",
      targetCreationId: "target",
      sourceShapeIds: ["shape:A"],
    });
    const result: AssistantCanvasResult = {
      version: 1,
      actionId,
      targets: [{ id: "shape:A", title: "上游探索", kind: "creation" }],
      destination: { id: "target", title: "下游夹克", kind: "creation" },
      generation: "not_started",
    };
    expect(canvasActionFeedback(value, result)).toMatchObject({
      title: "参考连接已建立",
      names: ["上游探索"],
      destination: "下游夹克",
      note: "尚未开始生成",
    });
    expect(canvasActionFeedback(value, undefined).note).toBeUndefined();
    expect(
      canvasActionFeedback(value, {
        ...result,
        actionId: "00000000-0000-4000-a000-000000000333",
      }).note,
    ).toBeUndefined();
    expect(
      canvasActionFeedback(value, { ...result, generation: "not_triggered" })
        .note,
    ).toBe("本次未触发生成");
    expect(
      canvasActionFeedback(value, {
        ...result,
        destination: {
          ...result.destination,
          id: "another-target",
          title: "其他目标",
          kind: "creation",
        },
      }).note,
    ).toBeUndefined();
  });
  it.each(["pending", "applying"] as const)(
    "%s 不使用成功文字或提前显示生成事实",
    (state) => {
      const model = canvasActionFeedback(envelope(align, state), {
        version: 1,
        actionId,
        targets: [],
        generation: "not_started",
      });
      expect(model.state).toBe("pending");
      expect(model.title).toBe("正在对齐 3 张参考图");
      expect(model.note).toBeUndefined();
    },
  );
  it("保存回执未知显示待确认，成功终态不受迟到网络错误影响", () => {
    expect(
      canvasActionFeedback(envelope(align, "applying"), undefined, {
        error: "连接中断",
      }),
    ).toMatchObject({
      state: "unconfirmed",
      title: "对齐结果待确认",
      error: "连接中断",
    });
    expect(
      canvasActionFeedback(envelope(align, "pending"), undefined, {
        awaitingConfirmation: true,
      }).state,
    ).toBe("unconfirmed");
    expect(
      canvasActionFeedback(envelope(align), undefined, { error: "迟到错误" }),
    ).toMatchObject({ state: "succeeded", title: "已对齐 3 张参考图" });
  });
  it("失败使用实际错误且拒绝成功样式和生成说明", () => {
    const value = {
      ...envelope(align, "failed"),
      error: "参考图 B 已锁定，请解锁后重试。",
    };
    expect(
      canvasActionFeedback(value, {
        version: 1,
        actionId,
        targets: [],
        generation: "not_started",
      }),
    ).toMatchObject({
      state: "failed",
      title: "对齐未完成",
      error: value.error,
    });
    expect(canvasActionFeedback(value, undefined).note).toBeUndefined();
  });
  it("色卡名称使用结果中的真实名称，显示完整颜色数量", () => {
    const value = envelope({
      type: "create_swatch",
      title: "原始名称",
      colors: [
        { name: "墨绿", hex: "#2d4a3e" },
        { name: "暖白", hex: "#f5f0e8" },
      ],
    });
    expect(
      canvasActionFeedback(value, {
        version: 1,
        actionId,
        targets: [
          { id: "saved-node", title: "实际保存的色卡", kind: "swatch" },
        ],
      }),
    ).toMatchObject({
      title: "色卡已创建",
      names: ["实际保存的色卡"],
      method: "2 色",
    });
  });
  it("缩放展示不把请求范围当作已保存的精确像素尺寸", () => {
    const model = canvasActionFeedback(
      envelope({
        type: "resize_objects",
        shapeIds: ["shape:A"],
        width: 300,
        height: 400,
        keepAspectRatio: true,
      }),
      undefined,
    );
    expect(model.method).toBe("等比缩放");
    expect(JSON.stringify(model)).not.toContain("300");
  });
  it("移除引用按真实不同连接计数，不重复计算同一编号", () => {
    const value = envelope({ type: "disconnect_inputs", targetCreationId: "target", inputIds: ["input-1", "input-1"] });
    expect(canvasActionFeedback(value, undefined).method).toBe("移除 1 项引用");
  });
});

describe("已有创作状态与轮次", () => {
  const activity: CreationActivity = {
    creationId: "target",
    runId: "run",
    event: "completed",
    title: "冬季夹克系列",
    prompt: "保留领口",
    inputNodeIds: [],
    resultNodeId: "result-a",
    resultNodeIds: ["result-a", "result-b"],
    status: "partial_failed",
  };
  it("部分完成保留部分状态，以实际去重成果数说明结果", () => {
    expect(creationActivityFeedback(activity)).toMatchObject({
      state: "partial_failed",
      title: "创作部分完成",
      names: ["冬季夹克系列"],
      method: "2 项成果",
      block: true,
    });
  });
  it.each(["failed", "canceled", "running"] as const)(
    "%s 不被旧 completed 事件误标成功",
    (status) => {
      const model = creationActivityFeedback({ ...activity, status });
      expect(model.state).toBe(status === "running" ? "pending" : status);
    },
  );
  it("同轮仅连接真实相邻的请求，后台结果保持独立间距", () => {
    const user = { role: "user", id: "request" };
    expect(
      followsUserRequest({ role: "assistant", replyToId: "request" }, user),
    ).toBe(true);
    expect(
      followsUserRequest({ role: "assistant", replyToId: "other" }, user),
    ).toBe(false);
    expect(
      followsUserRequest(
        { role: "assistant", origin: "background_analysis" },
        user,
      ),
    ).toBe(false);
    expect(
      followsUserRequest(
        { role: "assistant" },
        { role: "assistant", id: "old" },
      ),
    ).toBe(false);
  });
});
