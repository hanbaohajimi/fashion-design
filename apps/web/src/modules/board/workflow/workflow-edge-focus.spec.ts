import { describe, expect, it } from "vitest";
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from "./workflow-api";
import { edgeRelation, focusPathOf } from "./workflow-graph";

const node = (
  id: string,
  kind: WorkflowNode["kind"] = "asset",
): WorkflowNode => ({
  id,
  kind,
  type: kind === "tool" ? "edit_design" : "candidate",
  title: id,
  payload: {},
  x: 0,
  y: 0,
  status: "completed",
  createdAt: "",
  updatedAt: "",
});
const edge = (
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  targetPort: WorkflowEdge["targetPort"] = "source",
): WorkflowEdge => ({
  id,
  sourceNodeId,
  targetNodeId,
  targetPort,
  sourcePort: "out",
});
const graph: WorkflowGraph = {
  projectId: "focus",
  revision: 1,
  layoutRevision: 0,
  legacyAvailable: false,
  nodes: [
    node("source"),
    node("tool", "tool"),
    node("a"),
    node("b"),
    node("edit", "tool"),
    node("result"),
    node("isolated"),
  ],
  edges: [
    edge("input", "source", "tool"),
    edge("a", "tool", "a"),
    edge("b", "tool", "b"),
    edge("edit", "a", "edit"),
    edge("other-input", "b", "edit"),
    edge("output", "edit", "result"),
  ],
};

describe("连线语义与聚焦", () => {
  it("区分共享 source 端口的主输入与生成结果，保留参考语义", () => {
    expect(edgeRelation(node("source"), edge("e", "source", "tool"))).toBe(
      "input",
    );
    expect(
      edgeRelation(node("tool", "tool"), edge("e", "tool", "result")),
    ).toBe("result");
    expect(
      edgeRelation(node("ref"), edge("e", "ref", "tool", "reference")),
    ).toBe("reference");
    for (const port of ["goal", "constraint", "candidate"] as const) {
      expect(
        edgeRelation(node("input"), edge("e", "input", "tool", port)),
      ).toBe("input");
    }
  });

  it("保留上下游，但不经共享祖先或下游汇合点扩散到旁支", () => {
    const focus = focusPathOf(graph, "a");
    expect([...(focus?.edgeIds ?? [])].sort()).toEqual([
      "a",
      "edit",
      "input",
      "output",
    ]);
    expect(focus?.nodeIds.has("b")).toBe(false);
    expect(focus?.nodeIds.has("result")).toBe(true);
  });

  it("孤立节点不高亮任何连线，已移除的选择不触发全图淡出", () => {
    expect(focusPathOf(graph, "isolated")?.edgeIds.size).toBe(0);
    expect(focusPathOf(graph, "removed")).toBeNull();
  });

  it("异常环路不会使追踪无限循环", () => {
    const cyclic = {
      ...graph,
      edges: [...graph.edges, edge("cycle", "result", "a")],
    };
    const focus = focusPathOf(cyclic, "a");
    expect(focus?.edgeIds.has("cycle")).toBe(true);
    expect(focus?.nodeIds.size).toBeLessThanOrEqual(graph.nodes.length);
  });
});
