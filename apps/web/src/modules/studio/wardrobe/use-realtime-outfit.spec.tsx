// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OutfitSnapshotView, WardrobeCapabilities, WardrobeRevisionView } from "@fashion/shared";
import { useRealtimeOutfit } from "./use-realtime-outfit";
import { emptyOutfit, type OutfitDraft } from "./wardrobe-state";

const api = vi.hoisted(() => ({ trial: vi.fn(), reference: vi.fn(), save: vi.fn() }));
vi.mock("./wardrobe-api", () => ({ wardrobeApi: api }));
const capabilities: WardrobeCapabilities = { enabled: true, preparationEnabled: true, staticTryOnEnabled: true, realtimeOutfitEnabled: true, realtimeMultiItemVerified: true, realtimeCategories: ["top", "bottom", "outerwear"] };
const revisions = new Map<string, WardrobeRevisionView>(["a", "b", "c"].map((id, index) => [id, { id, itemId: id, version: 1, sourceAssetId: id, assetId: id, name: id, category: (["top", "bottom", "outerwear"] as const)[index] ?? "top", display: "hanger", anchor: { x: .5, y: .08 }, reviewed: true, sourceKind: "isolated", generatedCompletion: false, url: `/${id}.png`, createdAt: "" }]));
const draft = (...ids: string[]): OutfitDraft => ({ ...emptyOutfit(), items: ids.map((revisionId, layer) => ({ revisionId, layer, wearNote: "" })) });
function snapshot(id: string): OutfitSnapshotView { return { id, outfitId: "trial", projectId: "project", version: 1, name: id, items: [], layeringConfirmed: false, prompt: "", createdAt: "", referenceAssetId: `${id}-reference`, referenceUrl: `/${id}.png` }; }
function deferred<T>() { let resolve: (value: T) => void = () => {}; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { api.trial.mockReset(); api.reference.mockReset(); api.save.mockReset(); api.reference.mockImplementation(async (_project: string, id: string) => snapshot(id)); });
afterEach(() => { cleanup(); });

it("coalesces in-flight A then B/C into only the latest complete C outfit without formally saving", async () => {
  const a = deferred<OutfitSnapshotView>();
  api.trial.mockReturnValueOnce(a.promise).mockResolvedValueOnce(snapshot("c"));
  const old = snapshot("previous");
  const { result, rerender } = renderHook(({ value }: { value: OutfitDraft }) => useRealtimeOutfit({ projectId: "project", draft: value, revisions, base: old, capabilities, enabled: true }), { initialProps: { value: draft("a") } });
  await waitFor(() => expect(api.trial).toHaveBeenCalledTimes(1));
  expect(result.current.snapshot?.id).toBe("previous"); expect(result.current.updating).toBe(true);
  rerender({ value: draft("a", "b") });
  rerender({ value: draft("a", "b", "c") });
  await act(async () => { a.resolve(snapshot("a")); });
  await waitFor(() => expect(result.current.snapshot?.id).toBe("c"));
  expect(api.trial).toHaveBeenCalledTimes(2);
  expect(api.trial.mock.calls[1]?.[1].items.map((item: { revisionId: string }) => item.revisionId)).toEqual(["a", "b", "c"]);
  expect(api.reference.mock.calls.map(call => call[1])).toEqual(["c"]);
  expect(result.current.updating).toBe(false); expect(api.save).not.toHaveBeenCalled();
});

it("does not apply a late preparation after leaving self-try-on mode", async () => {
  const pending = deferred<OutfitSnapshotView>(); api.trial.mockReturnValue(pending.promise);
  const { result, rerender } = renderHook(({ enabled }: { enabled: boolean }) => useRealtimeOutfit({ projectId: "project", draft: draft("a"), revisions, base: null, capabilities, enabled }), { initialProps: { enabled: true } });
  await waitFor(() => expect(api.trial).toHaveBeenCalledTimes(1));
  rerender({ enabled: false });
  await act(async () => { pending.resolve(snapshot("late")); });
  expect(api.reference).not.toHaveBeenCalled(); expect(result.current.snapshot).toBeNull();
});

it("does not start reference preparation after unmount", async () => {
  const pending = deferred<OutfitSnapshotView>(); api.trial.mockReturnValue(pending.promise);
  const { unmount } = renderHook(() => useRealtimeOutfit({ projectId: "project", draft: draft("a"), revisions, base: null, capabilities, enabled: true }));
  await waitFor(() => expect(api.trial).toHaveBeenCalledTimes(1));
  unmount(); await act(async () => { pending.resolve(snapshot("late")); });
  expect(api.reference).not.toHaveBeenCalled();
});

it("never prepares a provider reference when full-outfit capability is unavailable", async () => {
  const { result } = renderHook(() => useRealtimeOutfit({ projectId: "project", draft: draft("a", "b"), revisions, base: null, capabilities: { ...capabilities, realtimeMultiItemVerified: false }, enabled: true }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
  expect(api.trial).not.toHaveBeenCalled(); expect(api.reference).not.toHaveBeenCalled();
  expect(result.current.snapshot?.items).toHaveLength(2); expect(result.current.updating).toBe(false);
});

it("stops using the previous outfit when preparation fails and preserves the request key for retry", async () => {
  api.trial.mockRejectedValueOnce(new Error("准备失败")).mockResolvedValueOnce(snapshot("retry"));
  const { result } = renderHook(() => useRealtimeOutfit({ projectId: "project", draft: draft("a"), revisions, base: snapshot("old"), capabilities, enabled: true }));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.snapshot).toBeNull(); expect(result.current.updating).toBe(false);
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.snapshot?.id).toBe("retry"));
  expect(api.trial.mock.calls[0]?.[1].requestKey).toBe(api.trial.mock.calls[1]?.[1].requestKey);
});

it("does not prepare another reference when only the outfit name changes", async () => {
  api.trial.mockResolvedValue(snapshot("prepared"));
  const { result, rerender } = renderHook(({ value }: { value: OutfitDraft }) => useRealtimeOutfit({ projectId: "project", draft: value, revisions, base: null, capabilities, enabled: true }), { initialProps: { value: draft("a") } });
  await waitFor(() => expect(result.current.snapshot?.id).toBe("prepared"));
  rerender({ value: { ...draft("a"), name: "只修改名字" } });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
  expect(result.current.updating).toBe(false);
  expect(api.trial).toHaveBeenCalledTimes(1); expect(api.reference).toHaveBeenCalledTimes(1);
});
