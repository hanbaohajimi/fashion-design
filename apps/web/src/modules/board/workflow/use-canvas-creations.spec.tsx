// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyCanvasCreationDraft, type CanvasCreation } from "@fashion/shared";
import { DraftScopeProvider } from "../../../components/drafts/use-persistent-draft";
import { createCreation, fetchCreations, runCreation, updateCreation } from "./creation-api";
import { useCanvasCreations } from "./use-canvas-creations";

vi.mock("./creation-api", () => ({ createCreation: vi.fn(), fetchCreations: vi.fn(), runCreation: vi.fn(), updateCreation: vi.fn() }));
const initial: CanvasCreation = { id: "target", projectId: "project", module: "image", title: "图片创作", revision: 0, draft: { ...emptyCanvasCreationDraft(), prompt: "原始要求" }, position: { x: 0, y: 0 }, currentResult: null, currentResultNodeId: null, runs: [], resource: null, removed: false, createdAt: "2026-11-14T00:00:00Z", updatedAt: "2026-11-14T00:00:00Z" };
const wrapper = ({ children }: { children: ReactNode }) => <DraftScopeProvider scope={{ accountId: "alice", projectId: "project", editor: "canvas" }}>{children}</DraftScopeProvider>;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear();
  vi.mocked(fetchCreations).mockResolvedValue({ items: [initial], canEdit: true });
});
afterEach(cleanup);

describe("创作命令回执与作用域", () => {
  it("提交尚未返回时切回同一目标仍复用正在执行的请求", async () => {
    const hook = renderHook(() => useCanvasCreations("project", true), { wrapper });
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    const reply = deferred<CanvasCreation>();
    vi.mocked(runCreation).mockReturnValueOnce(reply.promise).mockResolvedValue(initial);
    let first!: Promise<CanvasCreation>, repeated!: Promise<CanvasCreation>;
    act(() => { first = hook.result.current.run("target", "conversation"); });
    await waitFor(() => expect(runCreation).toHaveBeenCalledTimes(1));
    expect(hook.result.current.isSubmitting("target")).toBe(true);
    act(() => { repeated = hook.result.current.run("target", "conversation"); });
    expect(repeated).toBe(first);
    await act(async () => { reply.resolve(initial); await Promise.all([first, repeated]); });
    expect(runCreation).toHaveBeenCalledTimes(1);
    expect(hook.result.current.isSubmitting("target")).toBe(false);
    await act(async () => { await hook.result.current.run("target", "conversation"); });
    expect(runCreation).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runCreation).mock.calls[1]?.[2].mutationId).not.toBe(vi.mocked(runCreation).mock.calls[0]?.[2].mutationId);
  });

  it("未知生成回执复用原编号，不把重试变成新任务", async () => {
    const hook = renderHook(() => useCanvasCreations("project", true), { wrapper });
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    vi.mocked(runCreation).mockRejectedValueOnce(new TypeError("connection lost")).mockResolvedValue(initial);
    await act(async () => { await expect(hook.result.current.run("target", "conversation")).rejects.toThrow("connection lost"); });
    expect(hook.result.current.hasPending("target")).toBe(true);
    await act(async () => { await hook.result.current.run("target", "conversation"); });
    expect(vi.mocked(runCreation).mock.calls[0]?.[2]).toEqual(vi.mocked(runCreation).mock.calls[1]?.[2]);
    expect(hook.result.current.hasPending("target")).toBe(false);
  });

  it("保存未确认时先恢复原请求，后来的输入不会被替换提交", async () => {
    const hook = renderHook(() => useCanvasCreations("project", true), { wrapper });
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    const draft = { ...initial.draft, prompt: "第一次修改" };
    vi.mocked(updateCreation).mockRejectedValueOnce(new TypeError("lost")).mockResolvedValue({ ...initial, revision: 1, draft });
    await act(async () => { await expect(hook.result.current.update("target", { draft })).rejects.toThrow(); });
    await act(async () => { await expect(hook.result.current.update("target", { draft: { ...draft, prompt: "后来的要求" } })).rejects.toThrow("回执尚未确认"); });
    expect(updateCreation).toHaveBeenCalledTimes(1);
    await act(async () => { await hook.result.current.retrySave("target"); });
    expect(vi.mocked(updateCreation).mock.calls[0]?.[2]).toEqual(vi.mocked(updateCreation).mock.calls[1]?.[2]);
  });

  it("迟到的读取不能覆盖已经确认的新要求", async () => {
    const hook = renderHook(() => useCanvasCreations("project", true), { wrapper });
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    const read = deferred<{ items: CanvasCreation[]; canEdit: boolean }>();
    vi.mocked(fetchCreations).mockReturnValueOnce(read.promise);
    const pending = hook.result.current.refresh();
    const draft = { ...initial.draft, prompt: "新的要求" };
    vi.mocked(updateCreation).mockResolvedValue({ ...initial, revision: 1, draft });
    await act(async () => { await hook.result.current.update("target", { draft }); });
    await act(async () => { read.resolve({ items: [initial], canEdit: true }); await pending; });
    expect(hook.result.current.items[0]?.draft.prompt).toBe("新的要求");
  });

  it("离开工作区后停止后续动作，未知创建在重开后仍复用目标身份", async () => {
    const first = renderHook(() => useCanvasCreations("project", true), { wrapper });
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    const packet = { id: crypto.randomUUID(), mutationId: crypto.randomUUID(), title: "新图", module: "image" as const, draft: initial.draft, position: { x: 10, y: 10 } };
    vi.mocked(createCreation).mockRejectedValueOnce(new TypeError("lost"));
    await act(async () => { await expect(first.result.current.create(packet)).rejects.toThrow(); }); first.unmount();
    const second = renderHook(() => useCanvasCreations("project", true), { wrapper });
    await waitFor(() => expect(second.result.current.loaded).toBe(true));
    const returned = { ...initial, ...packet };
    vi.mocked(createCreation).mockResolvedValue(returned);
    await act(async () => { await second.result.current.create({ ...packet, id: crypto.randomUUID(), mutationId: crypto.randomUUID(), position: { x: 500, y: 100 } }); });
    expect(vi.mocked(createCreation).mock.calls[1]?.[1]).toEqual(packet);
    const reply = deferred<CanvasCreation>(); vi.mocked(updateCreation).mockReturnValue(reply.promise);
    const updating = second.result.current.update("target", { draft: initial.draft });
    await waitFor(() => expect(updateCreation).toHaveBeenCalled()); second.unmount();
    reply.resolve({ ...initial, revision: 1 }); await expect(updating).rejects.toMatchObject({ name: "AbortError" });
  });
});
