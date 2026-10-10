/** @vitest-environment jsdom */

import type { AgentRunStepView, AgentRunView } from "@fashion/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentWorkflowPanel } from "./AgentWorkflowPanel";
import { AgentRunApiError } from "./agent-api";

const mocks = vi.hoisted(() => ({
  listAgentRuns: vi.fn(),
  fetchAgentRun: vi.fn(),
  createAgentRun: vi.fn(),
  controlAgentRun: vi.fn(),
  updateAgentRunStep: vi.fn(),
  onTaskCreated: vi.fn(),
}));
vi.mock("./agent-api", async (original) => ({
  ...(await original<typeof import("./agent-api")>()),
  ...mocks,
}));

function step(
  id: string,
  ordinal: number,
  overrides: Partial<AgentRunStepView> = {},
): AgentRunStepView {
  return {
    id,
    ordinal,
    key: id,
    tool: ordinal === 0 ? "generate_design" : "edit_design",
    title: ordinal === 0 ? "生成初版风衣" : "强化织物质感",
    instruction: "保留宽松廓形",
    prompt: ordinal === 0 ? "loose trench coat" : "woven texture",
    negativePrompt: "logos",
    sourceAssetId: null,
    sourceStepKey: ordinal === 0 ? null : "step-first",
    status: "pending",
    generationTaskId: null,
    selectedAssetId: null,
    candidates: [],
    error: null,
    ...overrides,
  };
}
function run(overrides: Partial<AgentRunView> = {}): AgentRunView {
  return {
    id: "run-a",
    projectId: "project-a",
    conversationId: "conversation-a",
    intent: "逐步设计通勤风衣",
    status: "ready",
    revision: 1,
    createdAt: "2026-10-10T01:00:00Z",
    updatedAt: "2026-10-10T01:00:00Z",
    error: null,
    steps: [step("step-first", 0), step("step-second", 1)],
    ...overrides,
  };
}
function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AgentWorkflowPanel
        conversationId="conversation-a"
        contextReady
        contextItems={null}
        initialIntent="设计通勤风衣"
        shapeIds={["shape-a"]}
        onTaskCreated={mocks.onTaskCreated}
      />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.onTaskCreated.mockResolvedValue(undefined);
  mocks.listAgentRuns.mockResolvedValue({ items: [run()] });
  mocks.fetchAgentRun.mockResolvedValue(run());
});
afterEach(cleanup);

describe("AgentWorkflowPanel", () => {
  it("否决后保留原因与原prompt，只在主动执行时跟踪新的生成任务", async () => {
    const candidate = {
      assetId: "old-asset",
      url: "/old.png",
      thumbnailUrl: null,
      width: 768,
      height: 1024,
    };
    const review = run({
      status: "waiting_review",
      revision: 2,
      steps: [
        step("step-first", 0, {
          status: "waiting_review",
          generationTaskId: "old-task",
          candidates: [candidate],
          canEditInputs: false,
        }),
        step("step-second", 1),
      ],
    });
    const rejected = run({
      revision: 3,
      steps: [
        step("step-first", 0, {
          canEditInputs: true,
          attempts: [
            {
              id: "attempt-old",
              ordinal: 1,
              status: "rejected",
              generationTaskId: "old-task",
              prompt: "original attempt prompt",
              negativePrompt: "logos",
              parentAssetId: null,
              candidates: [candidate],
              error: "袖型需要收窄",
              createdAt: review.createdAt,
            },
          ],
        }),
        step("step-second", 1),
      ],
    });
    mocks.listAgentRuns.mockResolvedValue({ items: [review] });
    mocks.fetchAgentRun.mockResolvedValue(review);
    mocks.controlAgentRun.mockResolvedValueOnce(rejected);
    renderPanel();
    const reject = await screen.findByRole("button", {
      name: "结果不满意，重新调整",
    });
    expect((reject as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "选择节点 1 的结果 1" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "选择或调整理由（否决时必填）" }),
      { target: { value: "袖型需要收窄" } },
    );
    fireEvent.click(reject);
    await screen.findByRole("button", { name: "执行下一节点" });
    expect(mocks.controlAgentRun).toHaveBeenCalledWith("run-a", "reject", {
      revision: 2,
      reason: "袖型需要收窄",
    });
    expect(mocks.controlAgentRun).toHaveBeenCalledTimes(1);
    expect(screen.getByText("调整原因：袖型需要收窄")).toBeTruthy();
    expect(screen.getByText("original attempt prompt")).toBeTruthy();
    mocks.controlAgentRun.mockResolvedValueOnce(
      run({
        status: "waiting_review",
        revision: 4,
        steps: [
          step("step-first", 0, {
            status: "waiting_review",
            generationTaskId: "new-task",
            candidates: [{ ...candidate, assetId: "new-asset" }],
            canEditInputs: false,
          }),
          step("step-second", 1),
        ],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "执行下一节点" }));
    await waitFor(() =>
      expect(mocks.onTaskCreated).toHaveBeenCalledWith("new-task"),
    );
    expect(mocks.onTaskCreated).toHaveBeenCalledWith("old-task");
    const adopt = screen.getByRole("button", {
      name: "采用结果并完成节点",
    }) as HTMLButtonElement;
    expect(adopt.disabled).toBe(true);
    expect(
      (
        screen.getByRole("textbox", {
          name: "选择或调整理由（否决时必填）",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("");
    expect(
      (
        screen.getByRole("button", {
          name: "结果不满意，重新调整",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(adopt);
    expect(mocks.controlAgentRun).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("radio", { name: "选择节点 1 的结果 1" }));
    expect(adopt.disabled).toBe(false);
    mocks.controlAgentRun.mockResolvedValueOnce(
      run({
        revision: 5,
        steps: [
          step("step-first", 0, {
            status: "succeeded",
            selectedAssetId: "new-asset",
          }),
          step("step-second", 1),
        ],
      }),
    );
    fireEvent.click(adopt);
    await waitFor(() =>
      expect(mocks.controlAgentRun).toHaveBeenCalledWith("run-a", "review", {
        revision: 4,
        assetId: "new-asset",
      }),
    );
  });
  it("规划请求仍在等待时同步planning记录，取消后晚到结果保持canceled", async () => {
    const planning = run({ status: "planning", steps: [] });
    const canceled = run({ status: "canceled", revision: 2, steps: [] });
    let completePlanning: (value: AgentRunView) => void = () => undefined;
    mocks.listAgentRuns
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValue({ items: [planning] });
    mocks.fetchAgentRun.mockResolvedValue(planning);
    mocks.createAgentRun.mockImplementationOnce(
      () =>
        new Promise<AgentRunView>((resolve) => {
          completePlanning = resolve;
        }),
    );
    mocks.controlAgentRun.mockResolvedValueOnce(canceled);
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "规划设计步骤" }),
    );
    const cancel = await screen.findByRole(
      "button",
      { name: "取消计划" },
      { timeout: 4_000 },
    );
    expect((cancel as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(cancel);
    await screen.findByText("已取消");
    await act(async () => completePlanning(canceled));
    expect(screen.getByText("已取消")).toBeTruthy();
    expect(screen.queryByText("等待执行")).toBeNull();
    expect(mocks.controlAgentRun).toHaveBeenCalledWith("run-a", "cancel", {
      revision: 1,
    });
  });
  it("刷新恢复已执行节点与正在运行任务，保持下一节点等待人工执行", async () => {
    const restored = run({
      status: "running",
      revision: 4,
      steps: [
        step("step-first", 0, {
          status: "succeeded",
          generationTaskId: "task-first",
          selectedAssetId: "asset-first",
        }),
        step("step-second", 1, {
          status: "running",
          generationTaskId: "task-second",
        }),
      ],
    });
    mocks.listAgentRuns.mockResolvedValue({ items: [restored] });
    mocks.fetchAgentRun.mockResolvedValue(restored);
    renderPanel();
    await screen.findByText("节点执行中");
    await waitFor(() =>
      expect(mocks.onTaskCreated).toHaveBeenCalledWith("task-second"),
    );
    expect(mocks.onTaskCreated).toHaveBeenCalledWith("task-first");
    expect(screen.getByText("已采用")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "执行下一节点" })).toBeNull();
    expect(mocks.controlAgentRun).not.toHaveBeenCalled();
  });

  it("未保存草稿阻止执行；保存后使用新的revision，并保留409冲突草稿", async () => {
    const updated = run({
      revision: 3,
      steps: [
        step("step-first", 0, { prompt: "server edit" }),
        step("step-second", 1),
      ],
    });
    mocks.updateAgentRunStep.mockRejectedValueOnce(
      new AgentRunApiError("工作流已在其他页面更新，请刷新状态后继续", 409),
    );
    renderPanel();
    await screen.findByText("等待执行");
    await waitFor(() => expect(mocks.fetchAgentRun).toHaveBeenCalled());
    const node = screen.getByText("生成初版风衣").closest("li");
    if (!node) throw new Error("计划缺少初版节点");
    const prompt = within(node).getByRole("textbox", {
      name: "节点提示词",
      hidden: true,
    });
    fireEvent.change(prompt, { target: { value: "designer draft" } });
    await screen.findByText("有未保存的节点提示词，请先保存后再执行。");
    expect(
      (
        screen.getByRole("button", {
          name: "执行下一节点",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    mocks.fetchAgentRun.mockResolvedValue(updated);
    fireEvent.click(
      within(node).getByRole("button", {
        name: "保存节点提示词",
        hidden: true,
      }),
    );
    await screen.findByRole("alert");
    await waitFor(() => expect(mocks.fetchAgentRun).toHaveBeenCalledTimes(2));
    expect((prompt as HTMLTextAreaElement).value).toBe("designer draft");
    mocks.updateAgentRunStep.mockResolvedValue(
      run({
        revision: 4,
        steps: [
          step("step-first", 0, { prompt: "designer draft" }),
          step("step-second", 1),
        ],
      }),
    );
    fireEvent.click(
      within(node).getByRole("button", {
        name: "保存节点提示词",
        hidden: true,
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("有未保存的节点提示词，请先保存后再执行。"),
      ).toBeNull(),
    );
    mocks.controlAgentRun.mockResolvedValue(
      run({ status: "running", revision: 5 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "执行下一节点" }));
    await waitFor(() =>
      expect(mocks.controlAgentRun).toHaveBeenCalledWith("run-a", "execute", {
        revision: 4,
      }),
    );
  });

  it("等待选择时确认第二个候选，确认后不会自动生成下一节点", async () => {
    const review = run({
      status: "waiting_review",
      revision: 2,
      steps: [
        step("step-first", 0, {
          status: "waiting_review",
          generationTaskId: "task-first",
          candidates: [
            {
              assetId: "asset-first",
              url: "/first.png",
              thumbnailUrl: null,
              width: 768,
              height: 1024,
            },
            {
              assetId: "asset-second",
              url: "/second.png",
              thumbnailUrl: null,
              width: 768,
              height: 1024,
            },
          ],
        }),
        step("step-second", 1),
      ],
    });
    mocks.listAgentRuns.mockResolvedValue({ items: [review] });
    mocks.fetchAgentRun.mockResolvedValue(review);
    mocks.controlAgentRun.mockResolvedValue(
      run({
        revision: 3,
        steps: [
          step("step-first", 0, {
            status: "succeeded",
            selectedAssetId: "asset-second",
          }),
          step("step-second", 1),
        ],
      }),
    );
    renderPanel();
    await screen.findByText("等待你选择结果");
    expect(screen.queryByRole("button", { name: "暂停计划" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "保存节点提示词", hidden: true }),
    ).toBeNull();
    const confirm = screen.getByRole("button", {
      name: "采用结果并完成节点",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "选择节点 1 的结果 2" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "选择或调整理由（否决时必填）" }),
      { target: { value: "织物更自然" } },
    );
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocks.controlAgentRun).toHaveBeenCalledWith("run-a", "review", {
        revision: 2,
        assetId: "asset-second",
        reason: "织物更自然",
      }),
    );
    await screen.findByRole("button", { name: "执行下一节点" });
    expect(mocks.controlAgentRun).toHaveBeenCalledTimes(1);
  });

  it("执行按钮双击只提交一次，暂停期间等待当前成图，取消后关闭执行入口", async () => {
    let resolveExecute: (value: AgentRunView) => void = () => undefined;
    mocks.controlAgentRun.mockImplementationOnce(
      () =>
        new Promise<AgentRunView>((resolve) => {
          resolveExecute = resolve;
        }),
    );
    renderPanel();
    const execute = await screen.findByRole("button", { name: "执行下一节点" });
    fireEvent.click(execute);
    await waitFor(() =>
      expect((execute as HTMLButtonElement).disabled).toBe(true),
    );
    fireEvent.click(execute);
    expect(mocks.controlAgentRun).toHaveBeenCalledTimes(1);
    resolveExecute(
      run({
        status: "running",
        revision: 2,
        steps: [
          step("step-first", 0, {
            status: "running",
            generationTaskId: "task-first",
          }),
          step("step-second", 1),
        ],
      }),
    );
    await screen.findByText("节点执行中");
    mocks.controlAgentRun.mockResolvedValueOnce(
      run({
        status: "paused",
        revision: 3,
        steps: [
          step("step-first", 0, {
            status: "running",
            generationTaskId: "task-first",
          }),
          step("step-second", 1),
        ],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "暂停计划" }));
    await screen.findByText("已暂停");
    expect(
      screen.queryByRole("button", { name: "继续执行下一节点" }),
    ).toBeNull();
    mocks.controlAgentRun.mockResolvedValueOnce(
      run({ status: "canceled", revision: 4 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "取消计划" }));
    await screen.findByText("已取消");
    expect(
      screen.queryByRole("button", { name: "继续执行下一节点" }),
    ).toBeNull();
  });

  it("创建计划失败后重试保留请求ID与明确选择的素材", async () => {
    mocks.listAgentRuns.mockResolvedValue({ items: [] });
    mocks.createAgentRun
      .mockRejectedValueOnce(new Error("网络中断"))
      .mockResolvedValueOnce(run());
    renderPanel();
    const create = await screen.findByRole("button", { name: "规划设计步骤" });
    fireEvent.click(create);
    await screen.findByRole("alert");
    fireEvent.click(create);
    await screen.findByText("等待执行");
    expect(mocks.createAgentRun.mock.calls[0]).toEqual(
      mocks.createAgentRun.mock.calls[1],
    );
    expect(mocks.createAgentRun).toHaveBeenCalledWith("conversation-a", {
      clientRequestId: expect.any(String),
      content: "设计通勤风衣",
      shapeIds: ["shape-a"],
      fileAssetIds: [],
    });
    expect(mocks.controlAgentRun).not.toHaveBeenCalled();
  });
});
