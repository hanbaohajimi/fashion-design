import { describe, expect, it } from "vitest";
import type { WorkflowMessageView } from "../agent/agent-api";
import {
  mergeMessages,
  executionObservationKey,
} from "./conversation-messages";
import type {
  CreationActivity,
  WorkflowExecutionProgress,
  WorkflowProposalExecution,
} from "@fashion/shared";

const item = (
  id: string,
  changes: Partial<WorkflowMessageView> = {},
): WorkflowMessageView =>
  ({
    id,
    role: "assistant",
    status: "completed",
    content: id,
    updatedAt: "2026-11-09T12:00:00Z",
    ...changes,
  }) as WorkflowMessageView;

describe("conversation page merging", () => {
  it("迟到的模块状态不覆盖已经观察到的真实产物", () => {
    const activity: CreationActivity = { creationId: "target", runId: "experiment", event: "submitted", title: "换色实验", prompt: "蓝色", inputNodeIds: ["source"], resultNodeId: null, status: "completed", resultNodeIds: ["result"], updatedAt: "2026-11-14T10:00:00Z" };
    const previous = item("receipt", { context: { creationActivity: activity } });
    const incoming = item("receipt", { context: { creationActivity: { ...activity, status: "queued", resultNodeIds: [], updatedAt: "2026-11-14T09:00:00Z" } } });
    expect(mergeMessages([previous], [incoming])[0]?.context?.creationActivity).toEqual(activity);
  });

  it("prepends older messages while preserving the newer version at overlapping boundaries", () => {
    const current = [item("50"), item("51")];
    const merged = mergeMessages(
      current,
      [
        item("49"),
        item("50", { content: "older", updatedAt: "2026-11-09T11:00:00Z" }),
      ],
      true,
    );
    expect(merged.map((message) => message.id)).toEqual(["49", "50", "51"]);
    expect(merged[1]).toBe(current[0]);
  });
  it("does not revive pending replies or accepted proposals from a stale page", () => {
    const current = [
      item("one", {
        proposal: { id: "p", status: "accepted" } as NonNullable<
          WorkflowMessageView["proposal"]
        >,
      }),
    ];
    expect(mergeMessages(current, [item("one", { status: "pending" })])).toBe(
      current,
    );
    expect(
      mergeMessages(current, [
        item("one", {
          proposal: { id: "p", status: "pending" } as NonNullable<
            WorkflowMessageView["proposal"]
          >,
        }),
      ]),
    ).toBe(current);
  });
  it("applies fresher changes while retaining reference and object identity for unchanged messages", () => {
    const current = [item("one"), item("two", { status: "pending" })];
    const merged = mergeMessages(current, [
      item("two", { content: "完成分析" }),
      item("three"),
    ]);
    expect(merged[0]).toBe(current[0]);
    expect(merged[1]?.content).toBe("完成分析");
    expect(merged.map((message) => message.id)).toEqual([
      "one",
      "two",
      "three",
    ]);
  });
  it("deduplicates overlapping and repeated pages without triggering a redraw", () => {
    const current = [item("a")];
    expect(mergeMessages(current, [item("a"), item("a")])).toBe(current);
    const merged = mergeMessages(
      current,
      [item("b"), item("b"), item("a")],
      true,
    );
    expect(merged.map((message) => message.id)).toEqual(["b", "a"]);
    expect(mergeMessages(merged, [item("b"), item("a")], true)).toBe(merged);
  });
});

const progress = (
  status: WorkflowExecutionProgress["status"],
  time: string,
): WorkflowExecutionProgress => ({
  version: 1,
  executionId: "execution",
  toolNodeId: "tool",
  title: "设计",
  operation: "image",
  status,
  updatedAt: time,
  counts: {
    total: 1,
    completed: status === "completed" ? 1 : 0,
    queued: status === "queued" ? 1 : 0,
    running: 0,
    preparing: 0,
    failed: 0,
    canceled: 0,
  },
  cancelTaskIds: status === "queued" ? ["task"] : [],
});
it("消息本身时间相同也不能让旧历史页回退真实终态", () => {
  const current = item("one", {
    executionId: "execution",
    context: {
      executionProgress: progress("completed", "2026-11-10T10:00:00Z"),
    },
  });
  const old = item("one", {
    executionId: "execution",
    context: { executionProgress: progress("queued", "2026-11-10T09:00:00Z") },
  });
  expect(
    mergeMessages([current], [old])[0]?.context?.executionProgress?.status,
  ).toBe("completed");
  expect(
    mergeMessages(
      [current],
      [item("one", { executionId: "execution", context: {} })],
    )[0]?.context?.executionProgress?.status,
  ).toBe("completed");
});
it("进度数量与排队切换不误报新结果，明确的关联终态才改变结果标识", () => {
  const queued = item("one", {
    executionId: "execution",
    context: { executionProgress: progress("queued", "2026-11-10T09:00:00Z") },
  });
  const running = item("one", {
    executionId: "execution",
    context: { executionProgress: progress("running", "2026-11-10T10:00:00Z") },
  });
  const completed = item("one", {
    executionId: "execution",
    context: {
      executionProgress: progress("completed", "2026-11-10T11:00:00Z"),
    },
  });
  expect(executionObservationKey(queued)).toBe(
    executionObservationKey(running),
  );
  expect(executionObservationKey(completed)).not.toBe(
    executionObservationKey(running),
  );
});

it("损坏或旧格式执行摘要不产生虚构结果标识，也不打断聊天", () => {
  const message = item("one", { proposal: { id: "proposal", status: "accepted", execution: { progress: progress("completed", "2026-11-10T11:00:00Z"), result: { images: "damaged" } } } as unknown as NonNullable<WorkflowMessageView["proposal"]> });
  expect(() => executionObservationKey(message)).not.toThrow();
  expect(executionObservationKey(message)).toBe("execution:completed:");
});

it("确认版本变化仍能收到原执行的新终态，同时保持不可重新执行", () => {
  const execution: WorkflowProposalExecution = {
    version: 1,
    binding: "changed",
    nodeVersionId: "version",
    canExecute: false,
    progress: progress("queued", "2026-11-10T09:00:00Z"),
    result: null,
  };
  const current = item("one", {
    proposal: { id: "p", status: "accepted", execution } as NonNullable<
      WorkflowMessageView["proposal"]
    >,
  });
  const update = item("one", {
    proposal: {
      ...current.proposal,
      execution: {
        ...execution,
        binding: "linked",
        progress: progress("completed", "2026-11-10T10:00:00Z"),
      },
    } as NonNullable<WorkflowMessageView["proposal"]>,
  });
  expect(
    mergeMessages([current], [update])[0]?.proposal?.execution,
  ).toMatchObject({
    binding: "changed",
    canExecute: false,
    progress: { status: "completed" },
  });
});
it("确认版本变化和权限限制不能被迟到页重新启用", () => {
  const execution: WorkflowProposalExecution = {
    version: 1,
    binding: "changed",
    nodeVersionId: "version",
    canExecute: false,
    progress: progress("failed", "2026-11-10T10:00:00Z"),
    result: null,
  };
  const current = item("one", {
    proposal: { id: "p", status: "accepted", execution } as NonNullable<
      WorkflowMessageView["proposal"]
    >,
  });
  const old = item("one", {
    proposal: {
      ...current.proposal,
      execution: {
        ...execution,
        binding: "not_started",
        canExecute: true,
        progress: null,
      },
    } as NonNullable<WorkflowMessageView["proposal"]>,
  });
  expect(mergeMessages([current], [old])[0]?.proposal?.execution).toMatchObject(
    { binding: "changed", canExecute: false, progress: { status: "failed" } },
  );
});
