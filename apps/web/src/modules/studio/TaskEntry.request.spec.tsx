// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TaskEntry } from "./TaskEntry";
import { fetchWorkflow, patchWorkflow } from "../board/workflow/workflow-api";
import "fake-indexeddb/auto";
import { draftRepository } from "../../components/drafts/draft-repository";
import { createAgentConversation } from "../board/agent/agent-api";
import { studioFixture } from "./studio-test-fixtures";
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ session: { user: { id: "task-owner" } } }) }));
vi.mock("../board/agent/agent-api", () => ({ createAgentConversation: vi.fn() }));
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
it("将需求与参考图交给统一助手，进入工作台前不执行生成", async () => {
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
  vi.mocked(createAgentConversation).mockResolvedValue({ id: "task-chat" } as never);
  const fetcher = vi.fn();
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
  fireEvent.click(screen.getByRole("button", { name: "进入设计工作台" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/project-1?conversationId=task-chat"));
  expect(fetcher).not.toHaveBeenCalled();
  expect(createAgentConversation).toHaveBeenCalledOnce();
  const operations = vi.mocked(patchWorkflow).mock.calls[0]?.[1];
  expect(operations?.mode).toBe("semantic");
  if (operations?.mode === "semantic") expect(operations.operations.every(operation => operation.type === "add_node" && operation.node.type === "reference_image")).toBe(true);
  const record = await draftRepository.read<{ prompt: string; referencedIds: string[] }>(JSON.stringify(["task-owner", "project-1", "workspace", "assistant:task-chat"]));
  expect(record?.value.prompt).toContain("保留短衣长与双口袋");
  expect(record?.value.referencedIds).toHaveLength(1);
});
