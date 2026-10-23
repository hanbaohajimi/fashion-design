// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkflowMaterialEntry } from "./WorkflowMaterialDialogs";
import { WorkflowProjectPanels } from "./WorkflowProjectPanels";
import type { WorkflowGraph } from "./workflow-api";

HTMLDialogElement.prototype.showModal = function () { this.open = true; };
HTMLDialogElement.prototype.close = function () { this.open = false; };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("submits an ordered multicolor palette while retaining the legacy first color", async () => {
  const add = vi.fn(async () => undefined);
  render(<WorkflowMaterialEntry type="swatch" initialTitle="通勤色卡" busy={false} onClose={() => undefined} onAdd={add} />);
  fireEvent.click(screen.getByRole("button", { name: "添加颜色" }));
  fireEvent.change(screen.getByLabelText("色号 2"), { target: { value: "#ffffff" } });
  fireEvent.change(screen.getByLabelText("颜色名称 2"), { target: { value: "暖白" } });
  fireEvent.click(screen.getAllByRole("button", { name: "上移" })[1] as HTMLButtonElement);
  fireEvent.click(screen.getByRole("button", { name: "加入工作流" }));
  await waitFor(() => expect(add).toHaveBeenCalledWith("通勤色卡", { text: "", color: "#ffffff", colors: [{ hex: "#ffffff", name: "暖白" }, { hex: "#40536D", name: "色彩 1" }] }));
});

it("retries failed tasks through their workflow node and never creates a standalone generation", async () => {
  const graph: WorkflowGraph = { projectId: "p", revision: 1, layoutRevision: 0, nodes: [{ id: "tool", kind: "tool", type: "generate_design", title: "生成", payload: {}, status: "failed", x: 0, y: 0, createdAt: "", updatedAt: "" }], edges: [], legacyAvailable: false };
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); requests.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("/history")) return Response.json({ items: [{ generationTaskId: "task" }] });
    if (url.includes("/execute")) return Response.json(graph);
    return Response.json({ items: [{ id: "task", status: "failed", taskType: "t2i", request: { prompt: "风衣" }, error: null }], nextCursor: null });
  }));
  const changed = vi.fn();
  render(<WorkflowProjectPanels projectId="p" graph={graph} onGraph={changed} onLocate={() => undefined} onCollection={() => undefined} />);
  fireEvent.click(screen.getByRole("button", { name: "任务" }));
  fireEvent.click(await screen.findByRole("button", { name: "重试执行" }));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(requests.some(url => url === "POST /api/projects/p/workflow/nodes/tool/execute")).toBe(true);
  expect(requests.some(url => url.startsWith("POST /api/generations"))).toBe(false);
});
