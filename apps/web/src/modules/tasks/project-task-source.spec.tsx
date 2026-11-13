// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectTaskCenter } from "./ProjectTaskCenter";
import { fetchTaskPage, ProjectTaskProvider, useProjectTaskSource } from "./project-task-source";
const mocks = vi.hoisted(() => ({ toastInfo: vi.fn() }));
vi.mock("sonner", () => ({ toast: { info: mocks.toastInfo } }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ session: { user: { id: "user-a" } } }) }));

HTMLDialogElement.prototype.showModal = function () { this.open = true; };
HTMLDialogElement.prototype.close = function () { this.open = false; };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function CharacterReader() {
  const source = useProjectTaskSource();
  return <span data-testid="activity-reader">{source?.summary.data?.counts.running ?? "loading"}</span>;
}

it("任务中心和两个只读消费者使用同一个查询，切换项目不借用上一项目结果", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ items: [], nextCursor: null, counts: { running: 2, attention: 0 } }));
  vi.stubGlobal("fetch", fetcher);
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (projectId: string) => <QueryClientProvider client={cache}><ProjectTaskProvider projectId={projectId}><ProjectTaskCenter projectId={projectId} /><CharacterReader /><CharacterReader /></ProjectTaskProvider></QueryClientProvider>;
  const view = render(tree("project-a"));
  await waitFor(() => expect(screen.getAllByTestId("activity-reader").every(node => node.textContent === "2")).toBe(true));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe("/api/projects/project-a/tasks?activity=1");
  view.rerender(tree("project-b"));
  expect(screen.getAllByTestId("activity-reader").every(node => node.textContent === "loading")).toBe(true);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  cache.clear();
});

it("旧响应继续可读，损坏的活动摘要作为读取失败而非业务终态", async () => {
  const old = { items: [], nextCursor: null, counts: { running: 0, attention: 0 } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(old)).mockResolvedValueOnce(Response.json({ ...old, activity: { recent: [] } })));
  expect(await fetchTaskPage("/api/old", new AbortController().signal)).toEqual(old);
  await expect(fetchTaskPage("/api/invalid", new AbortController().signal)).rejects.toThrow("活动响应无效");
});

it("任务中心展示项目运行概览和最近活动", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
    items: [],
    nextCursor: null,
    counts: { running: 3, attention: 2 },
    activity: {
      preparing: 2,
      queued: 1,
      executing: 1,
      awaitingUser: 2,
      waiting: { input: 1, confirmation: 1, resume: 0 },
      recent: [{ id: "agent:recent", domain: "agent", outcome: "completed", updatedAt: "2026-11-08T12:00:00Z" }],
    },
  })));
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={cache}><ProjectTaskProvider projectId="project-a"><ProjectTaskCenter projectId="project-a" /></ProjectTaskProvider></QueryClientProvider>);

  await waitFor(() => expect(screen.getByRole("button", { name: "项目任务，3 项进行中，2 项待处理" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "项目任务，3 项进行中，2 项待处理" }));

  const overview = screen.getByRole("region", { name: "项目运行概览" });
  expect(overview.textContent).toContain("5 项工作正在推进或等待你的决定");
  expect(overview.textContent).toContain("准备中");
  fireEvent.click(screen.getByText("最近活动（1）"));
  expect(overview.textContent).toContain("设计运行 · 已完成");
});

it("活跃任务轮询增加待处理项时提示并提供打开入口", async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
    items: [],
    nextCursor: null,
    counts: { running: 0, attention: 0 },
  })));
  render(<QueryClientProvider client={cache}><ProjectTaskProvider projectId="project-a"><ProjectTaskCenter projectId="project-a" /></ProjectTaskProvider></QueryClientProvider>);

  await waitFor(() => expect(cache.getQueryData(["project-tasks", "user-a", "project-a", "active"])).toBeTruthy());
  cache.setQueryData(["project-tasks", "user-a", "project-a", "active"], {
    items: [],
    nextCursor: null,
    counts: { running: 0, attention: 1 },
  });

  await waitFor(() => expect(mocks.toastInfo).toHaveBeenCalledWith("有新的待处理工作", expect.objectContaining({
    description: "可能包含新的评审意见或需要确认的设计方案。",
    action: expect.objectContaining({ label: "查看任务" }),
  })));
});
