import { expect, it } from "vitest";
import { buildDesignWorkbench, designNoteText } from "./design-workbench";
import type { WorkflowGraph, WorkflowNode } from "./workflow-api";

function node(id: string, type: WorkflowNode["type"], kind: WorkflowNode["kind"] = "asset", status = "completed"): WorkflowNode {
  return { id, type, kind, status, title: id, payload: {}, x: 0, y: 0, createdAt: "", updatedAt: "" };
}
function graph(nodes: WorkflowNode[], links: string[][]): WorkflowGraph {
  return { projectId: "project", revision: 1, layoutRevision: 1, legacyAvailable: false, nodes,
    edges: links.map(([sourceNodeId = "", targetNodeId = ""], index) => ({ id: String(index), sourceNodeId, targetNodeId, sourcePort: "out", targetPort: "source" })) };
}

it("同次生成合为一组，分析约束与评估归入设计说明，素材只归档一次", () => {
  const value = graph([node("ref", "reference_image"), node("analyze", "analyze_brief", "tool"), node("rules", "constraint"), node("gen", "generate_design", "tool"), node("a", "candidate"), node("b", "candidate"), node("eval", "evaluate_design", "tool"), node("report", "evaluation")],
    [["ref", "analyze"], ["analyze", "rules"], ["rules", "gen"], ["ref", "gen"], ["gen", "a"], ["gen", "b"], ["a", "eval"], ["b", "eval"], ["eval", "report"]]);
  const original = JSON.stringify(value);
  const work = buildDesignWorkbench(value);
  expect(work.groups).toHaveLength(1);
  expect(work.groups[0]?.candidates.map((item) => item.id)).toEqual(["a", "b"]);
  expect(work.groups[0]?.sources.map((item) => item.id)).toEqual(["ref"]);
  expect(work.groups[0]?.notes.map((item) => item.id).sort()).toEqual(["report", "rules"]);
  expect(work.activities).toHaveLength(0);
  expect(work.notes).toHaveLength(0);
  expect(JSON.stringify(value)).toBe(original);
});

it("修改分支只标记母图，不把母图的其他分支评估带进新方案", () => {
  const work = buildDesignWorkbench(graph([node("base", "candidate"), node("report", "evaluation"), node("edit", "edit_design", "tool"), node("next", "candidate")],
    [["base", "report"], ["base", "edit"], ["edit", "next"]]));
  const edited = work.groups.find((group) => group.id === "edit");
  expect(edited?.sources.map((source) => source.id)).toEqual(["base"]);
  expect(edited?.notes).toHaveLength(0);
});

it("环与失效连线不会阻塞工作台，孤立方案和说明仍可访问", () => {
  const work = buildDesignWorkbench(graph([node("a", "candidate"), node("report", "evaluation"), node("rules", "constraint"), node("tool", "generate_design", "tool")],
    [["missing", "tool"], ["tool", "rules"], ["rules", "tool"], ["tool", "a"]]));
  expect(work.groups[0]?.candidates[0]?.id).toBe("a");
  expect(work.notes.map((item) => item.id)).toEqual(["report"]);
});

it("无方案时运行中、失败和待执行步骤仍显示，已有部分结果也不吞掉失败", () => {
  const work = buildDesignWorkbench(graph([node("running", "analyze_brief", "tool", "running"), node("failed", "generate_design", "tool", "failed"), node("ready", "edit_design", "tool", "ready"), node("partial", "candidate")], [["failed", "partial"]]));
  expect(work.activities.map((item) => item.id)).toEqual(["running", "failed", "ready"]);
  expect(work.groups[0]?.candidates).toHaveLength(1);
});

it("共享评估只显示本组真实候选的结论，完整报告仍由原节点承载", () => {
  const report = { ...node("report", "evaluation"), payload: { report: { evaluations: [{ assetId: "a", summary: "肩线符合要求" }, { assetId: "b", summary: "另一分支" }] } } };
  expect(designNoteText(report, [{ ...node("a", "candidate"), payload: { assetId: "a" } }])).toEqual(["肩线符合要求"]);
});

it("空项目不制造说明或任务", () => {
  expect(buildDesignWorkbench(graph([], []))).toEqual({ groups: [], materials: [], notes: [], briefs: [], activities: [] });
});
