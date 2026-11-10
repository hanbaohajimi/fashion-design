// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { DraftScopeProvider } from "../../../components/drafts/use-persistent-draft";
import { draftRepository } from "../../../components/drafts/draft-repository";
import { CanvasApiError } from "./canvas-api";
import { useGeneratedFilePlacement } from "./use-generated-file-placement";
const api = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("./canvas-api", async original => ({ ...await original<typeof import("./canvas-api")>(), runCanvasCommand: api.run }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });
function setup(onPlaced = vi.fn(async () => {})) {
  const scope = { accountId: crypto.randomUUID(), projectId: "project", editor: "workspace" };
  const wrapper = ({ children }: { children: ReactNode }) => <DraftScopeProvider scope={scope}>{children}</DraftScopeProvider>;
  const mount = () => renderHook(() => useGeneratedFilePlacement("project", onPlaced), { wrapper });
  return { mount, scope, onPlaced };
}
const input = { assetId: "archived-image", archived: true, title: "旧稿", position: { x: 100, y: 200 } };

it("刷新不自动提交，重新确认使用相同编号和位置", async () => {
  const h = setup(), first = h.mount();
  await waitFor(() => expect(first.result.current.ready).toBe(true));
  api.run.mockRejectedValueOnce(new Error("响应丢失"));
  await act(async () => { await expect(first.result.current.execute(input)).rejects.toThrow("响应丢失"); });
  const command = first.result.current.pending?.command; first.unmount();
  const next = h.mount(); await waitFor(() => expect(next.result.current.pending?.command).toEqual(command));
  expect(api.run).toHaveBeenCalledTimes(1);
  api.run.mockResolvedValueOnce({ nodeId: "placed" });
  await act(async () => { await next.result.current.execute(); });
  expect(api.run.mock.calls[1]?.[1]).toEqual(command); expect(h.onPlaced).toHaveBeenCalledTimes(1);
  expect(next.result.current.pending).toBeNull();
});

it("白板应用失败仍保留操作，下次确认不会创建新的放置", async () => {
  const applied = vi.fn().mockRejectedValueOnce(new Error("白板保存冲突")).mockResolvedValueOnce(undefined);
  const h = setup(applied), view = h.mount(); await waitFor(() => expect(view.result.current.ready).toBe(true));
  api.run.mockResolvedValue({ nodeId: "placed" });
  await act(async () => { await expect(view.result.current.execute(input)).rejects.toThrow("白板保存冲突"); });
  const first = view.result.current.pending?.command;
  await act(async () => { await view.result.current.execute(); });
  expect(api.run.mock.calls.map(call => call[1])).toEqual([first, first]);
  expect(view.result.current.pending).toBeNull();
});

it("连续点击共用在途操作，切换或关闭面板取消读取且不应用迟到结果", async () => {
  const h = setup(), view = h.mount(); await waitFor(() => expect(view.result.current.ready).toBe(true));
  let resolve!: (value: unknown) => void; api.run.mockImplementation(() => new Promise(done => { resolve = done; }));
  let a!: Promise<string | undefined>, b!: Promise<string | undefined>;
  act(() => { a = view.result.current.execute(input); b = view.result.current.execute(input); });
  expect(a).toBe(b); await waitFor(() => expect(api.run).toHaveBeenCalledTimes(1));
  const signal = api.run.mock.calls[0]?.[2] as AbortSignal;
  view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => { resolve({ nodeId: "late" }); await a; });
  expect(h.onPlaced).not.toHaveBeenCalled();
  const next = h.mount(); await waitFor(() => expect(next.result.current.pending?.command.assetId).toBe(input.assetId));
});

it("明确拒绝清除待确认编号，存储失败不发送请求", async () => {
  const h = setup(), view = h.mount(); await waitFor(() => expect(view.result.current.ready).toBe(true));
  api.run.mockRejectedValueOnce(new CanvasApiError("没有编辑权限", 403));
  await act(async () => { await expect(view.result.current.execute(input)).rejects.toThrow("没有编辑权限"); });
  expect(view.result.current.pending).toBeNull();
  vi.spyOn(draftRepository, "write").mockRejectedValueOnce(new Error("存储空间不足"));
  await act(async () => { await expect(view.result.current.execute(input)).rejects.toThrow("存储空间不足"); });
  expect(api.run).toHaveBeenCalledTimes(1);
});

it("另一窗口已有操作时保留其编号，不覆盖成新图片", async () => {
  const h = setup(), first = h.mount(), second = h.mount();
  await waitFor(() => expect(first.result.current.ready && second.result.current.ready).toBe(true));
  api.run.mockRejectedValueOnce(new Error("网络未确认"));
  await act(async () => { await expect(first.result.current.execute(input)).rejects.toThrow(); });
  await act(async () => { await expect(second.result.current.execute({ ...input, assetId: "different" })).rejects.toThrow("上一张图片"); });
  expect(api.run).toHaveBeenCalledTimes(1);
  expect(second.result.current.pending?.command).toEqual(first.result.current.pending?.command);
});

it("两窗口同时放置时只有先保存的请求发出，另一窗口读取同一待办", async () => {
  const h = setup(), first = h.mount(), second = h.mount();
  await waitFor(() => expect(first.result.current.ready && second.result.current.ready).toBe(true));
  api.run.mockRejectedValue(new Error("服务器响应未知"));
  await act(async () => { await Promise.allSettled([first.result.current.execute(input), second.result.current.execute({ ...input, assetId: "other" })]); });
  expect(api.run).toHaveBeenCalledTimes(1);
  expect(first.result.current.pending?.command).toEqual(second.result.current.pending?.command);
  const key = JSON.stringify([h.scope.accountId, "project", "workspace", "generated-file-placement"]);
  expect(await draftRepository.conflicts(key)).toEqual([]);
});
