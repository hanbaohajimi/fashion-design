// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkflowMaterialEntry } from "./WorkflowMaterialDialogs";
import { ProjectTaskCenter } from "../../tasks/ProjectTaskCenter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => ({ session: { user: { id: "owner" } } }) }));
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
    return Response.json({ items: [{ id: "workflow:task", domain: "workflow", title: "生成", status: "failed", rawStatus: "failed", updatedAt: "2026-10-27T00:00:00Z", createdAt: "2026-10-27T00:00:00Z", href: "/p?nodeId=tool", actions: [{ kind: "retry_workflow", targetId: "tool" }] }], nextCursor: null, counts: { running: 0, attention: 1 } });
  }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ProjectTaskCenter projectId="p" /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: /^项目任务/ }));
  fireEvent.click(await screen.findByRole("button", { name: "重试执行" }));
  await waitFor(() => expect(requests).toContain("POST /api/projects/p/workflow/nodes/tool/execute"));
  expect(requests.some(url => url === "POST /api/projects/p/workflow/nodes/tool/execute")).toBe(true);
  expect(requests.some(url => url.startsWith("POST /api/generations"))).toBe(false);
});
