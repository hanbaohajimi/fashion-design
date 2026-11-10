// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { DraftScopeProvider } from "../../../components/drafts/use-persistent-draft";
import { draftRepository } from "../../../components/drafts/draft-repository";
import { fetchWorkflow } from "./workflow-api";
import { restoreAssetVersion } from "../generation/generation-api";
import { imageRequest } from "./image-workspace-api";
import { useAssetRestore } from "./use-asset-restore";

vi.mock("./workflow-api", () => ({ fetchWorkflow: vi.fn() }));
vi.mock("./image-workspace-api", () => ({ imageRequest: vi.fn() }));
vi.mock("../generation/generation-api", () => ({
  restoreAssetVersion: vi.fn(),
}));

let accountId: string;
const projectId = "restore-project";
const graph = {
  projectId,
  revision: 1,
  layoutRevision: 0,
  legacyAvailable: false,
  edges: [],
  nodes: [
    {
      id: "source",
      kind: "asset" as const,
      type: "candidate" as const,
      title: "当前图",
      status: "completed",
      x: 0,
      y: 0,
      payload: { assetId: "current" },
      createdAt: "",
      updatedAt: "",
    },
  ],
};
const restored = {
  id: "restored",
  projectId,
  parentAssetId: "current",
  restoredFromAssetId: "target",
  operation: "restore" as const,
  archivedAt: null,
  createdAt: "",
  width: 600,
  height: 800,
  seed: null,
  url: "/content",
  thumbnailUrl: null,
};
const wrapper = ({ children }: { children: ReactNode }) => (
  <DraftScopeProvider scope={{ accountId, projectId, editor: "canvas" }}>
    {children}
  </DraftScopeProvider>
);
const recordKey = () =>
  JSON.stringify([accountId, projectId, "canvas", "asset-restore:current"]);
beforeEach(() => {
  vi.resetAllMocks();
  accountId = crypto.randomUUID();
  vi.mocked(fetchWorkflow).mockResolvedValue(graph);
  vi.mocked(restoreAssetVersion).mockResolvedValue(restored);
  vi.mocked(imageRequest).mockResolvedValue(graph);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("版本恢复的两步持久化", () => {
  it("发送前保存两个操作编号，第二步失败后重新挂载只提供重试并复用相同编号", async () => {
    const first = renderHook(() => useAssetRestore(projectId, "current"), {
      wrapper,
    });
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    vi.mocked(imageRequest).mockRejectedValueOnce(
      new Error("加入画布暂时失败"),
    );
    vi.mocked(restoreAssetVersion).mockImplementation(
      async (_target, _current, requestId) => {
        const record = await draftRepository.read<{
          requestId: string;
          mutationId: string;
        }>(recordKey());
        expect(record?.value.requestId).toBe(requestId);
        expect(record?.value.mutationId).toBeTruthy();
        return restored;
      },
    );
    await act(async () => {
      await expect(first.result.current.restore("target")).rejects.toThrow(
        "加入画布",
      );
    });
    const pending = first.result.current.pending;
    expect(pending).toEqual({
      currentAssetId: "current",
      sourceNodeId: "source",
      targetAssetId: "target",
      requestId: expect.any(String),
      mutationId: expect.any(String),
    });
    first.unmount();
    const next = renderHook(() => useAssetRestore(projectId, "current"), {
      wrapper,
    });
    await waitFor(() => expect(next.result.current.pending).toEqual(pending));
    expect(restoreAssetVersion).toHaveBeenCalledTimes(1);
    await act(async () => {
      await next.result.current.restore();
    });
    expect(restoreAssetVersion).toHaveBeenNthCalledWith(
      2,
      "target",
      "current",
      pending?.requestId,
    );
    expect(vi.mocked(imageRequest).mock.calls[0]).toEqual(
      vi.mocked(imageRequest).mock.calls[1],
    );
    expect(fetchWorkflow).toHaveBeenCalledTimes(1);
    expect(next.result.current.pending).toBeNull();
    expect(await draftRepository.read(recordKey())).toBeUndefined();
  });

  it("创建版本的响应丢失时不执行第二步，重试沿用第一次请求", async () => {
    const { result } = renderHook(() => useAssetRestore(projectId, "current"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    vi.mocked(restoreAssetVersion).mockRejectedValueOnce(new Error("响应丢失"));
    await act(async () => {
      await expect(result.current.restore("target")).rejects.toThrow(
        "响应丢失",
      );
    });
    expect(imageRequest).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.restore();
    });
    expect(vi.mocked(restoreAssetVersion).mock.calls[0]).toEqual(
      vi.mocked(restoreAssetVersion).mock.calls[1],
    );
  });

  it("本机记录写入失败时不会开始恢复", async () => {
    const { result } = renderHook(() => useAssetRestore(projectId, "current"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    vi.spyOn(draftRepository, "write").mockRejectedValueOnce(
      new Error("存储空间不足"),
    );
    await act(async () => {
      await expect(result.current.restore("target")).rejects.toThrow(
        "存储空间不足",
      );
    });
    expect(fetchWorkflow).toHaveBeenCalledTimes(1);
    expect(restoreAssetVersion).not.toHaveBeenCalled();
  });

  it("连续点击共用在途操作，未确认的目标不能被另一版本替换", async () => {
    const { result } = renderHook(() => useAssetRestore(projectId, "current"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    vi.mocked(imageRequest).mockRejectedValueOnce(new Error("连接中断"));
    await act(async () => {
      const first = result.current.restore("target");
      expect(result.current.restore("target")).toBe(first);
      await expect(first).rejects.toThrow("连接中断");
    });
    await act(async () => {
      await expect(result.current.restore("different")).rejects.toThrow(
        "先继续原操作",
      );
    });
    expect(restoreAssetVersion).toHaveBeenCalledTimes(1);
  });

  it("恢复记录按账号隔离，返回原账号后仍可继续原操作", async () => {
    const originalAccount = accountId;
    const { result, rerender } = renderHook(
      () => useAssetRestore(projectId, "current"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    vi.mocked(imageRequest).mockRejectedValueOnce(new Error("连接中断"));
    await act(async () => {
      await expect(result.current.restore("target")).rejects.toThrow();
    });
    accountId = crypto.randomUUID();
    rerender();
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
      expect(result.current.pending).toBeNull();
    });
    accountId = originalAccount;
    rerender();
    await waitFor(() =>
      expect(result.current.pending?.targetAssetId).toBe("target"),
    );
    expect(restoreAssetVersion).toHaveBeenCalledTimes(1);
  });

  it("另一页面已有未确认恢复时展示原目标，不用新目标替换", async () => {
    const first = renderHook(() => useAssetRestore(projectId, "current"), {
      wrapper,
    });
    const other = renderHook(() => useAssetRestore(projectId, "current"), {
      wrapper,
    });
    await waitFor(() => {
      expect(first.result.current.ready).toBe(true);
      expect(other.result.current.ready).toBe(true);
    });
    vi.mocked(imageRequest).mockRejectedValueOnce(new Error("连接中断"));
    await act(async () => {
      await expect(first.result.current.restore("target")).rejects.toThrow();
    });
    await act(async () => {
      await expect(other.result.current.restore("different")).rejects.toThrow(
        "先继续原操作",
      );
    });
    expect(other.result.current.pending).toEqual(first.result.current.pending);
    expect(restoreAssetVersion).toHaveBeenCalledTimes(1);
  });

  it("恢复请求期间切换账号不在新账号下继续加入画布，原记录仍保留", async () => {
    let finish: ((asset: typeof restored) => void) | undefined;
    vi.mocked(restoreAssetVersion).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      () => useAssetRestore(projectId, "current"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    const originalKey = recordKey();
    let failure: unknown;
    let request: Promise<void> | undefined;
    act(() => {
      request = result.current.restore("target").then(
        () => undefined,
        (cause) => {
          failure = cause;
        },
      );
    });
    await waitFor(() => expect(restoreAssetVersion).toHaveBeenCalledTimes(1));
    accountId = crypto.randomUUID();
    rerender();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      finish?.(restored);
      await request;
    });
    expect(failure).toBeInstanceOf(Error);
    expect(imageRequest).not.toHaveBeenCalled();
    expect(await draftRepository.read(originalKey)).toBeDefined();
    expect(result.current.pending).toBeNull();
  });

  it("迟到的成功响应不会清除另一页面接着创建的恢复记录", async () => {
    const { result } = renderHook(() => useAssetRestore(projectId, "current"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    const next = {
      currentAssetId: "current",
      targetAssetId: "next-target",
      requestId: "next-request",
      mutationId: "next-mutation",
    };
    vi.mocked(imageRequest).mockImplementation(async () => {
      const record = await draftRepository.read(recordKey());
      if (!record) throw new Error("缺少已保存请求");
      await draftRepository.remove(recordKey(), record.revision);
      await draftRepository.write(
        { key: recordKey(), accountId, baseline: "null", value: next },
        0,
      );
      return graph;
    });
    await act(async () => {
      await result.current.restore("target");
    });
    expect((await draftRepository.read(recordKey()))?.value).toEqual(next);
    expect(result.current.pending).toEqual(next);
  });
});
