// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import type { TLShape, TLStore, TLEditorSnapshot } from "tldraw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BoardLoadResponse, BoardPatchPayload, BoardPatchResponse } from "../board-api";
import { fetchBoard, patchBoard } from "../board-api";
import { useBoardPersist } from "./useBoardPersist";

interface StoreChange {
  readonly changes: {
    readonly added: Record<string, TLShape>;
    readonly updated: Record<string, [TLShape, TLShape]>;
    readonly removed: Record<string, TLShape>;
  };
}

interface TestStore {
  snapshot: TLEditorSnapshot;
  listen: (listener: (change: StoreChange) => void) => () => void;
  mergeRemoteChanges: (action: () => void) => void;
}

const mocks = vi.hoisted(() => ({ loadSnapshot: vi.fn() }));

vi.mock("tldraw", () => ({
  getSnapshot: (store: TestStore) => store.snapshot,
  loadSnapshot: (store: TestStore, snapshot: TLEditorSnapshot) => {
    mocks.loadSnapshot(store, snapshot);
    store.snapshot = snapshot;
  },
}));
vi.mock("../board-api", () => ({
  fetchBoard: vi.fn(),
  patchBoard: vi.fn(),
  BoardApiError: class extends Error {},
}));
vi.mock("../shapes", () => ({
  IMAGE_SHAPE_TYPE: "fashion-image",
  isBoardShape: () => false,
  normalizeBoardRole: (role: string) => role,
}));
vi.mock("../../../observability/analytics", () => ({ captureAnalytics: vi.fn() }));

function snapshot(label: string): TLEditorSnapshot {
  return { document: { label } } as unknown as TLEditorSnapshot;
}

function board(label: string, revision = 1): BoardLoadResponse {
  return { elements: [], revision, snapshot: snapshot(label) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createStore() {
  const listeners = new Set<(change: StoreChange) => void>();
  const store: TestStore = {
    snapshot: snapshot("empty"),
    listen: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    mergeRemoteChanges: (action) => action(),
  };
  return {
    listeners,
    store: store as unknown as TLStore,
    edit(label: string) {
      const shape = {
        id: `shape:${label}`,
        typeName: "shape",
        type: "geo",
        meta: {},
        props: {},
      } as unknown as TLShape;
      store.snapshot = snapshot(label);
      for (const listener of listeners) {
        listener({ changes: { added: { [shape.id]: shape }, updated: {}, removed: {} } });
      }
    },
  };
}

function readOutbox(): BoardPatchPayload | null {
  const value = sessionStorage.getItem("fashion-board-outbox:project-a");
  return value ? JSON.parse(value) as BoardPatchPayload : null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.mocked(fetchBoard).mockReset().mockResolvedValue(board("server"));
  vi.mocked(patchBoard).mockReset().mockResolvedValue({ batchId: "saved", revision: 2, savedAt: "now" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("画布保存生命周期", () => {
  it("切换项目后忽略旧项目迟到的快照，不再覆盖新画布或注册监听", async () => {
    const previous = deferred<BoardLoadResponse>();
    vi.mocked(fetchBoard).mockReturnValueOnce(previous.promise).mockResolvedValueOnce(board("project-b"));
    const canvas = createStore();
    const hook = renderHook(({ projectId }) => useBoardPersist(projectId, canvas.store), {
      initialProps: { projectId: "project-a" },
    });

    await act(async () => hook.rerender({ projectId: "project-b" }));
    expect(hook.result.current.status).toBe("ready");
    await act(async () => previous.resolve(board("project-a")));

    expect(mocks.loadSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.loadSnapshot).toHaveBeenLastCalledWith(canvas.store, snapshot("project-b"));
    expect(canvas.listeners.size).toBe(1);
    expect(hook.result.current.status).toBe("ready");
  });

  it("切换项目后旧请求失败不会让当前画布进入错误状态", async () => {
    const previous = deferred<BoardLoadResponse>();
    vi.mocked(fetchBoard).mockReturnValueOnce(previous.promise).mockResolvedValueOnce(board("project-b"));
    const canvas = createStore();
    const hook = renderHook(({ projectId }) => useBoardPersist(projectId, canvas.store), {
      initialProps: { projectId: "project-a" },
    });

    await act(async () => hook.rerender({ projectId: "project-b" }));
    await act(async () => previous.reject(new Error("旧请求失败")));

    expect(hook.result.current.status).toBe("ready");
    expect(hook.result.current.error).toBeNull();
  });

  it.each(["success", "failure"] as const)("卸载后保存 %s 不改写下一次编辑的本机恢复内容", async (outcome) => {
    const saving = deferred<BoardPatchResponse>();
    vi.mocked(patchBoard).mockReturnValueOnce(saving.promise);
    const canvas = createStore();
    const hook = renderHook(() => useBoardPersist("project-a", canvas.store));
    await act(async () => undefined);
    act(() => canvas.edit("first"));
    await act(() => vi.advanceTimersByTimeAsync(1_500));
    expect(patchBoard).toHaveBeenCalledTimes(1);
    hook.unmount();

    const newerDraft = JSON.stringify({ ...readOutbox(), batchId: "newer-draft", snapshot: snapshot("newer") });
    sessionStorage.setItem("fashion-board-outbox:project-a", newerDraft);
    await act(async () => {
      if (outcome === "success") saving.resolve({ batchId: "saved", revision: 2, savedAt: "now" });
      else saving.reject(new Error("连接中断"));
    });

    expect(sessionStorage.getItem("fashion-board-outbox:project-a")).toBe(newerDraft);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(patchBoard).toHaveBeenCalledTimes(1);
  });

  it("保存期间继续编辑时立即更新恢复内容和基线，再串行保存新修改", async () => {
    const saving = deferred<BoardPatchResponse>();
    vi.mocked(patchBoard).mockReturnValueOnce(saving.promise);
    const canvas = createStore();
    const hook = renderHook(() => useBoardPersist("project-a", canvas.store));
    await act(async () => undefined);
    act(() => canvas.edit("first"));
    await act(() => vi.advanceTimersByTimeAsync(1_500));
    act(() => canvas.edit("second"));

    await act(async () => saving.resolve({ batchId: "first-save", revision: 2, savedAt: "now" }));
    expect(hook.result.current.status).toBe("saving");
    expect(readOutbox()).toMatchObject({
      baseRevision: 2,
      patches: [{ shapeId: "shape:second" }],
      snapshot: snapshot("second"),
    });
    await act(() => vi.advanceTimersByTimeAsync(1_500));

    expect(patchBoard).toHaveBeenCalledTimes(2);
    expect(vi.mocked(patchBoard).mock.calls[1]?.[1]).toMatchObject({ baseRevision: 2, snapshot: snapshot("second") });
    expect(hook.result.current.status).toBe("saved");
    expect(readOutbox()).toBeNull();
  });

  it("本机恢复记录清理失败不会重试已成功保存的服务端操作", async () => {
    const canvas = createStore();
    const hook = renderHook(() => useBoardPersist("project-a", canvas.store));
    await act(async () => undefined);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    act(() => canvas.edit("first"));
    await act(() => vi.advanceTimersByTimeAsync(1_500));

    expect(hook.result.current.status).toBe("saved");
    expect(hook.result.current.error).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(patchBoard).toHaveBeenCalledTimes(1);
  });
});
