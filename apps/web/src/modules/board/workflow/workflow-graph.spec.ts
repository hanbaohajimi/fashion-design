import { describe, expect, it } from "vitest";
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from "./workflow-api";
import { availableInputPorts, lineageOf, projectWorkflowProposal } from "./workflow-graph";

function node(id: string, kind: WorkflowNode["kind"], type: WorkflowNode["type"]): WorkflowNode {
  return {
    id,
    kind,
    type,
    title: id,
    payload: {},
    x: 0,
    y: 0,
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function edge(id: string, sourceNodeId: string, targetNodeId: string, targetPort: WorkflowEdge["targetPort"]): WorkflowEdge {
  return { id, sourceNodeId, targetNodeId, sourcePort: "out", targetPort };
}

describe("workflow graph", () => {
  it("previews configuration on the existing card and replaces its inputs without changing saved graph", () => {
    const original = { ...node("draft", "tool", "generate_design"), x: 360, y: 200, status: "ready" };
    const graph: WorkflowGraph = { projectId: "p", revision: 2, layoutRevision: 3, legacyAvailable: false, nodes: [node("old", "asset", "constraint"), node("new", "asset", "constraint"), original], edges: [edge("old-edge", "old", "draft", "constraint")] };
    const preview = projectWorkflowProposal(graph, { id: "proposal", baseRevision: 2, status: "pending", rationale: "改用新约束", content: "修改", toolNodeId: "draft", referencedNodeIds: ["new"], createdAt: "", operations: [{ type: "update_node", nodeId: "draft", title: "新的方案", payload: { params: { prompt: "新指令" } } }, { type: "remove_edge", edgeId: "old-edge" }, { type: "add_edge", edge: edge("new-edge", "new", "draft", "constraint") }] });
    expect(preview.nodes).toHaveLength(3);
    expect(preview.nodes.find((item) => item.id === "draft")).toMatchObject({ x: 360, y: 200, title: "新的方案", status: "proposed" });
    expect(preview.edges.map((item) => item.id)).toEqual(["new-edge"]);
    expect(graph.edges.map((item) => item.id)).toEqual(["old-edge"]);
    expect(original.title).toBe("draft");
  });
  it("highlights only the real ancestors of a selected branch", () => {
    const graph: WorkflowGraph = {
      projectId: "project",
      revision: 1,
      layoutRevision: 0,
      legacyAvailable: false,
      nodes: [
        node("brief", "asset", "brief"),
        node("analysis", "tool", "analyze_brief"),
        node("constraint", "asset", "constraint"),
        node("generate", "tool", "generate_design"),
        node("candidate-a", "asset", "candidate"),
        node("candidate-b", "asset", "candidate"),
      ],
      edges: [
        edge("e1", "brief", "analysis", "goal"),
        edge("e2", "analysis", "constraint", "source"),
        edge("e3", "constraint", "generate", "constraint"),
        edge("e4", "generate", "candidate-a", "source"),
        edge("e5", "generate", "candidate-b", "source"),
      ],
    };

    const path = lineageOf(graph, "candidate-a");
    expect([...path.nodeIds]).toEqual(expect.arrayContaining(["brief", "analysis", "constraint", "generate", "candidate-a"]));
    expect(path.nodeIds.has("candidate-b")).toBe(false);
    expect(path.edgeIds.has("e4")).toBe(true);
    expect(path.edgeIds.has("e5")).toBe(false);
  });

  it("offers only typed connections, including historical restore branches", () => {
    const brief = node("brief", "asset", "brief");
    const candidate = node("candidate", "asset", "candidate");
    const generate = node("generate", "tool", "generate_design");
    const evaluate = node("evaluate", "tool", "evaluate_design");
    const restore = node("restore", "tool", "restore_version");

    expect(availableInputPorts(brief, generate)).toEqual([]);
    expect(availableInputPorts(candidate, evaluate)).toEqual(["candidate"]);
    expect(availableInputPorts(candidate, restore)).toEqual(["source"]);
    expect(availableInputPorts(generate, candidate)).toEqual(["source"]);
    expect(availableInputPorts(generate, brief)).toEqual([]);
    expect(availableInputPorts(brief, candidate)).toEqual([]);
  });
});
