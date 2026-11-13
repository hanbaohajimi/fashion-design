// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { AssistantDelegationsPanel } from "./AssistantDelegationsPanel";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  fetch: vi.fn(),
  remove: vi.fn(),
  run: vi.fn(),
  update: vi.fn(),
}));

vi.mock("./assistant-delegations-api", () => ({
  createAssistantDelegationRemote: mocks.create,
  deleteAssistantDelegationRemote: mocks.remove,
  fetchAssistantDelegations: mocks.fetch,
  runAssistantDelegationRemote: mocks.run,
  updateAssistantDelegationRemote: mocks.update,
}));

const item = {
  cadence: "WEEKLY" as const,
  conversationId: "conversation-a",
  createdAt: "2026-11-11T00:00:00.000Z",
  id: "delegation-a",
  lastError: null,
  lastRunAt: null,
  name: "每周复盘",
  nextRunAt: "2026-11-12T03:04:05.000Z",
  ownerId: "user-a",
  projectId: "project-a",
  prompt: "检查当前方案并列出下一步",
  runCount: 0,
  status: "ACTIVE" as const,
  timeZone: "Asia/Shanghai",
  updatedAt: "2026-11-11T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("读取委托列表并把立即运行反馈为执行中", async () => {
  mocks.fetch.mockResolvedValue([item]);
  mocks.run.mockResolvedValue({ ...item, status: "RUNNING" });
  render(
    <AssistantDelegationsPanel
      canEdit
      conversationId="conversation-a"
      onClose={vi.fn()}
      projectId="project-a"
    />,
  );

  await waitFor(() => expect(screen.getByText("每周复盘")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "立即运行" }));
  await waitFor(() => expect(mocks.run).toHaveBeenCalledWith("delegation-a"));
  expect(screen.getByText(/执行中/)).toBeTruthy();
});
