// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createReviewSpiritRenderer, parseReviewSpiritCandidate, reviewSpiritHostResources, type ReviewSpiritCandidate } from "../../../../../scripts/manual/forest-spirit/review-spirit-resources";
import { createOfficialSpiritRenderer } from "./official-spirit-renderer";
import { parseReadySpiritAsset, type SpiritRenderer } from "./spirit-contract";

// Synthetic contract and renderer only. No model, contour or visual approval is claimed.
const candidate: ReviewSpiritCandidate = {
  schemaVersion: 1, status: "diagnostic-candidate", characterId: "forest-spirit-front-v8", productionApproval: false,
  visualReview: { approved: false }, hitArea: { approved: false, viewBox: [100, 100], polygons: [[[0, 0], [100, 0], [0, 100]]] },
  model3Url: "/__forest_wip/model.model3.json", coreUrl: "/__forest_wip/core.js", runtimeModuleUrl: "/__forest_wip/runtime.js",
  motions: { idle: "/__forest_wip/idle.motion3.json", hover_greet: "/__forest_wip/hover.motion3.json", drag_hold: "/__forest_wip/drag.motion3.json", put_down: "/__forest_wip/down.motion3.json" },
};
const fake = (): SpiritRenderer => ({ load: vi.fn(async () => undefined), play: vi.fn(async () => undefined), pause: vi.fn(), resume: vi.fn(), resize: vi.fn(), dispose: vi.fn() });

describe("manual candidate policy using the shared Cubism lifecycle (mock inner runtime)", () => {
  it("keeps candidate approval false and rejects it at both production policy boundaries", async () => {
    const before = JSON.stringify(candidate);
    expect(parseReviewSpiritCandidate(candidate)).toBe(candidate);
    expect(parseReadySpiritAsset(candidate)).toBeNull();
    const loadCore = vi.fn(async () => undefined);
    const outer = createOfficialSpiritRenderer(document.createElement("canvas"), { loadCore, importRuntime: async () => ({ sdkVersion: "5-r.5", createCubismRenderer: fake }) });
    await expect(outer.load(candidate, new AbortController().signal)).rejects.toThrow(/Approved/);
    expect(loadCore).not.toHaveBeenCalled();
    expect(JSON.stringify(candidate)).toBe(before);
  });
  it("loads through the shared bootstrap with the original candidate and retains lifecycle state", async () => {
    const inner = fake(); const loadCore = vi.fn(async () => undefined);
    const outer = createReviewSpiritRenderer(document.createElement("canvas"), { loadCore, importRuntime: async () => ({ sdkVersion: "5-r.5", createCubismRenderer: () => inner }) });
    outer.resize(160, 220, 4); outer.resume();
    await outer.load(candidate, new AbortController().signal);
    expect(loadCore).toHaveBeenCalledWith(candidate.coreUrl);
    expect(inner.load).toHaveBeenCalledWith(candidate, expect.any(AbortSignal));
    expect(inner.resize).toHaveBeenCalledWith(160, 220, 2);
    expect(inner.resume).toHaveBeenCalledOnce();
    outer.dispose(); outer.dispose();
    expect(inner.dispose).toHaveBeenCalledOnce();
  });
  it.each([
    { ...candidate, productionApproval: true },
    { ...candidate, status: "ready" },
    { ...candidate, visualReview: { approved: true } },
    { ...candidate, hitArea: { ...candidate.hitArea, approved: true } },
    { ...candidate, coreUrl: "https://example.invalid/core.js" },
    { ...candidate, model3Url: "/live2d/forest-spirit/model3.json" },
    { ...candidate, hitArea: { ...candidate.hitArea, polygons: [[[0, 0], [1, 1], [2, 2]]] } },
  ])("rejects malformed or ambiguous candidate flags and paths before loading Core: %j", async value => {
    expect(parseReviewSpiritCandidate(value)).toBeNull();
    const loadCore = vi.fn(async () => undefined);
    const outer = createReviewSpiritRenderer(document.createElement("canvas"), { loadCore, importRuntime: async () => ({ sdkVersion: "5-r.5", createCubismRenderer: fake }) });
    await expect(outer.load(value, new AbortController().signal)).rejects.toThrow(/Explicit unapproved/);
    expect(loadCore).not.toHaveBeenCalled();
  });
  it("propagates a failed actual-resource load and disposes its partial instance once", async () => {
    const inner = fake(); inner.load = vi.fn(async () => { throw new Error("Expected texture failure"); });
    const outer = createReviewSpiritRenderer(document.createElement("canvas"), { loadCore: async () => undefined, importRuntime: async () => ({ sdkVersion: "5-r.5", createCubismRenderer: () => inner }) });
    await expect(outer.load(candidate, new AbortController().signal)).rejects.toThrow("Expected texture failure");
    outer.dispose(); expect(inner.dispose).toHaveBeenCalledOnce();
  });
  it("does not start Core script loading for an already aborted owner", async () => {
    const loadCore = vi.fn(async () => undefined); const abort = new AbortController(); abort.abort();
    const outer = createReviewSpiritRenderer(document.createElement("canvas"), { loadCore, importRuntime: async () => ({ sdkVersion: "5-r.5", createCubismRenderer: fake }) });
    await expect(outer.load(candidate, abort.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(loadCore).not.toHaveBeenCalled(); outer.dispose();
  });
  it("rejects an incompatible runtime before constructing a model", async () => {
    const factory = vi.fn(fake);
    const outer = createReviewSpiritRenderer(document.createElement("canvas"), { loadCore: async () => undefined, importRuntime: async () => ({ sdkVersion: "unexpected", createCubismRenderer: factory }) });
    await expect(outer.load(candidate, new AbortController().signal)).rejects.toThrow(/runtime version/);
    expect(factory).not.toHaveBeenCalled(); outer.dispose();
  });
  it("removes a failed Core script and allows a later host to retry (DOM event fixture only)", async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const outer = createReviewSpiritRenderer(document.createElement("canvas"));
      const loading = outer.load(candidate, new AbortController().signal);
      const rejected = expect(loading).rejects.toThrow("Cubism Core could not be loaded");
      const script = document.querySelector<HTMLScriptElement>('script[src="/__forest_wip/core.js"]');
      expect(script).not.toBeNull();
      script?.dispatchEvent(new Event("error"));
      await rejected;
      expect(document.querySelector('script[src="/__forest_wip/core.js"]')).toBeNull();
      outer.dispose();
    }
  });
  it("does not instantiate a runtime after the manual host aborts its import", async () => {
    let finish!: (runtime: { sdkVersion: string; createCubismRenderer: () => SpiritRenderer }) => void;
    const pending = new Promise<{ sdkVersion: string; createCubismRenderer: () => SpiritRenderer }>(resolve => { finish = resolve; });
    const factory = vi.fn(fake); const abort = new AbortController();
    const outer = createReviewSpiritRenderer(document.createElement("canvas"), { loadCore: async () => undefined, importRuntime: () => pending });
    const loading = outer.load(candidate, abort.signal);
    const rejected = expect(loading).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve(); abort.abort(); finish({ sdkVersion: "5-r.5", createCubismRenderer: factory });
    await rejected; expect(factory).not.toHaveBeenCalled(); outer.dispose();
  });
  it("requires the isolated review namespace for its manifest without introducing an app flag", () => {
    expect(reviewSpiritHostResources("/__forest_wip/review.json").parseAsset).toBe(parseReviewSpiritCandidate);
    for (const url of ["/live2d/forest-spirit/asset-manifest.json", "/__forest_wip/../ready.json", "/__forest_wip/review.json?ready=true", "https://example.invalid/review.json"]) expect(() => reviewSpiritHostResources(url)).toThrow(/isolated/);
  });
});
