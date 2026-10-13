/** @vitest-environment jsdom */

import type {
  AgentDesignIntelligence,
  AgentDomainActionView,
  AgentRunStepView,
  AgentRunView,
} from "@fashion/shared";
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
  requestAgentDomainAction: vi.fn(),
  applyAgentDomainAction: vi.fn(),
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
function intelligence(
  actions: readonly AgentDomainActionView[] = [],
): AgentDesignIntelligence {
  return {
    version: "fashion-agents/1",
    brief: {
      summary: "围绕宽松通勤风衣，先确认廓形再修正面料表现",
      garmentType: "风衣",
      constraints: [
        {
          id: "c-shape",
          dimension: "silhouette",
          requirement: "保留宽松廓形",
          mode: "preserve",
          priority: "must",
          origin: "explicit",
          verification: "visual",
          evidenceIds: ["e-intent"],
          sourceQuote: "保留宽松廓形",
        },
        {
          id: "c-fabric",
          dimension: "material",
          requirement: "面料表面应呈哑光",
          mode: "change",
          priority: "prefer",
          origin: "interpretation",
          verification: "visual",
          evidenceIds: ["e-intent"],
          sourceQuote: null,
        },
        {
          id: "c-water",
          dimension: "function",
          requirement: "确认防水性能",
          mode: "require",
          priority: "must",
          origin: "explicit",
          verification: "requires_measurement",
          evidenceIds: ["e-intent"],
          sourceQuote: "防水",
        },
      ],
      unknowns: ["尚未提供面料性能检测资料"],
    },
    evidence: [
      {
        id: "e-intent",
        kind: "intent",
        label: "本次设计需求",
        text: "通勤风衣，保留宽松廓形并确认防水",
        assetId: null,
      },
    ],
    rationales: [
      {
        stepKey: "step-first",
        goal: "先稳定宽松比例",
        constraintIds: ["c-shape"],
        acceptanceChecks: ["检查肩部与腰线是否仍有宽松余量"],
      },
    ],
    audit: {
      coverage: [
        {
          constraintId: "c-shape",
          stepKeys: ["step-first"],
          status: "assigned",
        },
        { constraintId: "c-water", stepKeys: [], status: "unassigned" },
      ],
      warnings: ["防水性能不能单凭图像确认"],
    },
    actions,
  };
}
function domainAction(
  overrides: Partial<AgentDomainActionView> = {},
): AgentDomainActionView {
  return {
    id: "action-refine",
    kind: "refine_step",
    stepId: "step-first",
    assetId: null,
    status: "completed",
    createdAt: "2026-10-10T02:00:00Z",
    completedAt: "2026-10-10T02:00:01Z",
    error: null,
    evaluation: null,
    refinement: {
      stepId: "step-first",
      attemptId: "attempt-first",
      originalPrompt: "loose trench coat",
      originalNegativePrompt: "logos",
      prompt: "loose trench coat with matte woven fabric",
      negativePrompt: "logos, glossy coating",
      summary: "减弱反光，同时维持原廓形",
      changes: ["改为哑光织物表面"],
      preserve: ["继续保留宽松比例"],
    },
    ...overrides,
  };
}
function reviewedStep(
  status: "waiting_review" | "rejected" = "waiting_review",
): AgentRunStepView {
  const candidate = {
    assetId: "asset-current",
    url: "/current.png",
    thumbnailUrl: null,
    width: 768,
    height: 1024,
  };
  return step("step-first", 0, {
    status: status === "rejected" ? "pending" : status,
    generationTaskId: status === "rejected" ? null : "task-first",
    canEditInputs: status === "rejected",
    candidates: status === "rejected" ? [] : [candidate],
    attempts: [
      {
        id: "attempt-first",
        ordinal: 1,
        status,
        generationTaskId: "task-first",
        prompt: "original visual attempt",
        negativePrompt: "logos",
        parentAssetId: null,
        candidates: [candidate],
        error: status === "rejected" ? "面料反光过强" : null,
        createdAt: "2026-10-10T01:30:00Z",
      },
    ],
  });
}
function evaluationAction(
  overrides: Partial<AgentDomainActionView> = {},
): AgentDomainActionView {
  return domainAction({
    id: "action-evaluate",
    kind: "evaluate_candidate",
    assetId: "asset-current",
    refinement: null,
    evaluation: {
      stepId: "step-first",
      attemptId: "attempt-first",
      assetId: "asset-current",
      summary: "廓形稳定，面料与性能仍需核查",
      checks: [
        {
          constraintId: "c-shape",
          status: "met",
          observation: "肩部与腰线留有明显余量",
        },
        {
          constraintId: "c-fabric",
          status: "concern",
          observation: "衣身出现较强镜面反光",
        },
        {
          constraintId: "c-water",
          status: "unknown",
          observation: "图像无法验证防水性能",
        },
      ],
      nextActions: ["确认实物材料检测结果"],
    },
    ...overrides,
  });
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
  it("技术失败的分析保持原输入，不提供无变化的应用按钮，仍可主动重试执行", async () => {
    const failedStep = {
      ...reviewedStep("rejected"),
      status: "failed" as const,
      error: "队列服务暂不可用",
      attempts: (reviewedStep("rejected").attempts ?? []).map((attempt) => ({
        ...attempt,
        status: "failed" as const,
        error: "队列服务暂不可用",
      })),
    };
    const baseRefinement = domainAction().refinement;
    if (!baseRefinement) throw new Error("测试修订建议缺失");
    const advice = domainAction({
      refinement: {
        ...baseRefinement,
        prompt: "loose trench coat",
        negativePrompt: "logos",
        changes: [],
        summary: "先处理队列服务，再重试当前节点",
      },
    });
    const failed = run({
      status: "failed",
      revision: 3,
      steps: [failedStep, step("step-second", 1)],
      intelligence: intelligence([advice]),
    });
    mocks.listAgentRuns.mockResolvedValue({ items: [failed] });
    mocks.fetchAgentRun.mockResolvedValue(failed);
    renderPanel();
    await screen.findByText("先处理队列服务，再重试当前节点");
    expect(screen.queryByRole("button", { name: "应用修订建议" })).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "重试当前节点",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(mocks.applyAgentDomainAction).not.toHaveBeenCalled();
  });
  it("区分明确要求、Agent解释、未知与未绑定条件，并展示节点依据而非结果结论", async () => {
    const informed = run({ intelligence: intelligence() });
    mocks.listAgentRuns.mockResolvedValue({ items: [informed] });
    mocks.fetchAgentRun.mockResolvedValue(informed);
    renderPanel();
    fireEvent.click(await screen.findByText("设计简报 · 3 项条件"));
    expect(screen.getByText("你明确提出的要求")).toBeTruthy();
    expect(screen.getByText("Agent 对需求的解释")).toBeTruthy();
    expect(screen.getByText("尚未提供面料性能检测资料")).toBeTruthy();
    expect(screen.getByText("计划尚未绑定的要求")).toBeTruthy();
    expect(screen.getByText("需要测量确认")).toBeTruthy();
    expect(
      screen.getByText(
        "节点绑定表示计划覆盖这些条件，实际结果仍需逐项检查并由你确认。",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("查看来源证据"));
    expect(screen.getByText("通勤风衣，保留宽松廓形并确认防水")).toBeTruthy();
    fireEvent.click(screen.getByText("本节点的设计依据"));
    expect(screen.getByText("先稳定宽松比例")).toBeTruthy();
    expect(screen.getByText("检查肩部与腰线是否仍有宽松余量")).toBeTruthy();
    expect(mocks.requestAgentDomainAction).not.toHaveBeenCalled();
  });
  it("检查绑定当前真实候选，双击去重；网络不确定重试复用请求ID且不代替人工采用", async () => {
    const current = run({
      status: "waiting_review",
      revision: 2,
      intelligence: intelligence(),
      steps: [reviewedStep(), step("step-second", 1)],
    });
    const checked = {
      ...current,
      revision: 3,
      intelligence: intelligence([evaluationAction()]),
    };
    mocks.listAgentRuns.mockResolvedValue({ items: [current] });
    mocks.fetchAgentRun.mockResolvedValue(current);
    mocks.requestAgentDomainAction
      .mockRejectedValueOnce(new Error("网络中断"))
      .mockResolvedValueOnce(checked);
    renderPanel();
    const check = await screen.findByRole("button", {
      name: "领域 Agent 检查",
    });
    fireEvent.click(check);
    fireEvent.click(check);
    await screen.findByRole("alert");
    expect(mocks.requestAgentDomainAction).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "领域 Agent 检查" }));
    await screen.findByText("图像观察符合");
    expect(mocks.requestAgentDomainAction.mock.calls[0]).toEqual(
      mocks.requestAgentDomainAction.mock.calls[1],
    );
    expect(mocks.requestAgentDomainAction).toHaveBeenLastCalledWith("run-a", {
      revision: 2,
      clientRequestId: expect.any(String),
      kind: "evaluate_candidate",
      stepId: "step-first",
      assetId: "asset-current",
    });
    expect(screen.getByText("发现偏离")).toBeTruthy();
    expect(screen.getByText("待确认")).toBeTruthy();
    expect(screen.queryByText("已采用")).toBeNull();
    expect(mocks.controlAgentRun).not.toHaveBeenCalled();
  });
  it("刷新恢复running领域动作并持续轮询，分析期间人工采用仍可操作", async () => {
    const waiting = run({
      status: "waiting_review",
      revision: 2,
      intelligence: intelligence([
        evaluationAction({ status: "running", evaluation: null }),
      ]),
      steps: [reviewedStep(), step("step-second", 1)],
    });
    mocks.listAgentRuns.mockResolvedValue({ items: [waiting] });
    mocks.fetchAgentRun.mockResolvedValueOnce(waiting).mockResolvedValue({
      ...waiting,
      revision: 3,
      intelligence: intelligence([evaluationAction()]),
    });
    renderPanel();
    await screen.findByText("领域 Agent 分析中");
    expect(
      (screen.getByRole("button", { name: "检查中…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "选择节点 1 的结果 1" }));
    expect(
      (
        screen.getByRole("button", {
          name: "采用结果并完成节点",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    await screen.findByText("发现偏离", {}, { timeout: 4_000 });
    expect(mocks.fetchAgentRun).toHaveBeenCalledTimes(2);
    expect(mocks.requestAgentDomainAction).not.toHaveBeenCalled();
  });
  it("明确失败后主动再试使用新请求ID；修订先预览，草稿阻止应用，显式应用不生成", async () => {
    const current = run({
      revision: 2,
      intelligence: intelligence(),
      steps: [reviewedStep("rejected"), step("step-second", 1)],
    });
    const failed = {
      ...current,
      revision: 3,
      intelligence: intelligence([
        domainAction({
          status: "failed",
          refinement: null,
          error: "分析服务暂不可用",
        }),
      ]),
    };
    const suggested = {
      ...current,
      revision: 4,
      intelligence: intelligence([domainAction()]),
    };
    mocks.listAgentRuns.mockResolvedValue({ items: [current] });
    mocks.fetchAgentRun.mockResolvedValue(current);
    mocks.requestAgentDomainAction
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(suggested);
    mocks.applyAgentDomainAction.mockResolvedValueOnce({
      ...suggested,
      revision: 5,
      steps: [
        {
          ...reviewedStep("rejected"),
          prompt: "loose trench coat with matte woven fabric",
          negativePrompt: "logos, glossy coating",
        },
        step("step-second", 1),
      ],
      intelligence: intelligence([domainAction({ status: "applied" })]),
    });
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "根据反馈提出修订" }),
    );
    await screen.findByText("分析失败，可重新尝试");
    fireEvent.click(screen.getByRole("button", { name: "重新提出修订" }));
    await screen.findByText("建议提示词");
    expect(
      mocks.requestAgentDomainAction.mock.calls[0]?.[1].clientRequestId,
    ).not.toBe(
      mocks.requestAgentDomainAction.mock.calls[1]?.[1].clientRequestId,
    );
    expect(screen.getByText("继续保留宽松比例")).toBeTruthy();
    expect(
      screen.getByText("loose trench coat with matte woven fabric"),
    ).toBeTruthy();
    expect(mocks.applyAgentDomainAction).not.toHaveBeenCalled();
    const node = screen.getByText("生成初版风衣").closest("li");
    if (!node) throw new Error("缺少初版节点");
    const prompt = within(node).getByRole("textbox", {
      name: "节点提示词",
      hidden: true,
    });
    fireEvent.change(prompt, { target: { value: "unsaved personal prompt" } });
    await screen.findByText("请先保存节点修改，再请求或应用修订建议。");
    const apply = screen.getByRole("button", {
      name: "应用修订建议",
    }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.change(prompt, { target: { value: "loose trench coat" } });
    await waitFor(() => expect(apply.disabled).toBe(false));
    fireEvent.click(apply);
    fireEvent.click(apply);
    await screen.findByText("建议已应用");
    expect(mocks.applyAgentDomainAction).toHaveBeenCalledTimes(1);
    expect(mocks.applyAgentDomainAction).toHaveBeenCalledWith(
      "run-a",
      "action-refine",
      { revision: 4 },
    );
    expect((prompt as HTMLTextAreaElement).value).toBe(
      "loose trench coat with matte woven fabric",
    );
    expect(mocks.controlAgentRun).not.toHaveBeenCalled();
    expect(mocks.onTaskCreated).not.toHaveBeenCalled();
  });
  it("应用409后恢复已失效状态，保留报告并禁止覆盖修改后的提示词", async () => {
    const initial = run({
      revision: 4,
      intelligence: intelligence([domainAction()]),
      steps: [reviewedStep("rejected"), step("step-second", 1)],
    });
    const newer = {
      ...initial,
      revision: 5,
      steps: [
        { ...reviewedStep("rejected"), prompt: "saved by designer elsewhere" },
        step("step-second", 1),
      ],
      intelligence: intelligence([domainAction({ status: "superseded" })]),
    };
    mocks.listAgentRuns.mockResolvedValue({ items: [initial] });
    mocks.fetchAgentRun.mockResolvedValueOnce(initial).mockResolvedValue(newer);
    mocks.applyAgentDomainAction.mockRejectedValueOnce(
      new AgentRunApiError("工作流已在其他页面更新，请刷新状态后继续", 409),
    );
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "应用修订建议" }),
    );
    await screen.findByText("建议已失效，节点或结果已经更新");
    expect(screen.queryByRole("button", { name: "应用修订建议" })).toBeNull();
    expect(screen.getByText("减弱反光，同时维持原廓形")).toBeTruthy();
    expect(mocks.applyAgentDomainAction).toHaveBeenCalledTimes(1);
  });
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
