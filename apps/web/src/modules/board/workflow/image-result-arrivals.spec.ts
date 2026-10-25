import { describe, expect, it } from "vitest";
import { ImageResultArrivals } from "./image-result-arrivals";
import type { WorkflowGraph, WorkflowNode } from "./workflow-api";
const node = (id: string, executionId = "batch-a"): WorkflowNode => ({
  id,
  kind: "asset",
  type: "candidate",
  title: id,
  payload: { assetId: id, executionId },
  status: "completed",
  x: 0,
  y: 0,
  createdAt: "",
  updatedAt: "",
});
const graph = (
  nodes: WorkflowNode[],
  type: WorkflowNode["type"] = "generate_design",
  projectId = "p",
): WorkflowGraph => ({
  projectId,
  revision: 1,
  layoutRevision: 0,
  legacyAvailable: false,
  nodes: [{ ...node("tool"), kind: "tool", type }, ...nodes],
  edges: nodes.map((n) => ({
    id: n.id,
    sourceNodeId: "tool",
    targetNodeId: n.id,
    sourcePort: "out",
    targetPort: "source",
  })),
});
describe("图片结果到达", () => {
  it("历史不打开，首张打开，同批后续和重复同步不打开", () => {
    const state = new ImageResultArrivals();
    expect(state.observe(graph([node("old", "old-batch")])).first).toBeNull();
    expect(
      state.observe(graph([node("old", "old-batch"), node("a")])).first?.id,
    ).toBe("a");
    expect(
      state.observe(graph([node("old", "old-batch"), node("a"), node("b")]))
        .first,
    ).toBeNull();
    expect(state.observe(graph([node("a"), node("b")])).fresh).toEqual([]);
    expect(state.observe(graph([node("c", "batch-b")])).first?.id).toBe("c");
  });
  it("恢复和导入不触发；换项目和刷新重新建立基线", () => {
    const state = new ImageResultArrivals();
    state.observe(graph([]));
    expect(
      state.observe(graph([node("restored")], "restore_version")).fresh,
    ).toEqual([]);
    expect(
      state.observe({ ...graph([node("imported")]), edges: [] }).fresh,
    ).toEqual([]);
    expect(
      state.observe(graph([node("other")], "generate_design", "other")).first,
    ).toBeNull();
  });
  it("失败结果不会展示，基线中的进行中任务完成后能展示", () => {
    const state = new ImageResultArrivals();
    state.observe(graph([]));
    expect(
      state.observe(graph([{ ...node("a"), status: "failed" }])).first,
    ).toBeNull();
    expect(state.observe(graph([node("a")])).first?.id).toBe("a");
  });
});
