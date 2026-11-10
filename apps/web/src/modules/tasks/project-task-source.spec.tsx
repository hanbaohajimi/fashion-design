// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectTaskCenter } from "./ProjectTaskCenter";
import { fetchTaskPage, ProjectTaskProvider, useProjectTaskSource } from "./project-task-source";
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ session: { user: { id: "user-a" } } }) }));

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
