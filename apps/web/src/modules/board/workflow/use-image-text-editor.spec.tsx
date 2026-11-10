// @vitest-environment jsdom
import "fake-indexeddb/auto";
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftScopeProvider } from "../../../components/drafts/use-persistent-draft";
import { imageRequest } from "./image-workspace-api";
import { useImageTextEditor } from "./use-image-text-editor";
import { changedImageText } from "./image-text-editor";

vi.mock("./image-workspace-api", () => ({ imageRequest: vi.fn() }));
const size = { width: 600, height: 800 };
const scan = {
  ...size,
  sourceHash: "a".repeat(64),
  regions: [
    { text: "森识", rect: { x: 0.1, y: 0.2, width: 0.5, height: 0.1 } },
  ],
};
let accountId: string;
let projectId: string;
const wrapper = ({ children }: { children: ReactNode }) => (
  <DraftScopeProvider scope={{ accountId, projectId, editor: "canvas" }}>
    {children}
  </DraftScopeProvider>
);
function selectedId(editor: ReturnType<typeof useImageTextEditor>) {
  if (!editor.selected) throw new Error("测试需要一个已选中的文字区域");
  return editor.selected.id;
}
beforeEach(() => {
  vi.resetAllMocks();
  accountId = crypto.randomUUID();
  projectId = crypto.randomUUID();
  vi.mocked(imageRequest).mockResolvedValue(scan);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("图片文字草稿与异步识别", () => {
  it("打开不自动识别，连续点击只发一次；纠正未改写原文不会生成反向替换", async () => {
    const { result } = renderHook(() => useImageTextEditor("asset", size), {
      wrapper,
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(imageRequest).not.toHaveBeenCalled();
    await act(async () => {
      await Promise.all([result.current.scan(), result.current.scan()]);
    });
    expect(imageRequest).toHaveBeenCalledTimes(1);
    const id = selectedId(result.current);
    act(() => result.current.update(id, { original: "森织" }));
    expect(result.current.selected?.replacement).toBe("森织");
    expect(changedImageText(result.current.draft.regions)).toHaveLength(0);
    act(() => result.current.update(id, { replacement: "春夏系列" }));
    act(() => result.current.update(id, { original: "森织设计" }));
    expect(result.current.selected?.replacement).toBe("春夏系列");
    await act(async () => {
      await result.current.scan();
    });
    expect(imageRequest).toHaveBeenCalledTimes(1);
  });
  it("关闭前保存修改，重新挂载保留文字、选区和当前选择", async () => {
    const first = renderHook(() => useImageTextEditor("asset", size), {
      wrapper,
    });
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(async () => {
      await first.result.current.scan();
    });
    const id = selectedId(first.result.current);
    act(() =>
      first.result.current.update(id, {
        replacement: "森织",
        rect: { x: 0.2, y: 0.3, width: 0.5, height: 0.2 },
      }),
    );
    await act(async () => {
      await first.result.current.checkpoint();
    });
    const draft = first.result.current.draft;
    first.unmount();
    const next = renderHook(() => useImageTextEditor("asset", size), {
      wrapper,
    });
    await waitFor(() => expect(next.result.current.ready).toBe(true));
    expect(next.result.current.draft).toEqual(draft);
    expect(imageRequest).toHaveBeenCalledOnce();
  });
  it.each(["asset", "account", "project"])(
    "%s 变化时清空本地状态，返回后恢复各自草稿",
    async (kind) => {
      const owner = { accountId, projectId };
      const { result, rerender } = renderHook(
        ({ asset }) => useImageTextEditor(asset, size),
        { wrapper, initialProps: { asset: "one" } },
      );
      await waitFor(() => expect(result.current.ready).toBe(true));
      act(() => result.current.add());
      act(() =>
        result.current.update(selectedId(result.current), {
          replacement: "我的草稿",
        }),
      );
      await act(async () => {
        await result.current.checkpoint();
      });
      if (kind === "account") accountId = crypto.randomUUID();
      if (kind === "project") projectId = crypto.randomUUID();
      rerender({ asset: kind === "asset" ? "two" : "one" });
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.draft.regions).toEqual([]);
      accountId = owner.accountId;
      projectId = owner.projectId;
      rerender({ asset: "one" });
      await waitFor(() =>
        expect(result.current.selected?.replacement).toBe("我的草稿"),
      );
    },
  );
  it("A → B → A 后过时结果不能污染本次手动编辑，也不保持忙碌", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(imageRequest).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result, rerender } = renderHook(
      ({ asset }) => useImageTextEditor(asset, size),
      { wrapper, initialProps: { asset: "a" } },
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.scan();
    });
    expect(result.current.scanning).toBe(true);
    rerender({ asset: "b" });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.scanning).toBe(false);
    rerender({ asset: "a" });
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.add());
    act(() =>
      result.current.update(selectedId(result.current), {
        replacement: "手动文案",
      }),
    );
    await act(async () => {
      resolve(scan);
      await pending;
    });
    expect(result.current.selected?.replacement).toBe("手动文案");
    expect(result.current.error).toBeNull();
    expect(result.current.scanning).toBe(false);
  });
  it("识别失败、未找到和图片尺寸变化有具体反馈并允许手动补充", async () => {
    const { result } = renderHook(() => useImageTextEditor("asset", size), {
      wrapper,
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    vi.mocked(imageRequest).mockRejectedValueOnce(new Error("暂时离线"));
    await act(async () => {
      await result.current.scan();
    });
    expect(result.current.error).toBe("暂时离线");
    vi.mocked(imageRequest).mockResolvedValueOnce({ ...scan, regions: [] });
    await act(async () => {
      await result.current.scan();
    });
    expect(result.current.notice).toContain("没有识别到");
    vi.mocked(imageRequest).mockResolvedValueOnce({ ...scan, width: 800 });
    await act(async () => {
      await result.current.scan();
    });
    expect(result.current.error).toContain("尺寸不一致");
    act(() => result.current.add());
    expect(result.current.draft.regions).toHaveLength(1);
  });
});
