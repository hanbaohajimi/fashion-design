import { describe, expect, it } from "vitest";
import type { WorkflowGraph, WorkflowNode } from "./workflow-api";
import { planInputEdit } from "./workflow-editing";
import {
  workflowInputPorts,
  workflowInputConnectionError,
} from "@fashion/shared";

function graph(
  status = "ready",
  params: Record<string, unknown> = {},
): WorkflowGraph {
  const node = (
    id: string,
    kind: WorkflowNode["kind"],
    type: WorkflowNode["type"],
  ): WorkflowNode => ({
    id,
    kind,
    type,
    title: id,
    payload: {},
    x: 0,
    y: 0,
    status: "ready",
    createdAt: "",
    updatedAt: "",
  });
  return {
    projectId: "p",
    revision: 1,
    layoutRevision: 0,
    legacyAvailable: false,
    nodes: [
      node("a", "asset", "candidate"),
      node("b", "asset", "candidate"),
      {
        ...node("edit", "tool", "edit_design"),
        status,
        payload: {
          toolKey: "edit_design",
          toolVersion: "1",
          params,
          error: "old",
          assetId: "old-result",
        },
      },
      node("result", "asset", "candidate"),
    ],
    edges: [
      {
        id: "input",
        sourceNodeId: "a",
        targetNodeId: "edit",
        sourcePort: "out",
        targetPort: "source",
      },
      {
        id: "output",
        sourceNodeId: "edit",
        targetNodeId: "result",
        sourcePort: "out",
        targetPort: "source",
      },
    ],
  };
}

describe("manual workflow inputs", () => {
  it("uses uploaded images as the mother by default and still allows an explicit reference", () => {
    const base = graph();
    const original: WorkflowGraph = { ...base, nodes: base.nodes.map((node) => node.id === "b" ? { ...node, type: "reference_image" } : node) };
    const replacement = planInputEdit(original, { targetId: "edit", sourceId: "b", edgeId: "input" });
    expect(replacement.operations).toContainEqual(expect.objectContaining({
      type: "add_edge", edge: expect.objectContaining({ sourceNodeId: "b", targetPort: "source" }),
    }));
    const reference = planInputEdit(original, { targetId: "edit", sourceId: "b", port: "reference" });
    expect(reference.operations).toContainEqual(expect.objectContaining({
      type: "add_edge", edge: expect.objectContaining({ sourceNodeId: "b", targetPort: "reference" }),
    }));
    expect(planInputEdit(original, { targetId: "edit", sourceId: "b" }).operations).toContainEqual(expect.objectContaining({
      type: "add_edge", edge: expect.objectContaining({ targetPort: "reference" }),
    }));
    expect(() => planInputEdit(original, { targetId: "edit", sourceId: "b", port: "source" })).toThrow("原图");
    expect(workflowInputPorts("reference_image", "edit_design")).toEqual(["source", "reference"]);
  });
  it("replaces the source atomically for an unexecuted tool", () => {
    const edit = planInputEdit(graph(), {
      targetId: "edit",
      sourceId: "b",
      edgeId: "input",
    });
    expect(edit.branched).toBe(false);
    expect(edit.operations[0]).toEqual({
      type: "remove_edge",
      edgeId: "input",
    });
    expect(edit.operations[1]).toMatchObject({
      type: "add_edge",
      edge: { sourceNodeId: "b", targetNodeId: "edit", targetPort: "source" },
    });
  });
  it("promotes an existing reference to the mother and removes its old reference settings", () => {
    const base = graph("ready", { prompt: "收窄袖口", referenceInputs: [{ nodeId: "b", role: "detail_ref", weight: 0.5 }] });
    const original: WorkflowGraph = {
      ...base,
      nodes: base.nodes.map((node) => node.id === "b" ? { ...node, type: "reference_image" } : node),
      edges: [{ id: "reference", sourceNodeId: "b", targetNodeId: "edit", sourcePort: "out", targetPort: "reference" }],
    };
    const promoted = planInputEdit(original, { targetId: "edit", sourceId: "b", edgeId: "reference", port: "source" });
    expect(promoted.operations).toContainEqual(expect.objectContaining({
      type: "update_node", payload: expect.objectContaining({ params: { prompt: "收窄袖口", referenceInputs: [] } }),
    }));
    expect(promoted.operations).toContainEqual(expect.objectContaining({
      type: "add_edge", edge: expect.objectContaining({ sourceNodeId: "b", targetPort: "source" }),
    }));
  });
  it("clears the saved mask and palette when an upload replaces the mother", () => {
    const base = graph("ready", { prompt: "改袖口", taskType: "inpaint", mask: { fileAssetId: "mask" }, palette: [{ hex: "#112233", name: "藏蓝" }] });
    const original: WorkflowGraph = { ...base, nodes: base.nodes.map((node) => node.id === "b" ? { ...node, type: "reference_image" } : node) };
    const replaced = planInputEdit(original, { targetId: "edit", sourceId: "b", edgeId: "input" });
    expect(replaced.maskCleared).toBe(true);
    expect(replaced.operations).toContainEqual(expect.objectContaining({
      type: "update_node", payload: expect.objectContaining({ params: { prompt: "改袖口", taskType: "i2i" } }),
    }));
  });
  it.each(["completed", "running", "pending", "failed"])(
    "branches %s tools without copying results or runtime state",
    (status) => {
      const original = graph(status, { prompt: "保留廓形" });
      const edit = planInputEdit(original, {
        targetId: "edit",
        sourceId: "b",
        edgeId: "input",
      });
      expect(edit.branched).toBe(true);
      expect(edit.operations).toHaveLength(2);
      expect(edit.operations[0]).toMatchObject({
        type: "add_node",
        node: {
          kind: "tool",
          type: "edit_design",
          payload: {
            toolKey: "edit_design",
            toolVersion: "1",
            params: { prompt: "保留廓形" },
          },
        },
      });
      expect(JSON.stringify(edit.operations)).not.toContain("old-result");
      expect(edit.operations.some((op) => op.type === "remove_edge")).toBe(
        false,
      );
      expect(original.edges).toHaveLength(2);
      expect(edit.operations[1]).toMatchObject({
        type: "add_edge",
        edge: { targetNodeId: edit.targetId, sourceNodeId: "b" },
      });
    },
  );
  it("rejects a second mother image and duplicate inputs", () => {
    expect(() =>
      planInputEdit(graph(), { targetId: "edit", sourceId: "b" }),
    ).toThrow("原图");
    expect(() =>
      planInputEdit(graph(), { targetId: "edit", sourceId: "a" }),
    ).toThrow("已存在");
  });
  it("rejects a cycle but allows a completed result to start a new branch", () => {
    expect(() =>
      planInputEdit(graph(), {
        targetId: "edit",
        sourceId: "result",
        edgeId: "input",
      }),
    ).toThrow("循环");
    expect(
      planInputEdit(graph("completed"), {
        targetId: "edit",
        sourceId: "result",
        edgeId: "input",
      }).branched,
    ).toBe(true);
  });
  it("clears an old inpaint mask when changing the mother image", () => {
    const edit = planInputEdit(
      graph("completed", {
        taskType: "inpaint",
        maskImageUrl: "old-mask",
        prompt: "换领口",
        palette: [],
      }),
      { targetId: "edit", sourceId: "b", edgeId: "input" },
    );
    expect(edit.operations[0]).toMatchObject({
      type: "add_node",
      node: {
        payload: { params: { taskType: "i2i", prompt: "换领口" } },
      },
    });
    expect(JSON.stringify(edit.operations)).not.toContain("old-mask");
    expect(edit.maskCleared).toBe(true);
  });
  it("deletes only the copied input when detaching an executed path", () => {
    const edit = planInputEdit(graph("completed"), {
      targetId: "edit",
      edgeId: "input",
    });
    expect(edit.operations).toHaveLength(1);
    expect(edit.operations[0]?.type).toBe("add_node");
  });
  it("never edits system output provenance", () => {
    expect(() =>
      planInputEdit(graph(), { targetId: "result", edgeId: "output" }),
    ).toThrow("输入");
  });
  it("keeps a mask when the mother image is unchanged and clears it on a ready replacement", () => {
    const original = graph("ready", {
      taskType: "inpaint",
      maskImageUrl: "mask",
      referenceImageUrl: "image",
      parentAssetId: "parent",
    });
    expect(
      planInputEdit(original, {
        targetId: "edit",
        sourceId: "a",
        edgeId: "input",
      }).maskCleared,
    ).toBe(false);
    const replaced = planInputEdit(original, {
      targetId: "edit",
      sourceId: "b",
      edgeId: "input",
    });
    expect(replaced.operations).toContainEqual(
      expect.objectContaining({
        type: "update_node",
        payload: expect.objectContaining({ params: { taskType: "i2i" } }),
      }),
    );
  });
  it("allows multiple evaluation candidates and checks the shared type matrix", () => {
    expect(workflowInputPorts("brief", "generate_design")).toEqual([]);
    expect(workflowInputPorts("fabric", "generate_design")).toEqual([
      "reference",
    ]);
    expect(workflowInputPorts("swatch", "analyze_brief")).toEqual([
      "reference",
    ]);
    expect(workflowInputPorts("candidate", "evaluate_design")).toContain(
      "candidate",
    );
    expect(
      workflowInputConnectionError(
        "candidate",
        "evaluate_design",
        {
          sourceNodeId: "b",
          targetNodeId: "evaluation",
          targetPort: "candidate",
        },
        [
          {
            sourceNodeId: "a",
            targetNodeId: "evaluation",
            targetPort: "candidate",
          },
        ],
      ),
    ).toBeNull();
  });
  it("keeps restoration in the version workbench", () => {
    const original = graph();
    const restored = {
      ...original,
      nodes: original.nodes.map((node) =>
        node.id === "edit"
          ? { ...node, type: "restore_version" as const }
          : node,
      ),
    };
    expect(() =>
      planInputEdit(restored, {
        targetId: "edit",
        sourceId: "b",
        edgeId: "input",
      }),
    ).toThrow("版本工作台");
  });
});
