import { describe, expect, it } from "vitest";
import { compileStudioTask, type TaskDraft } from "./TaskEntry";
import { getWorkflowToolContract, type WorkflowToolKey } from "@fashion/shared";
import { studioFixture } from "./studio-test-fixtures";
import type { WorkflowGraph } from "../board/workflow/workflow-api";

const graph: WorkflowGraph = {
  projectId: "project",
  revision: 3,
  layoutRevision: 2,
  nodes: [],
  edges: [],
  legacyAvailable: false,
};
const ids = {
  toolId: "tool-new",
  briefId: "brief-new",
  sourceIds: ["source-front", "source-back"],
};
const draft: TaskDraft = {
  kind: "combine",
  prompt: "将背面裁片结构用于母图",
  preserve: "保留短衣长和双口袋",
  assetIds: ["asset-front", "asset-back"],
  brandId: "",
};

describe("studio task compilation", () => {
  it("connects exactly one source and explicitly binds every additional image reference", () => {
    const operations = compileStudioTask(draft, graph, ids, studioFixture());
    const tool = operations.find(
      (operation) =>
        operation.type === "add_node" && operation.node.id === ids.toolId,
    );
    expect(tool?.type === "add_node" && tool.node.type).toBe("edit_design");
    expect(
      operations.filter(
        (operation) =>
          operation.type === "add_edge" &&
          operation.edge.targetPort === "source",
      ),
    ).toHaveLength(1);
    expect(
      operations.filter(
        (operation) =>
          operation.type === "add_edge" &&
          operation.edge.targetPort === "reference",
      ),
    ).toHaveLength(1);
    if (tool?.type !== "add_node") throw new Error("missing task");
    expect(tool.node.payload.params).toMatchObject({
      taskType: "i2i",
      count: 1,
      prompt: expect.stringContaining("必须保留：保留短衣长和双口袋"),
      referenceInputs: [{ nodeId: "source-back", role: "style_ref" }],
    });
  });
  it("creates a text analysis task without implicitly generating images", () => {
    const operations = compileStudioTask(
      { ...draft, kind: "brief", assetIds: [] },
      graph,
      { ...ids, sourceIds: [] },
      studioFixture(),
    );
    expect(
      operations
        .filter(
          (operation) =>
            operation.type === "add_node" && operation.node.kind === "tool",
        )
        .map(
          (operation) => operation.type === "add_node" && operation.node.type,
        ),
    ).toEqual(["analyze_brief"]);
    expect(
      operations.some(
        (operation) =>
          operation.type === "add_edge" && operation.edge.targetPort === "goal",
      ),
    ).toBe(true);
  });
  it("rejects missing mother images, unknown assets and implicit loss of preservation requirements", () => {
    expect(() =>
      compileStudioTask(
        { ...draft, assetIds: [] },
        graph,
        ids,
        studioFixture(),
      ),
    ).toThrow("母图");
    expect(() =>
      compileStudioTask(
        { ...draft, assetIds: ["not-authorized"] },
        graph,
        ids,
        studioFixture(),
      ),
    ).toThrow("不在项目");
    expect(() =>
      compileStudioTask(
        { ...draft, preserve: "" },
        graph,
        ids,
        studioFixture(),
      ),
    ).toThrow("保留");
  });
  it("saves the exact brand revision and rejects oversized composed requests", () => {
    const brand = {
      id: "brand-1",
      type: "BRAND_PROFILE" as const,
      version: 2,
      currentRevision: {
        id: "brand-r2",
        revision: 2,
        createdAt: "",
        payload: {
          name: "山岚",
          colors: [],
          silhouettes: ["短款"],
          signatureDetails: [],
          fabricPreferences: [],
          avoid: [],
          notes: "保持安静",
          referenceAssetIds: [],
        },
      },
      revisions: [],
    };
    const operations = compileStudioTask(
      { ...draft, brandId: "brand-1" },
      graph,
      ids,
      studioFixture({ brandProfiles: [brand] }),
    );
    const tool = operations.find(
      (operation) =>
        operation.type === "add_node" && operation.node.id === ids.toolId,
    );
    expect(
      tool?.type === "add_node" && tool.node.payload.studioBrandRevisionId,
    ).toBe("brand-r2");
    expect(() =>
      compileStudioTask(
        { ...draft, prompt: "设计".repeat(2500) },
        graph,
        ids,
        studioFixture(),
      ),
    ).toThrow("4000");
  });
});

it("compiles every task with the actual tool parameter and input-slot contracts", () => {
  for (const kind of [
    "sketch",
    "combine",
    "color",
    "detail",
    "brief",
  ] as const) {
    const assetIds =
      kind === "brief"
        ? []
        : kind === "combine"
          ? ["asset-front", "asset-back"]
          : ["asset-front"];
    const operations = compileStudioTask(
      { ...draft, kind, assetIds },
      graph,
      { ...ids, sourceIds: ids.sourceIds.slice(0, assetIds.length) },
      studioFixture(),
    );
    const nodes = operations.flatMap((operation) =>
      operation.type === "add_node" ? [operation.node] : [],
    );
    const tool = nodes.find((node) => node.kind === "tool");
    if (!tool) throw new Error("missing tool");
    const contract = getWorkflowToolContract(tool.type as WorkflowToolKey);
    expect(
      contract.parameterSchema.safeParse(tool.payload.params).success,
    ).toBe(true);
    const edges = operations.flatMap((operation) =>
      operation.type === "add_edge" ? [operation.edge] : [],
    );
    for (const slot of contract.inputSlots) {
      const inputs = edges.filter(
        (edge) =>
          edge.targetNodeId === tool.id && edge.targetPort === slot.port,
      );
      expect(inputs.length).toBeGreaterThanOrEqual(slot.min);
      expect(inputs.length).toBeLessThanOrEqual(slot.max);
      for (const edge of inputs)
        expect(slot.assetTypes).toContain(
          nodes.find((node) => node.id === edge.sourceNodeId)?.type,
        );
    }
    expect(
      edges.every((edge) =>
        contract.inputSlots.some((slot) => slot.port === edge.targetPort),
      ),
    ).toBe(true);
  }
});
