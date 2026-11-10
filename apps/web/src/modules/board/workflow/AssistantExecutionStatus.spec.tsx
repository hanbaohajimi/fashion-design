// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkflowExecutionProgress } from "@fashion/shared";
import { AssistantExecutionStatus } from "./AssistantExecutionStatus";
const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../auth/AuthProvider", () => ({
  useAuth: () => ({ session: { user: { id: "user-a" } } }),
}));
vi.mock("../../auth/private-fetch", () => ({ privateFetch: api.fetch }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
const queued: WorkflowExecutionProgress = {
  version: 1,
  executionId: "execution",
  toolNodeId: "tool",
  title: "风衣方案",
  operation: "image",
  status: "queued",
  updatedAt: "2026-11-10T10:00:00Z",
  counts: {
    total: 2,
    queued: 2,
    running: 0,
    preparing: 0,
    completed: 0,
    failed: 0,
    canceled: 0,
  },
  cancelTaskIds: ["task-a", "task-b"],
};
function setup() {
  const cache = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
    onRefresh = vi.fn();
  const tree = (progress = queued) => (
    <QueryClientProvider client={cache}>
      <AssistantExecutionStatus
        progress={progress}
        projectId="project"
        onRefresh={onRefresh}
      />
    </QueryClientProvider>
  );
  const view = render(tree());
  return { ...view, onRefresh, tree };
}
it("停止只发送当前未完成任务，返回后继续核对而不假装已经取消", async () => {
  api.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
  const view = setup();
  fireEvent.click(
    screen.getByRole("button", { name: /^停止 \d+ 项图片任务$/ }),
  );
  await waitFor(() => expect(view.onRefresh).toHaveBeenCalledOnce());
  expect(api.fetch.mock.calls.map((call) => call[0])).toEqual([
    "/api/generations/task-a",
    "/api/generations/task-b",
  ]);
  expect(screen.getByText("已请求停止，正在核对执行结果。")).toBeTruthy();
  expect(screen.getByText("排队中")).toBeTruthy();
  view.rerender(
    view.tree({
      ...queued,
      status: "canceled",
      counts: { ...queued.counts, queued: 0, canceled: 2 },
      cancelTaskIds: [],
    }),
  );
  expect(screen.getByText("已取消")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: /^停止 \d+ 项图片任务$/ }),
  ).toBeNull();
});
it("部分停止失败保留真实进度，可重新读取而不是自动重试执行", async () => {
  api.fetch
    .mockResolvedValueOnce(new Response("{}", { status: 200 }))
    .mockRejectedValueOnce(new Error("offline"));
  const view = setup();
  fireEvent.click(
    screen.getByRole("button", { name: /^停止 \d+ 项图片任务$/ }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("尚未全部确认"),
  );
  fireEvent.click(screen.getByRole("button", { name: "重新读取状态" }));
  expect(view.onRefresh).toHaveBeenCalledTimes(2);
  expect(api.fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByText("排队中")).toBeTruthy();
});
it("切换或卸载中断停止请求，迟到响应不刷新另一会话", async () => {
  const finish: ((value: Response) => void)[] = [];
  api.fetch.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish.push(resolve);
      }),
  );
  const view = setup();
  fireEvent.click(
    screen.getByRole("button", { name: /^停止 \d+ 项图片任务$/ }),
  );
  expect(api.fetch).toHaveBeenCalledTimes(2);
  const signal = api.fetch.mock.calls[0]?.[1]?.signal as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    finish.forEach((resolve) => resolve(new Response("{}", { status: 200 })));
    await Promise.resolve();
  });
  expect(view.onRefresh).not.toHaveBeenCalled();
});
