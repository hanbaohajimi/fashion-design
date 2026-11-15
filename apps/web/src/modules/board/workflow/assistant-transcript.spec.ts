import { describe, expect, it } from "vitest";
import type {
  CreationActivity,
  WorkflowExecutionProgress,
  WorkflowExecutionResult,
} from "@fashion/shared";
import type { WorkflowMessageView } from "../agent/agent-api";
import {
  assistantTaskState,
  assistantTranscript,
  imageDisplayTitle,
} from "./assistant-transcript";
import { mergeMessages } from "./conversation-messages";

const now = "2026-11-15T10:00:00Z";
const message = (
  id: string,
  changes: Partial<WorkflowMessageView> = {},
): WorkflowMessageView => ({
  id,
  conversationId: "chat",
  role: "assistant",
  status: "completed",
  content: id,
  createdAt: now,
  updatedAt: now,
  clientRequestId: null,
  replyToId: null,
  generationTaskId: null,
  error: null,
  context: {},
  ...changes,
});
const activity = (
  event: CreationActivity["event"],
  changes: Partial<CreationActivity> = {},
): CreationActivity => ({
  creationId: "image",
  runId: "run-1",
  event,
  title: "雾蓝通勤",
  prompt: "生成一件风衣",
  inputNodeIds: [],
  resultNodeId: null,
  ...changes,
});
const progress = (
  status: WorkflowExecutionProgress["status"],
): WorkflowExecutionProgress => ({
  version: 1,
  executionId: "exec-1",
  toolNodeId: "tool",
  title: "雾蓝通勤",
  operation: "image",
  status,
  updatedAt: now,
  counts: {
    total: 1,
    completed: status === "completed" ? 1 : 0,
    preparing: 0,
    queued: 0,
    running: status === "running" ? 1 : 0,
    failed: status === "failed" ? 1 : 0,
    canceled: 0,
  },
  cancelTaskIds: status === "running" ? ["task-1"] : [],
});
const result = (
  status: WorkflowExecutionResult["status"] = "completed",
): WorkflowExecutionResult => ({
  version: 1,
  executionId: "exec-1",
  toolNodeId: "tool",
  status,
  completedAt: now,
  attempts: {
    completed: 1,
    failed: status === "partial_failed" ? 1 : 0,
    canceled: 0,
  },
  images: [
    {
      assetId: "asset-1",
      nodeId: "node-1",
      title: "风衣",
      width: 600,
      height: 800,
    },
  ],
});
const submitted = () =>
  message("submitted", {
    origin: "creative_activity",
    executionId: "exec-1",
    context: {
      creationActivity: activity("submitted"),
      executionProgress: progress("running"),
    },
  });
const completed = () =>
  message("completed", {
    origin: "execution_result",
    executionId: "exec-1",
    context: {
      creationActivity: activity("completed"),
      executionResult: result(),
    },
  });
const task = (messages: WorkflowMessageView[]) => {
  const row = assistantTranscript(messages).rows.find(
    (row) => row.kind === "task",
  );
  if (row?.kind !== "task") throw new Error("没有任务");
  return row.task;
};

describe("assistant transcript projection", () => {
  it("把同次执行的正文、提交和完成归到原位置，保存记录另存且原历史不变", () => {
    const dispatch = message("reply", {
      kind: "executing",
      executionId: "exec-1",
      replyToId: "user",
      context: { executionProgress: progress("running") },
    });
    const saved = message("saved", {
      origin: "creative_activity",
      context: {
        creationActivity: activity("module_saved", {
          creationId: "text",
          runId: "manual",
        }),
      },
    });
    const raw = [
      message("user", { role: "user" }),
      dispatch,
      submitted(),
      saved,
      completed(),
    ];
    const snapshot = structuredClone(raw);
    const projected = assistantTranscript(raw);
    expect(projected.rows.map((row) => row.kind)).toEqual(["message", "task"]);
    expect(task(raw).id).toBe("reply");
    expect(task(raw).messages.map((item) => item.id)).toEqual([
      "reply",
      "submitted",
      "completed",
    ]);
    expect(projected.records).toEqual([saved]);
    expect(raw).toEqual(snapshot);
    expect(assistantTaskState(task(raw))).toBe("completed");
  });

  it("缺少执行编号的提交仅用确切运行记录关联完成回执", () => {
    const pending = {
      ...submitted(),
      executionId: null,
      context: { creationActivity: activity("submitted") },
    };
    expect(assistantTranscript([pending, completed()]).rows).toHaveLength(1);
    const unrelated = message("other", {
      context: { creationActivity: activity("submitted", { runId: "run-2" }) },
    });
    expect(
      assistantTranscript([pending, unrelated, completed()]).rows,
    ).toHaveLength(2);
  });

  it("同名重跑、交错任务及不同会话不按时间或目标名称合并", () => {
    const rerun = message("rerun", {
      executionId: "exec-2",
      context: { creationActivity: activity("submitted", { runId: "run-2" }) },
    });
    const foreign = {
      ...completed(),
      id: "foreign",
      conversationId: "other-chat",
    };
    expect(
      assistantTranscript([submitted(), rerun, completed(), foreign]).rows,
    ).toHaveLength(3);
  });

  it("普通讨论与画布动作即使带执行编号也保留自己的语义", () => {
    const discussion = message("analysis", {
      origin: "background_analysis",
      executionId: "exec-1",
      content: "袖口可以略微收窄",
    });
    const question = message("question", {
      kind: "clarify",
      content: "你希望哪种面料？",
      executionId: "exec-1",
      context: { executionProgress: progress("running") },
    });
    const projected = assistantTranscript([
      submitted(),
      discussion,
      question,
      completed(),
    ]);
    expect(projected.rows.map((row) => row.kind)).toEqual([
      "task",
      "message",
      "message",
    ]);
  });

  it("失败和部分完成采用真实结果状态，completed事件不能假报成功", () => {
    const failed = {
      ...completed(),
      context: {
        creationActivity: activity("completed"),
        executionResult: result("failed"),
      },
    };
    expect(assistantTaskState(task([submitted(), failed]))).toBe("failed");
    const partial = {
      ...failed,
      context: { ...failed.context, executionResult: result("partial_failed") },
    };
    expect(assistantTaskState(task([submitted(), partial]))).toBe(
      "partial_failed",
    );
    expect(
      assistantTaskState(
        task([
          message("legacy", {
            context: { creationActivity: activity("completed") },
          }),
        ]),
      ),
    ).toBe("unconfirmed");
  });

  it("伪造或不匹配的结果编号不参与聚合", () => {
    const wrong = { ...completed(), executionId: "different" };
    expect(task([wrong]).result).toBeNull();
  });

  it("未知回执保留待确认状态，不当作成功或静默保存记录", () => {
    const unknown = message("unknown", {
      context: {
        creationActivity: activity("module_saved", { status: "unconfirmed" }),
      },
    });
    const projected = assistantTranscript([unknown]);
    expect(projected.records).toEqual([]);
    expect(assistantTaskState(task([unknown]))).toBe("unconfirmed");
  });

  it("终态不被迟到进度回退，分页合并也保留已读取的图片", () => {
    const done = message("submitted", {
      ...submitted(),
      context: {
        executionProgress: progress("completed"),
        executionResult: result(),
      },
    });
    const stale = submitted();
    const merged = mergeMessages([done], [stale]);
    expect(task([...merged]).result?.images[0]?.assetId).toBe("asset-1");
    expect(assistantTaskState(task([...merged]))).toBe("completed");
    const reversed = assistantTranscript([completed(), submitted()]);
    expect(reversed.rows).toHaveLength(1);
  });

  it("模块生成结果保留，普通资料保存进入可查看的操作记录", () => {
    const generated = message("domain", {
      context: {
        creationActivity: activity("module_saved", {
          task: true,
          status: "completed",
          resultNodeIds: ["node-1"],
        }),
      },
    });
    const saved = message("record", {
      context: {
        creationActivity: activity("module_saved", {
          task: false,
          status: "completed",
          runId: "document",
          resultNodeIds: ["doc-node"],
        }),
      },
    });
    expect(assistantTranscript([generated, saved]).rows).toHaveLength(1);
    expect(assistantTranscript([generated, saved]).records).toEqual([saved]);
  });

  it("旧自动图片名只在展示时转换，用户标题和历史文字保持原样", () => {
    expect(imageDisplayTitle("候选 A")).toBe("生成图 A");
    expect(imageDisplayTitle("候选方案 2")).toBe("生成图 2");
    expect(imageDisplayTitle("我想比较这两个候选方案")).toBe(
      "我想比较这两个候选方案",
    );
    expect(imageDisplayTitle("候选系列：春日")).toBe("候选系列：春日");
  });
});
