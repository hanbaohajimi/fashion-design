// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PendingDesignSlots } from "./PendingDesignSlots";
import type { WorkflowGraph } from "./workflow-api";
afterEach(cleanup);

it("reserves only remaining requested images, with their real dimensions", () => {
  const graph = { nodes: [
    { id: "tool", type: "generate_design", status: "running", title: "风衣", payload: { params: { count: 3, width: 1024, height: 768 } } },
    { id: "ready", type: "candidate", payload: {} },
  ], edges: [{ sourceNodeId: "tool", targetNodeId: "ready" }] } as unknown as WorkflowGraph;
  const { container } = render(<PendingDesignSlots graph={graph} />);
  expect(screen.getByText("方案 2")).toBeTruthy(); expect(screen.getByText("方案 3")).toBeTruthy();
  expect(screen.queryByText("方案 1")).toBeNull();
  expect(container.querySelectorAll('[style*="aspect-ratio: 1024 / 768"]')).toHaveLength(2);
  expect(container.textContent).not.toMatch(/构图|上色|百分比/);
});

it("does not imply generation for an unaccepted ready tool or completed history", () => {
  const { container } = render(<PendingDesignSlots graph={{ nodes: [
    { id: "ready", type: "generate_design", status: "ready", payload: {} },
    { id: "complete", type: "edit_design", status: "completed", payload: {} },
  ], edges: [] } as unknown as WorkflowGraph} />);
  expect(container.childElementCount).toBe(0);
});
