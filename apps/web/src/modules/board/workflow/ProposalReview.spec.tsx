// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProposalReview } from "./ProposalReview";
import type { WorkflowGraph, WorkflowProposal } from "./workflow-api";

afterEach(cleanup);
const graph = { nodes: [], edges: [] } as unknown as WorkflowGraph;
function review(proposal: WorkflowProposal, currentGraph = graph) {
  render(<ProposalReview proposal={proposal} graph={currentGraph} disabled={false} onAccept={vi.fn()} onReject={vi.fn()} onAdjust={vi.fn()} onOpenResult={vi.fn()} />);
  return screen.getByRole("region", { name: "方案确认" });
}

it.each([["generate_design", 2], ["edit_design", 1]] as const)("旧版 %s 提案未提供数量时，确认张数与工具默认值一致", (tool, count) => {
  const card = review({
    id: "proposal", status: "pending", toolNodeId: "tool", referencedNodeIds: [], content: "设计藏蓝风衣",
    operations: [{ type: "add_node", node: { id: "tool", kind: "tool", type: tool, title: "风衣方案", payload: { params: { prompt: "设计藏蓝风衣" } }, x: 0, y: 0 } }],
  } as unknown as WorkflowProposal);
  expect(card.textContent).toContain(`${count} 张方案`);
  expect(card.textContent).toContain("768 × 1024");
});

it("旧版修改提案展示即将应用的数量和要求，不显示原节点旧参数", () => {
  const card = review({
    id: "proposal", status: "pending", toolNodeId: "tool", referencedNodeIds: [], content: "修改方案",
    operations: [{ type: "update_node", nodeId: "tool", payload: { params: { count: 3, prompt: "保留肩线" } } }],
  } as unknown as WorkflowProposal, {
    nodes: [{ id: "tool", kind: "tool", type: "generate_design", payload: { params: { count: 2, prompt: "原版型" } } }], edges: [],
  } as unknown as WorkflowGraph);
  expect(card.textContent).toContain("3 张方案");
  expect(card.textContent).toContain("保留肩线");
  expect(card.textContent).not.toContain("原版型");
});
