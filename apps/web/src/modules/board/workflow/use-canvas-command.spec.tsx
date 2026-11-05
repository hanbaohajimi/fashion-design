// @vitest-environment jsdom
import "fake-indexeddb/auto";
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CanvasCommand } from "@fashion/shared";
import { DraftScopeProvider } from "../../../components/drafts/use-persistent-draft";
import { useCanvasCommand } from "./use-canvas-command";
import { CanvasApiError } from "./canvas-api";

const api = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("./canvas-api", async (importOriginal) => ({ ...await importOriginal<typeof import("./canvas-api")>(), runCanvasCommand: api.run }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("allows correction after a definite validation rejection", async () => {
  const view = renderHook(() => useCanvasCommand("project", crypto.randomUUID()));
  const command: CanvasCommand = { type: "run_tool", mutationId: crypto.randomUUID(), toolKey: "edit_design", title: "修改", parameters: {}, inputs: [] };
  api.run.mockRejectedValueOnce(new CanvasApiError("缺少母图", 400));
  await act(async () => { await expect(view.result.current.execute(command)).rejects.toThrow("缺少母图"); });
  expect(view.result.current.pending).toBeNull();
  api.run.mockResolvedValueOnce({ nodeId: "corrected" });
  const corrected = { ...command, mutationId: crypto.randomUUID(), inputs: [{ nodeId: "source", port: "source" as const }] };
  await act(async () => { await view.result.current.execute(corrected); });
  expect(api.run).toHaveBeenLastCalledWith("project", corrected);
});

it("restores a lost acknowledgement after remount without automatically executing or changing the request", async () => {
  const objectKey = crypto.randomUUID();
  const scope = {
    accountId: "canvas-command-test",
    projectId: "project",
    editor: "image",
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DraftScopeProvider scope={scope}>{children}</DraftScopeProvider>
  );
  const command: CanvasCommand = {
    type: "run_tool",
    mutationId: crypto.randomUUID(),
    toolKey: "edit_design",
    title: "修改",
    parameters: { taskType: "i2i", prompt: "修改领口" },
    inputs: [{ nodeId: "source", port: "source" }],
    conversationId: "original-conversation",
  };
  api.run.mockRejectedValueOnce(new Error("response lost"));
  const first = renderHook(() => useCanvasCommand("project", objectKey), {
    wrapper,
  });
  await act(async () => {
    await expect(first.result.current.execute(command)).rejects.toThrow(
      "response lost",
    );
  });
  first.unmount();
  const restored = renderHook(() => useCanvasCommand("project", objectKey), {
    wrapper,
  });
  await waitFor(() => expect(restored.result.current.pending).toEqual(command));
  expect(api.run).toHaveBeenCalledTimes(1);
  await act(async () => {
    await expect(
      restored.result.current.execute({
        ...command,
        mutationId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("上一项操作");
  });
  api.run.mockResolvedValueOnce({ nodeId: "original-tool" });
  await act(async () => {
    await restored.result.current.execute();
  });
  expect(api.run).toHaveBeenLastCalledWith("project", command);
  expect(restored.result.current.pending).toBeNull();
  restored.unmount();
  const final = renderHook(() => useCanvasCommand("project", objectKey), {
    wrapper,
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(final.result.current.pending).toBeNull();
  expect(api.run).toHaveBeenCalledTimes(2);
});
