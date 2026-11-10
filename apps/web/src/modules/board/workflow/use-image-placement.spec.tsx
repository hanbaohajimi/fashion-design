// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { DraftScopeProvider } from "../../../components/drafts/use-persistent-draft";
import { draftRepository } from "../../../components/drafts/draft-repository";
import { CanvasApiError } from "./canvas-api";
import {
  useImagePlacement,
  type PendingImagePlacement,
} from "./use-image-placement";

const api = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("./canvas-api", async (original) => ({
  ...(await original<typeof import("./canvas-api")>()),
  runCanvasCommand: api.run,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
const input = (): PendingImagePlacement<"place_reference_image"> => ({
  title: "参考图",
  command: {
    type: "place_reference_image",
    mutationId: crypto.randomUUID(),
    nodeId: "reference",
    position: { x: 100, y: 200 },
  },
});
function setup(onPlaced = vi.fn(async () => {})) {
  const scope = {
    accountId: crypto.randomUUID(),
    projectId: "project",
    editor: "workspace",
  };
  const key = JSON.stringify([
    scope.accountId,
    "project",
    "workspace",
    "reference-placement:reference",
  ]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DraftScopeProvider scope={scope}>{children}</DraftScopeProvider>
  );
  const mount = () =>
    renderHook(
      () =>
        useImagePlacement(
          "project",
          "reference-placement:reference",
          "place_reference_image",
          onPlaced,
          "reference",
        ),
      { wrapper },
    );
  return { scope, key, mount, onPlaced };
}

it("参考放置待办只在明确继续时重试原编号及位置", async () => {
  const h = setup(),
    first = h.mount(),
    selected = input();
  await waitFor(() => expect(first.result.current.ready).toBe(true));
  api.run.mockRejectedValueOnce(new Error("回执未知"));
  await act(async () => {
    await expect(first.result.current.execute(selected)).rejects.toThrow(
      "回执未知",
    );
  });
  first.unmount();
  const next = h.mount();
  await waitFor(() => expect(next.result.current.pending).toEqual(selected));
  expect(api.run).toHaveBeenCalledTimes(1);
  api.run.mockResolvedValueOnce({ nodeId: "reference" });
  await act(async () => {
    await next.result.current.execute();
  });
  expect(api.run.mock.calls.map((call) => call[1])).toEqual([
    selected.command,
    selected.command,
  ]);
  expect(next.result.current.pending).toBeNull();
});

it("回执已到但画布应用失败，仍保留同一放置直到应用完成", async () => {
  const h = setup(
      vi
        .fn()
        .mockRejectedValueOnce(new Error("白板保存冲突"))
        .mockResolvedValueOnce(undefined),
    ),
    view = h.mount();
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  const selected = input();
  api.run.mockResolvedValue({ nodeId: "reference" });
  await act(async () => {
    await expect(view.result.current.execute(selected)).rejects.toThrow(
      "白板保存冲突",
    );
  });
  expect(view.result.current.pending).toEqual(selected);
  await act(async () => {
    await view.result.current.execute();
  });
  expect(api.run.mock.calls[1]?.[1]).toEqual(selected.command);
  expect(await draftRepository.read(h.key)).toBeUndefined();
});

it("关闭会中断请求且不应用迟到结果，重新打开保留恢复记录", async () => {
  const h = setup(),
    view = h.mount();
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  let resolve!: (value: unknown) => void;
  api.run.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  let pending!: Promise<string | undefined>;
  act(() => {
    pending = view.result.current.execute(input());
  });
  await waitFor(() => expect(api.run).toHaveBeenCalledTimes(1));
  const signal = api.run.mock.calls[0]?.[2] as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolve({ nodeId: "reference" });
    await pending;
  });
  expect(h.onPlaced).not.toHaveBeenCalled();
  const next = h.mount();
  await waitFor(() =>
    expect(next.result.current.pending?.command.nodeId).toBe("reference"),
  );
});

it("持久化记录不允许串用生成文件或另一张参考", async () => {
  const h = setup();
  await draftRepository.write(
    {
      key: h.key,
      accountId: h.scope.accountId,
      baseline: "null",
      value: {
        ...input(),
        command: { ...input().command, nodeId: "another-reference" },
      },
    },
    0,
  );
  const view = h.mount();
  await waitFor(() => expect(view.result.current.error).toContain("无法读取"));
  expect(view.result.current.ready).toBe(false);
  expect(api.run).not.toHaveBeenCalled();
});

it("明确拒绝允许重新选择，记录保存失败不发送请求", async () => {
  const h = setup(),
    view = h.mount();
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  api.run.mockRejectedValueOnce(new CanvasApiError("权限已变化", 403));
  await act(async () => {
    await expect(view.result.current.execute(input())).rejects.toThrow(
      "权限已变化",
    );
  });
  expect(view.result.current.pending).toBeNull();
  vi.spyOn(draftRepository, "write").mockRejectedValueOnce(
    new Error("本机记录保存失败"),
  );
  await act(async () => {
    await expect(view.result.current.execute(input())).rejects.toThrow(
      "本机记录保存失败",
    );
  });
  expect(api.run).toHaveBeenCalledTimes(1);
});
