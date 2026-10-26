// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProposalReview } from "./ProposalReview";
import type { WorkflowGraph, WorkflowProposal } from "./workflow-api";

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(Element.prototype, "animate");
});
const graph = { nodes: [], edges: [] } as unknown as WorkflowGraph;
function review(proposal: WorkflowProposal, currentGraph = graph) {
  render(
    <ProposalReview
      proposal={proposal}
      graph={currentGraph}
      disabled={false}
      onAccept={vi.fn()}
      onReject={vi.fn()}
      onAdjust={vi.fn()}
      onOpenResult={vi.fn()}
      onContinue={vi.fn()}
    />,
  );
  return screen.getByRole("region", { name: "方案确认" });
}

it.each([
  ["generate_design", 2],
  ["edit_design", 1],
] as const)(
  "旧版 %s 提案未提供数量时，确认张数与工具默认值一致",
  (tool, count) => {
    const card = review({
      id: "proposal",
      status: "pending",
      toolNodeId: "tool",
      referencedNodeIds: [],
      content: "设计藏蓝风衣",
      operations: [
        {
          type: "add_node",
          node: {
            id: "tool",
            kind: "tool",
            type: tool,
            title: "风衣方案",
            payload: { params: { prompt: "设计藏蓝风衣" } },
            x: 0,
            y: 0,
          },
        },
      ],
    } as unknown as WorkflowProposal);
    expect(card.textContent).toContain(`${count} 张方案`);
    expect(card.textContent).toContain("768 × 1024");
    expect(
      screen.getByRole("button", { name: `确认并生成 ${count} 张` }),
    ).toBeTruthy();
    expect(card.textContent).toContain(
      tool === "edit_design" ? "基于已有方案修改" : "生成新的服装方案",
    );
  },
);

it("结果分别支持查看大图和继续修改，不重新执行生成", () => {
  const onAccept = vi.fn();
  const onContinue = vi.fn();
  const onOpenResult = vi.fn();
  const resultGraph = {
    nodes: [
      {
        id: "tool",
        type: "generate_design",
        status: "completed",
        payload: { params: {} },
      },
      {
        id: "result",
        kind: "asset",
        type: "candidate",
        title: "藏蓝风衣",
        payload: { imageUrl: "/result.png" },
      },
    ],
    edges: [{ sourceNodeId: "tool", targetNodeId: "result" }],
  } as unknown as WorkflowGraph;
  render(
    <ProposalReview
      graph={resultGraph}
      proposal={
        {
          id: "p",
          status: "accepted",
          toolNodeId: "tool",
          operations: [],
          referencedNodeIds: [],
        } as unknown as WorkflowProposal
      }
      disabled={false}
      onAccept={onAccept}
      onReject={vi.fn()}
      onAdjust={vi.fn()}
      onOpenResult={onOpenResult}
      onContinue={onContinue}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "查看大图：藏蓝风衣" }));
  fireEvent.click(screen.getByRole("button", { name: "继续修改：藏蓝风衣" }));
  expect(onOpenResult).toHaveBeenCalledWith("result");
  expect(onContinue).toHaveBeenCalledWith("result");
  expect(onAccept).not.toHaveBeenCalled();
});

it("旧版修改提案展示即将应用的数量和要求，不显示原节点旧参数", () => {
  const card = review(
    {
      id: "proposal",
      status: "pending",
      toolNodeId: "tool",
      referencedNodeIds: [],
      content: "修改方案",
      operations: [
        {
          type: "update_node",
          nodeId: "tool",
          payload: { params: { count: 3, prompt: "保留肩线" } },
        },
      ],
    } as unknown as WorkflowProposal,
    {
      nodes: [
        {
          id: "tool",
          kind: "tool",
          type: "generate_design",
          payload: { params: { count: 2, prompt: "原版型" } },
        },
      ],
      edges: [],
    } as unknown as WorkflowGraph,
  );
  expect(card.textContent).toContain("3 张方案");
  expect(card.textContent).toContain("保留肩线");
  expect(card.textContent).not.toContain("原版型");
});

function motionReview() {
  const proposal = {
    id: "submission-proposal",
    status: "pending",
    toolNodeId: "tool",
    operations: [],
    referencedNodeIds: [],
    content: "设计藏蓝风衣",
  } as unknown as WorkflowProposal;
  const currentGraph = {
    nodes: [{ id: "tool", kind: "tool", type: "generate_design", status: "ready", payload: { params: {} } }],
    edges: [],
  } as unknown as WorkflowGraph;
  return {
    proposal,
    graph: currentGraph,
    disabled: false,
    onAccept: vi.fn(),
    onReject: vi.fn(),
    onAdjust: vi.fn(),
    onOpenResult: vi.fn(),
    onContinue: vi.fn(),
  };
}

function mockReceiptMotion(reduced = false) {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: reduced && query === "(prefers-reduced-motion: reduce)",
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });
  return { animate, cancel };
}

it("确认立即调用业务，提交超过 300ms 后显示匹配该提案的等待装饰", () => {
  vi.useFakeTimers();
  const props = motionReview();
  const view = render(<ProposalReview {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "确认并生成 2 张" }));
  expect(props.onAccept).toHaveBeenCalledTimes(1);
  view.rerender(<ProposalReview {...props} submitting />);
  const button = screen.getByRole("button", { name: "提交中…" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.dataset.feedback).toBe("pending");
  expect(button.querySelector('[data-phase="pending"]')).toBeNull();
  act(() => { vi.advanceTimersByTime(299); });
  expect(button.querySelector('[data-phase="pending"]')).toBeNull();
  act(() => { vi.advanceTimersByTime(1); });
  expect(button.querySelector('[data-phase="pending"]')).not.toBeNull();
  fireEvent.click(button);
  expect(props.onAccept).toHaveBeenCalledTimes(1);
});

it("本次待确认到受理只描一次 350ms 小勾，立即运行与后续轮询不延迟或重播", () => {
  vi.useFakeTimers();
  const { animate, cancel } = mockReceiptMotion();
  const props = motionReview();
  const view = render(<ProposalReview {...props} />);
  const receipt = view.container.querySelector<HTMLSpanElement>("[data-proposal-accepted]");
  if (!receipt) throw new Error("Missing acceptance receipt");
  expect(receipt.hidden).toBe(true);
  const accepted = { ...props.proposal, status: "accepted" } as WorkflowProposal;
  const running = { ...props.graph, nodes: props.graph.nodes.map((node) => ({ ...node, status: "running" })) } as WorkflowGraph;
  view.rerender(<ProposalReview {...props} proposal={accepted} graph={running} />);
  expect(receipt.hidden).toBe(false);
  expect(receipt.textContent).toContain("已受理");
  expect(view.container.querySelector('header [role="status"]')?.textContent).toBe("生成中");
  expect(screen.queryByText("已完成")).toBeNull();
  expect(animate).toHaveBeenCalledTimes(1);
  expect(animate).toHaveBeenCalledWith([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], expect.objectContaining({ duration: 350 }));
  view.rerender(<ProposalReview {...props} proposal={{ ...accepted }} graph={{ ...running }} />);
  expect(animate).toHaveBeenCalledTimes(1);
  expect(props.onAccept).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(1000); });
  expect(receipt.hidden).toBe(true);
  view.unmount();
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("历史已受理初载和替换为另一已受理提案均不播放成功确认", () => {
  const { animate } = mockReceiptMotion();
  const props = motionReview();
  const accepted = { ...props.proposal, status: "accepted" } as WorkflowProposal;
  const view = render(<ProposalReview {...props} proposal={accepted} />);
  expect(view.container.querySelector<HTMLSpanElement>("[data-proposal-accepted]")?.hidden).toBe(true);
  expect(screen.getByRole("status").textContent).toBe("已保存，待执行");
  view.rerender(<ProposalReview {...props} />);
  view.rerender(<ProposalReview {...props} proposal={{ ...accepted, id: "another" }} />);
  expect(view.container.querySelector<HTMLSpanElement>("[data-proposal-accepted]")?.hidden).toBe(true);
  expect(animate).not.toHaveBeenCalled();
});

it("减弱动态时受理结果立即可见，不描勾或等待动画", () => {
  const { animate } = mockReceiptMotion(true);
  const props = motionReview();
  const view = render(<ProposalReview {...props} />);
  view.rerender(<ProposalReview {...props} proposal={{ ...props.proposal, status: "accepted" }} />);
  expect(view.container.querySelector<HTMLSpanElement>("[data-proposal-accepted]")?.hidden).toBe(false);
  expect(screen.getByRole("status").textContent).toBe("已保存，待执行");
  expect(animate).not.toHaveBeenCalled();
});
