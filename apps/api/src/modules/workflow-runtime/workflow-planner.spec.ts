import { describe, expect, it } from "vitest";
import { compileWorkflowAction, compileWorkflowProposal, parsePlannerDecision, parseWorkflowPlannerResponse, projectPlannerVisualIndex, upstreamConstraintIds, type WorkflowToolPlan, type WorkflowAction } from "./workflow-planner";
import { getWorkflowToolCatalog, parseWorkflowToolParameters } from "@fashion/shared";
import type { WorkflowsService } from "../workflows/workflows.service";

type Graph = Awaited<ReturnType<WorkflowsService["get"]>>;
const graph = {
  projectId: "project", revision: 4, layoutRevision: 8, legacyAvailable: false,
  nodes: [
    { id: "brief", kind: "asset", type: "brief", status: "ready", title: "需求", x: 0, y: 0, payload: { text: "保持立领和藏蓝色" } },
    { id: "c1", kind: "asset", type: "constraint", status: "completed", title: "约束", x: 0, y: 0, payload: {} },
    { id: "c2", kind: "asset", type: "constraint", status: "completed", title: "约束", x: 0, y: 0, payload: {} },
    { id: "g1", kind: "tool", type: "generate_design", status: "completed", title: "生成", x: 0, y: 0, payload: {} },
    { id: "g2", kind: "tool", type: "generate_design", status: "completed", title: "生成", x: 0, y: 0, payload: {} },
    { id: "a", kind: "asset", type: "candidate", status: "completed", title: "候选", x: 0, y: 0, payload: {} },
    { id: "b", kind: "asset", type: "candidate", status: "completed", title: "候选", x: 0, y: 0, payload: {} },
    { id: "unused", kind: "asset", type: "reference_text", status: "ready", title: "其他分支素材", x: 0, y: 0, payload: {} },
  ],
  edges: [
    { sourceNodeId: "c1", targetNodeId: "g1", targetPort: "constraint" },
    { sourceNodeId: "g1", targetNodeId: "a", targetPort: "source" },
    { sourceNodeId: "c2", targetNodeId: "g2", targetPort: "constraint" },
    { sourceNodeId: "g2", targetNodeId: "b", targetPort: "source" },
  ],
} as unknown as Graph;
const edit: WorkflowToolPlan = { tool: "edit_design", title: "收窄袖子", prompt: "保持立领和藏蓝色，只收窄袖子", rationale: "根据候选a的否决反馈", inputs: [{ nodeId: "a", port: "source" }, { nodeId: "c1", port: "constraint" }], newObjective: null };
const action: WorkflowAction = { type: "create_tool", toolKey: "edit_design", toolVersion: "1", targetNodeId: null, targetNodeVersionId: null, title: edit.title, parameters: { prompt: edit.prompt }, inputs: edit.inputs, newObjective: null, rationale: edit.rationale, preserve: ["立领", "藏蓝色"], evidenceRefs: ["a"] };

describe("Fig8 tool contract and action protocol", () => {
  it("provides one serializable tool catalog with parameter defaults and honest reference semantics", () => {
    const tools = getWorkflowToolCatalog();
    expect(tools.map((tool) => tool.key)).toEqual(["analyze_brief", "generate_design", "evaluate_design", "edit_design"]);
    expect(tools.find((tool) => tool.key === "generate_design")?.defaults).toMatchObject({ count: 2, width: 768, height: 1024, quality: "high" });
    expect(tools.find((tool) => tool.key === "edit_design")?.limits.join(" ")).toContain("提示词");
    expect(JSON.stringify(tools)).toContain("negativePrompt");
    expect(parseWorkflowToolParameters("generate_design", { prompt: "外套", count: 4, width: 1024, quality: "auto" })).toMatchObject({ count: 4, width: 1024, quality: "auto", negativePrompt: "" });
    expect(() => parseWorkflowToolParameters("generate_design", { prompt: "外套", count: 5 })).toThrow();
    expect(() => parseWorkflowToolParameters("edit_design", { prompt: "外套", taskType: "inpaint", maskImageUrl: "https://example.com/mask.png" })).toThrow();
    expect(() => parseWorkflowToolParameters("edit_design", { prompt: "外套", taskType: "inpaint", mask: { fileAssetId: "https://example.com/mask.png" } })).toThrow();
    expect(parseWorkflowToolParameters("edit_design", { prompt: "外套", taskType: "inpaint", mask: { fileAssetId: "owned-mask" } })).toMatchObject({ mask: { fileAssetId: "owned-mask" } });
  });
  it("normalizes legacy plans into typed actions and validates bounded project reads", () => {
    const result = parsePlannerDecision({ kind: "propose", message: "修改", plan: JSON.stringify(edit), objectiveUpdate: "null", preferences: [] });
    expect(result.action).toMatchObject({ type: "create_tool", parameters: { prompt: edit.prompt }, inputs: edit.inputs });
    expect(parsePlannerDecision({ ...result, kind: "read", action: null, reads: [{ type: "dialog", ids: ["message-1"] }] }).reads).toHaveLength(1);
    expect(() => parsePlannerDecision({ ...result, kind: "read", action: null, reads: [{ type: "url", ids: ["https://example.com"] }] })).toThrow();
    expect(() => parsePlannerDecision({ ...result, kind: "reply" })).toThrow();
    expect(parsePlannerDecision({ ...result, action: JSON.stringify(result.action), plan: "null", reads: "[]", understanding: JSON.stringify(result.understanding) }).action).toEqual(result.action);
    expect(() => parsePlannerDecision({ ...result, operations: [{ type: "remove_node", nodeId: "a" }] })).toThrow();
  });
  it("rejects a completed milestone as the active step instead of silently inventing or changing plan status", () => {
    const value = { version: "workflow-planner/2", kind: "reply", message: "确认当前进度", action: null,
      plan: { goal: "确认廓形", milestones: [{ id: "m1", title: "确认候选", status: "completed", completionCriteria: ["设计师已经确认"], evidenceRefs: ["a"] }],
        activeMilestoneId: "m1", nextGoal: null, completionCriteria: ["完成确认"] } };
    expect(() => parsePlannerDecision(value)).toThrow("activeMilestoneId");
    expect(parsePlannerDecision({ ...value, plan: { ...value.plan, activeMilestoneId: null } }).plan).toMatchObject({ activeMilestoneId: null, milestones: [{ status: "completed" }] });
    expect(parsePlannerDecision({ ...value, plan: { ...value.plan, milestones: [{ ...value.plan.milestones[0], status: "active" }] } }).plan).toMatchObject({ activeMilestoneId: "m1", milestones: [{ status: "active" }] });
  });
  it("keeps all selected parameters in the executable node and rejects reference config outside explicit inputs", () => {
    const ops = compileWorkflowAction(graph, { ...action, parameters: { prompt: edit.prompt, negativePrompt: "拉链", count: 3, width: 1024, height: 1536, quality: "medium" } }, ["a"]);
    expect(ops.find((op) => op.type === "add_node" && op.node.kind === "tool")).toMatchObject({ node: { payload: { params: { negativePrompt: "拉链", count: 3, width: 1024, height: 1536, quality: "medium" } } } });
    expect(() => compileWorkflowAction(graph, { ...action, parameters: { prompt: edit.prompt, referenceInputs: [{ nodeId: "unused", role: "style_ref", weight: 0.5 }] } }, ["a"])).toThrow("参考配置");
  });
  it("updates a ready unexecuted tool atomically and preserves unrelated payload", () => {
    const draft = { id: "draft", kind: "tool", type: "edit_design", status: "ready", title: "旧标题", x: 0, y: 0, payload: { localNote: "保留", params: { prompt: "旧提示词", width: 1536, count: 3 } } };
    const current = { ...graph, nodes: [...graph.nodes, draft], edges: [...graph.edges, { id: "old-input", sourceNodeId: "b", targetNodeId: "draft", targetPort: "source" }] } as Graph;
    const configure: WorkflowAction = { ...action, type: "configure_tool", targetNodeId: "draft", targetNodeVersionId: "version-1" };
    expect(() => compileWorkflowAction(current, configure, ["a"])).toThrow("版本");
    const ops = compileWorkflowAction(current, configure, ["a"], { draft: { nodeVersionId: "version-1", attemptCount: 0 } });
    expect(ops[0]).toMatchObject({ type: "update_node", nodeId: "draft", payload: { localNote: "保留", params: { width: 1536, count: 3, prompt: edit.prompt } } });
    expect(ops).toContainEqual({ type: "remove_edge", edgeId: "old-input" });
    expect(ops.some((op) => op.type === "add_node")).toBe(false);
    expect(() => compileWorkflowAction(current, configure, ["a"], { draft: { nodeVersionId: "version-1", attemptCount: 1 } })).toThrow("已执行");
  });
  it("forks an executed tool and cannot invent execution, overwrite versions, or change its tool type", () => {
    const fork: WorkflowAction = { ...action, type: "fork_tool", toolKey: "generate_design", targetNodeId: "g1", targetNodeVersionId: "v1", parameters: { prompt: "保持要求，优化廓形" }, inputs: [{ nodeId: "c1", port: "constraint" }] };
    const ops = compileWorkflowAction(graph, fork, [], { g1: { nodeVersionId: "v1", attemptCount: 1 } });
    expect(ops.every((op) => op.type === "add_node" || op.type === "add_edge")).toBe(true);
    expect(ops.find((op) => op.type === "add_node")).toMatchObject({ node: { payload: { forkedFromNodeId: "g1", forkedFromNodeVersionId: "v1" } } });
    expect(() => compileWorkflowAction(graph, { ...fork, targetNodeVersionId: "stale" }, [], { g1: { nodeVersionId: "v1", attemptCount: 1 } })).toThrow("版本");
    expect(() => compileWorkflowAction(graph, { ...fork, toolKey: "edit_design" }, [])).toThrow("工具类型");
    expect(() => compileWorkflowAction(graph, fork, [], { g1: { nodeVersionId: "v1", attemptCount: 0 } })).toThrow("真实执行");
  });
  it("retains a target's confirmed constraint for an imported candidate but does not silently authorize a replacement constraint", () => {
    for (const type of ["configure_tool", "fork_tool"] as const) {
      const current = { ...graph, nodes: [...graph.nodes,
        { id: "imported", kind: "asset", type: "candidate", status: "ready", title: "导入候选", x: 0, y: 0, payload: {} },
        { id: "target", kind: "tool", type: "edit_design", status: type === "configure_tool" ? "ready" : "completed", title: "已确认的修改", x: 300, y: 0, payload: { params: { prompt: "只收窄袖口", width: 768 } } }],
        edges: [...graph.edges, { id: "confirmed-source", sourceNodeId: "imported", targetNodeId: "target", targetPort: "source" },
          { id: "confirmed-constraint", sourceNodeId: "c1", targetNodeId: "target", targetPort: "constraint" }] } as Graph;
      const revise = { ...action, type, targetNodeId: "target", targetNodeVersionId: "target-v1", parameters: { count: 4, width: 1024 },
        inputs: [{ nodeId: "imported", port: "source" as const }, { nodeId: "c1", port: "constraint" as const }] };
      const eligibility = { target: { nodeVersionId: "target-v1", attemptCount: type === "configure_tool" ? 0 : 1 } };
      const operations = compileWorkflowAction(current, revise, ["target"], eligibility);
      expect(operations.find((operation) => operation.type === "update_node" || operation.type === "add_node")).toMatchObject(
        type === "configure_tool" ? { type: "update_node", payload: { params: { prompt: "只收窄袖口", count: 4, width: 1024 } } }
          : { type: "add_node", node: { payload: { params: { prompt: "只收窄袖口", count: 4, width: 1024 } } } });
      expect(() => compileWorkflowAction(current, { ...revise, inputs: [{ nodeId: "imported", port: "source" }, { nodeId: "c2", port: "constraint" }] }, ["target"], eligibility)).toThrow("分支约束");
    }
  });
});

describe("workflow planner action enablement", () => {
  it("accepts gateway JSON-encoded nullable fields while rejecting malformed or invented plans", () => {
    expect(parseWorkflowPlannerResponse({ kind: "reply", message: "解释设计过程", plan: "null", objectiveUpdate: "null", preferences: [] }).plan).toBeNull();
    expect(parseWorkflowPlannerResponse({ kind: "propose", message: "收窄袖子", plan: JSON.stringify(edit), objectiveUpdate: null, preferences: [] }).plan).toEqual(edit);
    expect(() => parseWorkflowPlannerResponse({ kind: "propose", message: "修改", plan: "not JSON", objectiveUpdate: null, preferences: [] })).toThrow();
  });
  it("bounds large visual indexes while keeping every image node discoverable", () => {
    const result = projectPlannerVisualIndex(Array.from({ length: 300 }, (_, index) => ({ nodeId: `image-${index}`, assetId: null, fileAssetId: null, error: null, status: "ready" as const,
      summary: { subject: "藏蓝色外套".repeat(300), silhouette: [], visibleStructure: [], colors: ["藏蓝色"], surfaceTexture: [], uncertainties: ["真实成分未知"] } })));
    expect(result.index).toHaveLength(300);
    expect(JSON.stringify(result.index).length).toBeLessThanOrEqual(48_000);
    expect(result.coverage.truncatedNodeIds).toHaveLength(300);
  });
  it("reads each same-name candidate's own upstream constraints", () => {
    expect(upstreamConstraintIds(graph, "a")).toEqual(["c1"]);
    expect(upstreamConstraintIds(graph, "b")).toEqual(["c2"]);
  });
  it("uses only model-selected legal inputs, with no unrelated global material", () => {
    const operations = compileWorkflowProposal(graph, edit, ["a"]);
    expect(operations.filter((op) => op.type === "add_edge").map((op) => op.edge.sourceNodeId)).toEqual(["a", "c1"]);
    expect(operations.every((op) => op.type === "add_node" || op.type === "add_edge")).toBe(true);
    expect(graph.nodes).toHaveLength(8);
  });
  it("rejects invented IDs, unavailable sources, tool inputs and duplicate edges", () => {
    for (const id of ["other-project", "g1"]) expect(() => compileWorkflowProposal(graph, { ...edit, inputs: [{ nodeId: id, port: "source" }] }, [])).toThrow();
    expect(() => compileWorkflowProposal(graph, { ...edit, inputs: [...edit.inputs, { nodeId: "a", port: "source" }] }, [])).toThrow("重复");
    const failed = { ...graph, nodes: graph.nodes.map((node) => node.id === "a" ? { ...node, status: "failed" } : node) };
    expect(() => compileWorkflowProposal(failed, edit, ["a"])).toThrow("已就绪");
  });
  it("does not silently switch the explicitly referenced editing parent", () => {
    expect(() => compileWorkflowProposal(graph, edit, ["b"])).toThrow("明确引用");
  });
  it("preserves the parent's existing constraints and the explicitly selected evaluation candidates", () => {
    expect(() => compileWorkflowProposal(graph, { ...edit, inputs: [{ nodeId: "a", port: "source" }] }, ["a"])).toThrow("分支的设计约束");
    expect(() => compileWorkflowProposal(graph, { ...edit, tool: "evaluate_design", inputs: [{ nodeId: "b", port: "candidate" }, { nodeId: "c2", port: "constraint" }] }, ["a"])).toThrow("明确引用");
  });
  it("requires explicit constraint selection for a cross-branch comparison", () => {
    const comparison: WorkflowToolPlan = { ...edit, tool: "evaluate_design", inputs: [{ nodeId: "a", port: "candidate" }, { nodeId: "b", port: "candidate" }, { nodeId: "c1", port: "constraint" }] };
    expect(() => compileWorkflowProposal(graph, comparison, ["a", "b"])).toThrow("分支约束");
    expect(compileWorkflowProposal(graph, comparison, ["a", "b", "c1"])).toHaveLength(4);
    expect(compileWorkflowProposal(graph, comparison, ["a", "b", "c1", "a", "b"])).toHaveLength(4);
  });
  it("creates a new objective as a new asset without overwriting the previous brief", () => {
    const operations = compileWorkflowProposal(graph, { ...edit, tool: "analyze_brief", inputs: [], newObjective: "改为开发银色外套系列" }, []);
    expect(operations.filter((op) => op.type === "add_node").map((op) => op.node.kind)).toEqual(["asset", "tool"]);
    expect(operations.some((op) => op.type === "update_node")).toBe(false);
  });
});
