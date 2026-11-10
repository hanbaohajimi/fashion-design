// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createOfficialSpiritRenderer } from "./official-spirit-renderer";
import type { ReadySpiritAsset, SpiritRenderer } from "./spirit-contract";

const asset: ReadySpiritAsset = {
  schemaVersion: 1, status: "ready", characterId: "forest-spirit-front-v8",
  visualReview: { approved: true, noEyelashes: true, crossEyeHighlights: true },
  model3Url: "/test/model.model3.json", coreUrl: "/test/core.js", runtimeModuleUrl: "/test/runtime.js",
  hitArea: { approved: true, viewBox: [100, 100], polygons: [[[0, 0], [100, 0], [0, 100]]] },
  motions: { idle: "/test/idle.motion3.json", hover_greet: "/test/hover.motion3.json", drag_hold: "/test/drag.motion3.json", put_down: "/test/down.motion3.json" },
};
const fake = (): SpiritRenderer => ({ load: vi.fn(async () => undefined), play: vi.fn(async () => undefined), pause: vi.fn(), resume: vi.fn(), resize: vi.fn(), dispose: vi.fn() });

describe("official runtime wrapper lifecycle (mock renderer; no WebGL claim)", () => {
  it("retains pre-load size and pause, then forwards all four motions", async () => {
    const inner = fake();
    const outer = createOfficialSpiritRenderer(document.createElement("canvas"), { loadCore: async () => undefined, importRuntime: async () => ({ sdkVersion: "5-r.5", createCubismRenderer: () => inner }) });
    outer.resize(0, 220, 4);
    await outer.load(asset, new AbortController().signal);
    expect(inner.resize).toHaveBeenCalledWith(1, 220, 2);
    expect(inner.pause).toHaveBeenCalled();
    for (const name of ["idle", "hover_greet", "drag_hold", "put_down"] as const) await outer.play(name, { interrupt: true });
    expect(inner.play).toHaveBeenCalledTimes(4);
    outer.resume(); outer.dispose(); outer.dispose();
    expect(inner.resume).toHaveBeenCalledOnce();
    expect(inner.dispose).toHaveBeenCalledOnce();
  });
  it("does not instantiate a stale renderer after disposal during dynamic import", async () => {
    let finish!: (value: { sdkVersion: string; createCubismRenderer: () => SpiritRenderer }) => void;
    const factory = vi.fn(fake);
    const imported = new Promise<{ sdkVersion: string; createCubismRenderer: () => SpiritRenderer }>(resolve => { finish = resolve; });
    const outer = createOfficialSpiritRenderer(document.createElement("canvas"), { loadCore: async () => undefined, importRuntime: () => imported });
    const loading = outer.load(asset, new AbortController().signal);
    const rejected = expect(loading).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve(); outer.dispose();
    finish({ sdkVersion: "5-r.5", createCubismRenderer: factory });
    await rejected;
    expect(factory).not.toHaveBeenCalled();
  });
  it("disposes a model that finishes after its owner aborts", async () => {
    const abort = new AbortController();
    const inner = fake();
    inner.load = vi.fn(async () => { abort.abort(); });
    const outer = createOfficialSpiritRenderer(document.createElement("canvas"), { loadCore: async () => undefined, importRuntime: async () => ({ sdkVersion: "5-r.5", createCubismRenderer: () => inner }) });
    await expect(outer.load(asset, abort.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(inner.dispose).toHaveBeenCalledOnce();
  });
  it("rejects an external Core URL before executing any script", async () => {
    const loadCore = vi.fn(async () => undefined);
    const outer = createOfficialSpiritRenderer(document.createElement("canvas"), { loadCore, importRuntime: async () => ({ sdkVersion: "5-r.5", createCubismRenderer: fake }) });
    await expect(outer.load({ ...asset, coreUrl: "https://unapproved.invalid/core.js" }, new AbortController().signal)).rejects.toThrow(/Approved/);
    expect(loadCore).not.toHaveBeenCalled();
  });
  it("rejects a reviewed old v2 package before loading Core", async () => {
    const loadCore = vi.fn(async () => undefined);
    const outer = createOfficialSpiritRenderer(document.createElement("canvas"), { loadCore, importRuntime: async () => ({ sdkVersion: "5-r.5", createCubismRenderer: fake }) });
    const stale = { ...asset, characterId: "forest-spirit-approved-v2" } as unknown as ReadySpiritAsset;
    await expect(outer.load(stale, new AbortController().signal)).rejects.toThrow(/Approved/);
    expect(loadCore).not.toHaveBeenCalled();
  });
  it("does not treat lower-level WIP render resources as production approval", async () => {
    const loadCore = vi.fn(async () => undefined);
    const outer = createOfficialSpiritRenderer(document.createElement("canvas"), { loadCore, importRuntime: async () => ({ sdkVersion: "5-r.5", createCubismRenderer: fake }) });
    const candidate = { ...asset, status: "diagnostic-candidate", visualReview: { approved: false }, hitArea: { ...asset.hitArea, approved: false } };
    await expect(outer.load(candidate, new AbortController().signal)).rejects.toThrow(/Approved/);
    expect(loadCore).not.toHaveBeenCalled();
  });
});
