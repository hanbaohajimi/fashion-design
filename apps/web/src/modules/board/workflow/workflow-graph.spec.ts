import { describe, expect, it } from "vitest";
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from "./workflow-api";
import { availableInputPorts, imageNodeSize, lineageOf, nodeSize, nodeSummary, projectWorkflowProposal } from "./workflow-graph";

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
  it("renders fabric photos like uploads while omitting duplicated tag captions", () => {
    const fabric = { ...node("fabric", "asset", "fabric"), title: "棉麻 · 斜纹", payload: { imageUrl: "/fabric.jpg", text: "棉麻、斜纹" } };
    expect(nodeSummary(fabric)).toBe("");
    for (const [width, height] of [[1600, 900], [600, 900], [900, 900]]) {
      expect(nodeSize(fabric, { width, height })).toEqual(imageNodeSize({ width, height }));
      expect(nodeSize({ ...fabric, payload: { ...fabric.payload, width, height } })).toEqual(imageNodeSize({ width, height }));
    }
    expect(nodeSize(fabric)).toEqual(imageNodeSize({ width: 1, height: 1 }));
    expect(nodeSummary({ ...fabric, payload: { text: "棉麻、斜纹", description: "柔软透气" } })).toBe("柔软透气");
    expect(nodeSummary({ ...fabric, payload: { text: "棉麻混纺，适合春夏" } })).toBe("棉麻混纺，适合春夏");
    expect(nodeSize({ ...fabric, payload: { imageUrl: "/fabric.jpg", text: "柔软透气", width: 1600, height: 900 } })).toEqual(imageNodeSize({ width: 1600, height: 900 }, true));
    expect(nodeSize({ ...fabric, payload: {} })).toEqual({ w: 300, h: 200 });
  });

  it("fits landscape, portrait and square images without reserving a portrait frame", () => {
    for (const [width, height] of [[1920, 1080], [768, 1024], [900, 900], [10000, 100], [100, 10000]] as const) {
      const size = imageNodeSize({ width, height });
      // The caption and border occupy 58 px; the remaining box keeps the photo ratio.
      expect((size.w) / (size.h - 58)).toBeCloseTo(width / height, 8);
      // jsdom 的 innerWidth 为 1024，走桌面档：宽度上限 400，轮廓不占尺寸，高度上限 460。
      // 窄视口（< 768）的紧凑档在 e2e 的 390px 用例里覆盖。
      expect(size.w).toBeLessThanOrEqual(400);
      expect(size.h).toBeLessThanOrEqual(460);
      expect(size.w).toBeGreaterThan(1);
      expect(size.h).toBeGreaterThan(58);
    }
  });

  it("uses stored metadata immediately and prefers the loaded image ratio for older thumbnails", () => {
    const image = { ...node("image", "asset", "reference_image"), payload: { width: 1920, height: 1080 } };
    expect(nodeSize(image)).toEqual(imageNodeSize({ width: 1920, height: 1080 }));
    expect(nodeSize(image, { width: 1024, height: 1024 })).toEqual(imageNodeSize({ width: 1024, height: 1024 }));
    expect(nodeSize({ ...image, payload: { width: 0, height: -1 } })).toEqual(imageNodeSize({ width: 1, height: 1 }));
  });

  it("reserves a single readable summary line without shrinking the photo", () => {
    const image = { ...node("candidate", "asset", "candidate"), payload: { width: 1920, height: 1080, decision: { kind: "selected", reason: "保留领型" } } };
    const plain = imageNodeSize({ width: 1920, height: 1080 });
    expect(nodeSize(image)).toEqual({ w: plain.w, h: plain.h + 22 });
    const portraitWithSummary = imageNodeSize({ width: 768, height: 1024 }, true);
    expect(portraitWithSummary.h).toBe(460);
    expect((portraitWithSummary.w) / (portraitWithSummary.h - 80)).toBeCloseTo(768 / 1024, 8);
    expect(imageNodeSize({ width: Number.NaN, height: Number.POSITIVE_INFINITY })).toEqual(imageNodeSize({ width: 1, height: 1 }));
    expect(nodeSize(node("brief", "asset", "brief"))).toEqual({ w: 300, h: 200 });
    // 工具节点刻意比素材矮一档：过程不该抢作品的视觉高度。
    expect(nodeSize(node("tool", "tool", "generate_design")).h).toBeLessThan(
      nodeSize(node("brief", "asset", "brief")).h,
    );
  });

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

  it("connects an uploaded reference directly as the edit mother image", () => {
    const image = node("image", "asset", "reference_image");
    expect(availableInputPorts(image, node("edit", "tool", "edit_design"))).toEqual(["source"]);
    expect(availableInputPorts(image, node("generate", "tool", "generate_design"))).toEqual(["reference"]);
    expect(availableInputPorts(image, node("restore", "tool", "restore_version"))).toEqual(["reference"]);
  });
});
