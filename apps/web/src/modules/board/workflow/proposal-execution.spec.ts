import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptAndExecuteProposal, proposalExecutionId } from "./proposal-execution";
import { decideWorkflowProposal, executeWorkflowNode, fetchWorkflow, type WorkflowGraph, type WorkflowProposal } from "./workflow-api";

vi.mock("./workflow-api", () => ({ decideWorkflowProposal: vi.fn(), executeWorkflowNode: vi.fn(), fetchWorkflow: vi.fn() }));
const proposal = { id: "proposal-a", toolNodeId: "tool-a", status: "pending" } as WorkflowProposal;
const graph = (status = "ready") => ({ nodes: [{ id: "tool-a", kind: "tool", status, updatedAt: "2026-10-25T00:00:00Z" }], edges: [] }) as unknown as WorkflowGraph;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(decideWorkflowProposal).mockResolvedValue(graph());
  vi.mocked(fetchWorkflow).mockResolvedValue(graph());
  vi.mocked(executeWorkflowNode).mockResolvedValue(graph("running"));
});

describe("助手确认与执行", () => {
  it("只在接受成功后执行，并传递原对话与稳定幂等键", async () => {
    const saved = vi.fn();
    const result = await acceptAndExecuteProposal("project", proposal, "conversation", saved);
    expect(saved).toHaveBeenCalledWith(graph());
    expect(executeWorkflowNode).toHaveBeenCalledWith("project", "tool-a", "conversation", await proposalExecutionId("project:proposal-a:initial"));
    expect(result.nodes[0]?.status).toBe("running");
  });
  it("接受失败不执行", async () => {
    vi.mocked(decideWorkflowProposal).mockRejectedValue(new Error("方案已失效"));
    await expect(acceptAndExecuteProposal("project", proposal, "conversation", vi.fn())).rejects.toThrow("方案已失效");
    expect(executeWorkflowNode).not.toHaveBeenCalled();
  });
  it("执行响应丢失后保留接受结果，重新打开仍用同一个幂等键恢复", async () => {
    const saved = vi.fn();
    vi.mocked(executeWorkflowNode).mockRejectedValueOnce(new Error("网络中断"));
    await expect(acceptAndExecuteProposal("project", proposal, "conversation", saved)).rejects.toThrow("网络中断");
    expect(saved).toHaveBeenCalledOnce();
    await acceptAndExecuteProposal("project", { ...proposal, status: "accepted" }, "conversation", saved);
    expect(decideWorkflowProposal).toHaveBeenCalledOnce();
    expect(vi.mocked(executeWorkflowNode).mock.calls[0]).toEqual(vi.mocked(executeWorkflowNode).mock.calls[1]);
  });
  it.each(["running", "completed", "pending"])("同步已是 %s 时不重新执行", async (status) => {
    vi.mocked(fetchWorkflow).mockResolvedValue(graph(status));
    await acceptAndExecuteProposal("project", { ...proposal, status: "accepted" }, "conversation", vi.fn());
    expect(executeWorkflowNode).not.toHaveBeenCalled();
  });
  it("缺失节点时保留方案并报告错误，不发起无目标执行", async () => {
    vi.mocked(decideWorkflowProposal).mockResolvedValue({ ...graph(), nodes: [] });
    const saved = vi.fn();
    await expect(acceptAndExecuteProposal("project", proposal, "conversation", saved)).rejects.toThrow("执行步骤不可用");
    expect(saved).toHaveBeenCalledOnce();
    expect(executeWorkflowNode).not.toHaveBeenCalled();
  });
  it("确认为失败的尝试允许新执行，但同一次重试键稳定", async () => {
    vi.mocked(fetchWorkflow).mockResolvedValue(graph("failed"));
    await acceptAndExecuteProposal("project", { ...proposal, status: "accepted" }, "conversation", vi.fn());
    const key = vi.mocked(executeWorkflowNode).mock.calls[0]?.[3];
    expect(key).not.toBe(await proposalExecutionId("project:proposal-a:initial"));
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
