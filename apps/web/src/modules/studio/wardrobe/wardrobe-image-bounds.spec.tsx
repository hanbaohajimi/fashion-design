// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setPrivateRequestUser } from "../../auth/private-fetch";
import { useWardrobeImageBounds } from "./wardrobe-image-bounds";

const bounds = { width: 1000, height: 1200, x: 180, y: 90, contentWidth: 640, contentHeight: 1000 };
const fetchBounds = vi.fn();
let account = 0;
function response(value = bounds) { return new Response(JSON.stringify(value), { status: 200 }); }
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  setPrivateRequestUser(`bounds-test-${++account}`);
  fetchBounds.mockReset().mockImplementation(async () => response());
  vi.stubGlobal("fetch", fetchBounds);
});
afterEach(() => { cleanup(); setPrivateRequestUser(null); vi.unstubAllGlobals(); });

it("shares one read for the same candidate and revision, including after remount", async () => {
  const pending = deferred<Response>(); fetchBounds.mockReturnValueOnce(pending.promise);
  const first = renderHook(() => useWardrobeImageBounds("project", "candidate"));
  const second = renderHook(() => useWardrobeImageBounds("project", "candidate"));
  expect(fetchBounds).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(response()); });
  await waitFor(() => expect(first.result.current).toEqual(bounds));
  expect(second.result.current).toEqual(bounds);
  first.rerender(); second.rerender(); first.unmount(); second.unmount();
  const restored = renderHook(() => useWardrobeImageBounds("project", "candidate"));
  await waitFor(() => expect(restored.result.current).toEqual(bounds));
  expect(fetchBounds).toHaveBeenCalledTimes(1);
  expect(fetchBounds).toHaveBeenCalledWith("/api/projects/project/wardrobe/assets/candidate/bounds", expect.objectContaining({ method: "GET", cache: "no-store" }));
});

it("hides the previous asset immediately and ignores its late response after switching", async () => {
  const a = deferred<Response>(); const b = deferred<Response>();
  const other = { ...bounds, x: 100, contentWidth: 800 };
  fetchBounds.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const { result, rerender } = renderHook(({ assetId }) => useWardrobeImageBounds("project", assetId), { initialProps: { assetId: "a" } });
  rerender({ assetId: "b" });
  expect(result.current).toBeUndefined();
  await act(async () => { b.resolve(response(other)); });
  expect(result.current).toEqual(other);
  await act(async () => { a.resolve(response()); });
  expect(result.current).toEqual(other);
  rerender({ assetId: "c" });
  expect(result.current).toBeUndefined();
  await waitFor(() => expect(result.current).toEqual(bounds));
});

it("does not fetch for known bounds or a missing project/asset", () => {
  const known = renderHook(() => useWardrobeImageBounds("project", "asset", bounds));
  renderHook(() => useWardrobeImageBounds(undefined, "asset"));
  renderHook(() => useWardrobeImageBounds("project", undefined));
  expect(known.result.current).toEqual(bounds);
  expect(fetchBounds).not.toHaveBeenCalled();
});

it("keeps errors and invalid image bounds as a fallback without repeated mount requests", async () => {
  fetchBounds.mockResolvedValueOnce(new Response(null, { status: 403 }));
  const first = renderHook(() => useWardrobeImageBounds("project", "unavailable"));
  await act(async () => { await Promise.resolve(); });
  expect(first.result.current).toBeUndefined(); first.unmount();
  const second = renderHook(() => useWardrobeImageBounds("project", "unavailable"));
  await act(async () => { await Promise.resolve(); });
  expect(second.result.current).toBeUndefined();
  expect(fetchBounds).toHaveBeenCalledTimes(1);
  fetchBounds.mockResolvedValueOnce(response({ ...bounds, contentWidth: 1000 }));
  const invalid = renderHook(() => useWardrobeImageBounds("project", "invalid"));
  await act(async () => { await Promise.resolve(); });
  expect(invalid.result.current).toBeUndefined();
});

it("does not reuse another project's or account's cached metadata", async () => {
  const { result, rerender } = renderHook(({ projectId }) => useWardrobeImageBounds(projectId, "asset"), { initialProps: { projectId: "project-a" } });
  await waitFor(() => expect(result.current).toEqual(bounds));
  rerender({ projectId: "project-b" });
  expect(result.current).toBeUndefined();
  await waitFor(() => expect(result.current).toEqual(bounds));
  act(() => { setPrivateRequestUser("another-account"); });
  rerender({ projectId: "project-b" });
  expect(result.current).toBeUndefined();
  await waitFor(() => expect(result.current).toEqual(bounds));
  expect(fetchBounds).toHaveBeenCalledTimes(3);
});

it("does not apply a result after its consumer unmounts or its account expires", async () => {
  const pending = deferred<Response>(); fetchBounds.mockReturnValueOnce(pending.promise);
  const first = renderHook(() => useWardrobeImageBounds("project", "asset"));
  const signal = fetchBounds.mock.calls[0]?.[1].signal as AbortSignal;
  first.unmount();
  act(() => { setPrivateRequestUser("replacement-account"); });
  expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve(response()); });
  const replacement = renderHook(() => useWardrobeImageBounds("project", "asset"));
  await waitFor(() => expect(replacement.result.current).toEqual(bounds));
  expect(fetchBounds).toHaveBeenCalledTimes(2);
});
