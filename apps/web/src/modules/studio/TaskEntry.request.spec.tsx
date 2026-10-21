// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { workflowExecuteSchema } from "../../../../api/src/modules/workflow-runtime/workflow-runtime.schemas";
import { TaskEntry } from "./TaskEntry";
import { fetchWorkflow, patchWorkflow } from "../board/workflow/workflow-api";
import { studioFixture } from "./studio-test-fixtures";
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../board/workflow/workflow-api", () => ({
  fetchWorkflow: vi.fn(),
  patchWorkflow: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("sends a valid independent UUID and reuses it when the execute response is lost", async () => {
  const graph = {
    projectId: "project-1",
    revision: 3,
    layoutRevision: 0,
    nodes: [],
    edges: [],
    legacyAvailable: false,
  };
  vi.mocked(fetchWorkflow).mockResolvedValue(graph);
  vi.mocked(patchWorkflow).mockResolvedValue({ ...graph, revision: 4 });
  let attempts = 0;
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body));
      expect(workflowExecuteSchema.safeParse(body).success).toBe(true);
      attempts++;
      if (attempts === 1) throw new Error("执行响应丢失");
      return new Response(JSON.stringify(graph), { status: 200 });
    },
  );
  vi.stubGlobal("fetch", fetcher);
  render(
    <TaskEntry
      projectId="project-1"
      data={studioFixture()}
      canEdit
      onDirty={vi.fn()}
      onSaved={vi.fn(async () => {})}
      beforeChange={vi.fn(async () => true)}
    />,
  );
  fireEvent.change(screen.getByLabelText("本次任务"), {
    target: { value: "将草图呈现为灰绿棉尼龙效果图" },
  });
  fireEvent.change(screen.getByLabelText(/^必须保留/), {
    target: { value: "保留短衣长与双口袋" },
  });
  fireEvent.click(screen.getByRole("button", { name: "选择图片 1" }));
  fireEvent.click(screen.getByRole("button", { name: "建立并运行任务" }));
  await screen.findByText("执行响应丢失");
  fireEvent.click(screen.getByRole("button", { name: "建立并运行任务" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/project-1"));
  expect(fetcher).toHaveBeenCalledTimes(2);
  const bodies = fetcher.mock.calls.map(([, options]) =>
    JSON.parse(String(options?.body)),
  );
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0].mutationId).not.toBe(
    vi.mocked(patchWorkflow).mock.calls[0]?.[1].mutationId,
  );
  expect(vi.mocked(patchWorkflow).mock.calls[0]).toEqual(
    vi.mocked(patchWorkflow).mock.calls[1],
  );
});
