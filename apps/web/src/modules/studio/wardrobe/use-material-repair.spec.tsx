// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMaterialRepair } from "./use-material-repair";
const mocks = vi.hoisted(() => ({ upload: vi.fn(), probe: vi.fn(), derive: vi.fn(), fetch: vi.fn(), cancel: vi.fn(), poll: null as null | ((signal: AbortSignal) => Promise<void>), enabled: false }));
vi.mock("./wardrobe-assets", () => ({ uploadWardrobeMask: mocks.upload }));
vi.mock("./wardrobe-api", () => ({ wardrobeApi: { materialProbe: mocks.probe, materialAlpha: mocks.derive } }));
vi.mock("../../board/generation/generation-api", () => ({ fetchGenerationTask: mocks.fetch, cancelGeneration: mocks.cancel }));
vi.mock("../../use-serial-polling", () => ({ useSerialPolling: (_key: string, enabled: boolean, _interval: number, task: (signal: AbortSignal) => Promise<void>) => { mocks.poll = task; mocks.enabled = enabled; return { error: null }; } }));
const prepared = { id: "derived-preparation", status: "ready", candidates: [{ assetId: "derived" }], sourceAssetId: "source" };
const blob = new Blob(["mask"], { type: "image/png" });
const props = { projectId: "project", sourceAssetId: "source", name: "浅色蕾丝", category: "top" as const, open: true, enabled: true, onPrepared: vi.fn() };
const pending = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const poll = async () => { if (mocks.enabled && mocks.poll) await mocks.poll(new AbortController().signal); };
beforeEach(() => { vi.clearAllMocks(); mocks.upload.mockResolvedValue({ id: "project-mask" }); mocks.probe.mockResolvedValue({ taskId: "probe-task" }); mocks.derive.mockResolvedValue(prepared); mocks.cancel.mockResolvedValue({ status: "canceled" }); mocks.fetch.mockResolvedValue({ status: "succeeded", output: { images: [{ assetId: "raw-asset" }] } }); });
afterEach(cleanup);

it("only an explicit start uploads a project mask and generates, then derives a pending candidate without confirming", async () => {
  const { result } = renderHook(useMaterialRepair, { initialProps: props });
  expect(mocks.probe).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
  await act(() => result.current.start(blob, "保留内衬", { x: .1, y: .2, width: .1, height: .1 }));
  expect(mocks.upload).toHaveBeenCalledWith("project", "source", blob, expect.any(AbortSignal), "transparency");
  expect(mocks.probe).toHaveBeenCalledWith("project", expect.objectContaining({ sourceAssetId: "source", maskAssetId: "project-mask", notes: "保留内衬", detailRegion: { x: .1, y: .2, width: .1, height: .1 } }));
  await act(poll);
  expect(mocks.derive).toHaveBeenCalledWith("project", expect.objectContaining({ sourceAssetId: "source", rawAssetId: "raw-asset", maskAssetId: "project-mask" }));
  expect(props.onPrepared).toHaveBeenCalledWith(prepared); expect(props.onPrepared).toHaveBeenCalledTimes(1);
});

it("keeps a completed result while closed and resumes it without another paid request", async () => {
  const held = pending<typeof prepared>(); mocks.derive.mockReturnValue(held.promise);
  const { result, rerender } = renderHook(useMaterialRepair, { initialProps: props });
  await act(() => result.current.start(blob, "", null));
  let flight!: Promise<void>; await act(async () => { flight = poll(); await Promise.resolve(); });
  rerender({ ...props, open: false });
  await act(async () => { held.resolve(prepared); await flight; });
  expect(props.onPrepared).not.toHaveBeenCalled(); expect(mocks.enabled).toBe(false);
  rerender(props); await act(poll);
  expect(props.onPrepared).toHaveBeenCalledTimes(1); expect(mocks.probe).toHaveBeenCalledTimes(1); expect(mocks.derive).toHaveBeenCalledTimes(1);
});

it("cancels a probe that returns after cancellation and never derives it", async () => {
  const held = pending<{ taskId: string }>(); mocks.probe.mockReturnValue(held.promise);
  const { result } = renderHook(useMaterialRepair, { initialProps: props });
  let flight!: Promise<void>; await act(async () => { flight = result.current.start(blob, "", null); await Promise.resolve(); });
  await act(() => result.current.cancel());
  await act(async () => { held.resolve({ taskId: "late-task" }); await flight; });
  expect(mocks.cancel).toHaveBeenCalledWith("late-task"); expect(mocks.derive).not.toHaveBeenCalled(); expect(props.onPrepared).not.toHaveBeenCalled();
});

it("ignores an in-flight derived result after cancellation or unmount", async () => {
  for (const exit of ["cancel", "unmount"] as const) {
    const held = pending<typeof prepared>(); mocks.derive.mockReturnValueOnce(held.promise);
    const { result, unmount } = renderHook(useMaterialRepair, { initialProps: props });
    await act(() => result.current.start(blob, "", null));
    let flight!: Promise<void>; await act(async () => { flight = poll(); await Promise.resolve(); });
    if (exit === "cancel") await act(() => result.current.cancel()); else unmount();
    await act(async () => { held.resolve(prepared); await flight; });
    expect(props.onPrepared).not.toHaveBeenCalled(); unmount();
  }
});

it("reuses the derive key after a successful response is lost, without another generation", async () => {
  mocks.derive.mockRejectedValueOnce(new Error("响应连接中断"));
  const { result } = renderHook(useMaterialRepair, { initialProps: props });
  await act(() => result.current.start(blob, "", null)); await act(poll);
  expect(result.current.phase).toBe("failed"); expect(result.current.canRetryProcessing).toBe(true);
  const firstKey = mocks.derive.mock.calls[0]?.[1].requestKey;
  await act(() => result.current.retryProcessing());
  expect(mocks.derive.mock.calls[1]?.[1]).toMatchObject({ rawAssetId: "raw-asset", maskAssetId: "project-mask" });
  expect(mocks.derive.mock.calls[1]?.[1].requestKey).toBe(firstKey);
  expect(mocks.probe).toHaveBeenCalledTimes(1); expect(props.onPrepared).toHaveBeenCalledTimes(1);
});

it("keeps the original candidate for a failed or empty preparation and only replaces an explicitly failed key", async () => {
  mocks.derive.mockResolvedValueOnce({ ...prepared, status: "failed", error: "选区未能生成有效候选", candidates: [] }).mockResolvedValueOnce({ ...prepared, candidates: [] });
  const { result } = renderHook(useMaterialRepair, { initialProps: props });
  await act(() => result.current.start(blob, "", null)); await act(poll);
  const failedKey = mocks.derive.mock.calls[0]?.[1].requestKey;
  expect(props.onPrepared).not.toHaveBeenCalled(); expect(result.current.phase).toBe("failed");
  await act(() => result.current.retryProcessing());
  const emptyKey = mocks.derive.mock.calls[1]?.[1].requestKey;
  expect(emptyKey).not.toBe(failedKey); expect(props.onPrepared).not.toHaveBeenCalled();
  await act(() => result.current.retryProcessing());
  expect(mocks.derive.mock.calls[2]?.[1].requestKey).toBe(emptyKey); expect(props.onPrepared).toHaveBeenCalledTimes(1);
});

it("allows a new source to start while the old submission is pending and isolates a late cancel failure", async () => {
  const old = pending<{ taskId: string }>(); mocks.probe.mockReturnValueOnce(old.promise);
  const { result, rerender } = renderHook(useMaterialRepair, { initialProps: props });
  let flight!: Promise<void>; await act(async () => { flight = result.current.start(blob, "", null); await Promise.resolve(); });
  await act(() => result.current.cancel());
  rerender({ ...props, sourceAssetId: "new-source" });
  await act(() => result.current.start(blob, "", null));
  expect(mocks.probe).toHaveBeenCalledTimes(2); expect(mocks.probe.mock.calls[1]?.[1].sourceAssetId).toBe("new-source");
  mocks.cancel.mockRejectedValueOnce(new Error("旧取消失败"));
  await act(async () => { old.resolve({ taskId: "old-task" }); await flight; });
  expect(result.current.error).toBeNull(); expect(result.current.taskId).toBe("probe-task");
});

it("requires an explicit new paid start after generation failure and uses a fresh request key", async () => {
  mocks.fetch.mockResolvedValueOnce({ status: "failed", error: { message: "生成失败" } });
  const { result } = renderHook(useMaterialRepair, { initialProps: props });
  await act(() => result.current.start(blob, "", null)); await act(poll);
  const key = mocks.probe.mock.calls[0]?.[1].requestKey;
  expect(result.current.phase).toBe("failed"); expect(mocks.probe).toHaveBeenCalledTimes(1);
  await act(() => result.current.start(blob, "", null));
  expect(mocks.probe.mock.calls[1]?.[1].requestKey).not.toBe(key);
});

it("does not start while disabled or closed and isolates source changes", async () => {
  const { result, rerender } = renderHook(useMaterialRepair, { initialProps: { ...props, enabled: false } });
  await act(() => result.current.start(blob, "", null)); expect(mocks.upload).not.toHaveBeenCalled();
  rerender({ ...props, open: false }); await act(() => result.current.start(blob, "", null)); expect(mocks.upload).not.toHaveBeenCalled();
  rerender(props); await act(() => result.current.start(blob, "", null));
  const held = pending<{ status: string; output: { images: { assetId: string }[] } }>(); mocks.fetch.mockReturnValueOnce(held.promise);
  let flight!: Promise<void>; await act(async () => { flight = poll(); });
  rerender({ ...props, sourceAssetId: "new-source" });
  await act(async () => { held.resolve({ status: "succeeded", output: { images: [{ assetId: "old-raw" }] } }); await flight; });
  expect(mocks.derive).not.toHaveBeenCalled(); expect(props.onPrepared).not.toHaveBeenCalled();
});

it("binds side derivation to its preparation while probe uses the selected side asset", async () => {
  const sideProps = { ...props, sourceAssetId: "side-candidate", sidePreparationId: "side-preparation" };
  const { result } = renderHook(useMaterialRepair, { initialProps: sideProps });
  await act(() => result.current.start(blob, "保留侧挂角度", null)); await act(poll);
  expect(mocks.probe).toHaveBeenCalledWith("project", expect.objectContaining({ sourceAssetId: "side-candidate" }));
  expect(mocks.probe.mock.calls[0]?.[1]).not.toHaveProperty("sidePreparationId");
  expect(mocks.derive).toHaveBeenCalledWith("project", expect.objectContaining({ sourceAssetId: "side-candidate", sidePreparationId: "side-preparation" }));
});

it("isolates late derivation when the same side asset is inspected under a different preparation", async () => {
  const held = pending<typeof prepared>(); mocks.derive.mockReturnValueOnce(held.promise);
  const sideProps = { ...props, sourceAssetId: "side-candidate", sidePreparationId: "side-preparation" };
  const { result, rerender } = renderHook(useMaterialRepair, { initialProps: sideProps });
  await act(() => result.current.start(blob, "", null));
  let flight!: Promise<void>; await act(async () => { flight = poll(); await Promise.resolve(); });
  rerender({ ...sideProps, sidePreparationId: "new-side-preparation" });
  await act(async () => { held.resolve(prepared); await flight; });
  expect(props.onPrepared).not.toHaveBeenCalled(); expect(result.current.phase).toBe("idle");
  await act(() => result.current.start(blob, "", null)); await act(poll);
  expect(mocks.derive.mock.calls[1]?.[1].sidePreparationId).toBe("new-side-preparation");
});

it("requires correction notes and sends the same operation through mask, probe and derive", async () => {
  const { result } = renderHook(useMaterialRepair, { initialProps: { ...props, operation: "correction" as const } });
  await act(() => result.current.start(blob, "  ", null));
  expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.probe).not.toHaveBeenCalled();
  expect(result.current.error).toContain("请填写局部修正说明");
  await act(() => result.current.start(blob, "保留轮廓，只恢复细斜纹", null)); await act(poll);
  expect(mocks.upload).toHaveBeenCalledWith("project", "source", blob, expect.any(AbortSignal), "correction");
  expect(mocks.probe.mock.calls[0]?.[1]).toMatchObject({ operation: "correction", notes: "保留轮廓，只恢复细斜纹" });
  expect(mocks.derive.mock.calls[0]?.[1]).toMatchObject({ operation: "correction" });
});

it("ignores a transparency result after the same asset changes to correction mode", async () => {
  const held = pending<typeof prepared>(); mocks.derive.mockReturnValueOnce(held.promise);
  const initial = { ...props, operation: "transparency" as "transparency" | "correction" };
  const { result, rerender } = renderHook(useMaterialRepair, { initialProps: initial });
  await act(() => result.current.start(blob, "", null));
  let flight!: Promise<void>; await act(async () => { flight = poll(); await Promise.resolve(); });
  rerender({ ...initial, operation: "correction" });
  await act(async () => { held.resolve(prepared); await flight; });
  expect(props.onPrepared).not.toHaveBeenCalled(); expect(result.current.phase).toBe("idle");
  await act(() => result.current.start(blob, "保留透明度，修正缝线", null)); await act(poll);
  expect(mocks.derive.mock.calls[1]?.[1].operation).toBe("correction");
});
