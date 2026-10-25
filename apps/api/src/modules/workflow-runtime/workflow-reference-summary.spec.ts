import { describe, expect, it } from "vitest";
import { workflowReferenceSummarySchema } from "@fashion/shared";
import { buildWorkflowReferenceSummary } from "./workflow-reference-summary";

describe("workflow reference snapshots", () => {
  it("preserves turn-time names and order, deduplicates within categories and records only actual images", () => {
    const nodes = [{ id: "a", title: "原始名称" }, { id: "b", title: "未传入的图片" }];
    const summary = buildWorkflowReferenceSummary(nodes, ["a", "a"], ["a", "missing"], []);
    const first = nodes[0];
    if (first) first.title = "后来名称";
    expect(summary).toEqual({ version: 1, explicit: [{ nodeId: "a", title: "原始名称" }], discussion: [{ nodeId: "a", title: "原始名称" }, { nodeId: "missing", title: null }], images: [] });
    expect(workflowReferenceSummarySchema.parse(JSON.parse(JSON.stringify(summary)))).toEqual(summary);
  });
  it("validates categories and rejects malformed persisted summaries", () => {
    expect(workflowReferenceSummarySchema.safeParse({ version: 1, explicit: [], discussion: [], images: [{ nodeId: "a", title: null }] }).success).toBe(true);
    expect(workflowReferenceSummarySchema.safeParse({ version: 1, explicit: ["a"] }).success).toBe(false);
  });
});
