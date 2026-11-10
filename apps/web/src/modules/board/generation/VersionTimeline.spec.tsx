// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesignAssetVersion } from "./generation-types";
import { VersionTimeline } from "./VersionTimeline";

const mocks = vi.hoisted(() => ({ fetchAssetVersions: vi.fn(), restoreAssetVersion: vi.fn() }));
vi.mock("./generation-api", () => mocks);
vi.mock("../workflow/ImageComparison", () => ({ ImageComparison: ({ onRestore, onClose }: { onRestore?: () => void; onClose: () => void }) => <section aria-label="历史对比"><button onClick={onClose}>返回版本历史</button>{onRestore ? <button onClick={onRestore}>恢复为新版本</button> : null}</section> }));
const version = (id: string): DesignAssetVersion => ({ id, projectId: "p", operation: "generated", parentAssetId: null, restoredFromAssetId: null, width: 600, height: 800, url: "/test.png", thumbnailUrl: null, archivedAt: null, seed: null, createdAt: "2026-11-10T00:00:00Z" });
function mount(readOnly = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(<QueryClientProvider client={client}><VersionTimeline assetId="current" readOnly={readOnly} /></QueryClientProvider>);
  return { ...result, client };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchAssetVersions.mockResolvedValue({ items: [version("current"), version("old")], nextCursor: null });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal("CSS", { escape: (value: string) => value });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("只读历史可以比较和返回，不提供任何恢复写入", async () => {
  mount(true);
  fireEvent.click(await screen.findByRole("button", { name: "对比当前版本" }));
  expect(screen.getByRole("region", { name: "历史对比" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /恢复/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "返回版本历史" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "对比当前版本" })).toBe(document.activeElement));
  expect(mocks.restoreAssetVersion).not.toHaveBeenCalled();
});

it("普通图片工作区继续保留版本恢复", async () => {
  mocks.restoreAssetVersion.mockResolvedValue(version("restored"));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "恢复此版" }));
  await waitFor(() => expect(mocks.restoreAssetVersion).toHaveBeenCalledWith("old", "current", expect.any(String)));
});

it("历史查询卸载时取消读取，防止迟到响应继续工作", async () => {
  let signal: AbortSignal | undefined;
  mocks.fetchAssetVersions.mockImplementation((_id, _cursor, incoming: AbortSignal) => { signal = incoming; return new Promise(() => {}); });
  const view = mount(true);
  await waitFor(() => expect(signal).toBeTruthy());
  view.unmount();
  expect(signal?.aborted).toBe(true);
});

it("翻页失败保留已读版本，重试只读取失败页", async () => {
  mocks.fetchAssetVersions.mockReset().mockResolvedValueOnce({ items: [version("current"), version("old")], nextCursor: "next" }).mockRejectedValueOnce(new Error("读取下一页失败")).mockResolvedValueOnce({ items: [version("older")], nextCursor: null });
  mount(true);
  fireEvent.click(await screen.findByRole("button", { name: "加载更多版本" }));
  await screen.findByText("读取下一页失败");
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "加载更多版本" }));
  await screen.findByText("已显示完整资产链");
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  expect(mocks.fetchAssetVersions.mock.calls.map(call => call[1])).toEqual([undefined, "next", "next"]);
});
