// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import shippedManifest from "../../../public/live2d/forest-spirit/asset-manifest.json";
import { anchorToPoint, parseReadySpiritAsset, pointToAnchor, readSpiritAnchor, type ReadySpiritAsset } from "./spirit-contract";

export function testAsset(): ReadySpiritAsset {
  return {
    schemaVersion: 1, status: "ready", characterId: "forest-spirit-front-v8",
    visualReview: { approved: true, noEyelashes: true, crossEyeHighlights: true },
    model3Url: "/test-only/model.model3.json", coreUrl: "/test-only/core.js", runtimeModuleUrl: "/test-only/runtime.js",
    hitArea: { approved: true, viewBox: [100, 200], polygons: [[[20, 20], [80, 20], [80, 190], [20, 190]]] },
    motions: { idle: "/test-only/idle.motion3.json", hover_greet: "/test-only/hover.motion3.json", drag_hold: "/test-only/drag.motion3.json", put_down: "/test-only/put-down.motion3.json" },
  };
}
beforeEach(() => localStorage.clear());
describe("production asset gate (synthetic contract fixtures only)", () => {
  it("keeps the shipped v8 manifest closed while production assets remain unaccepted", () => {
    expect(shippedManifest.schemaVersion).toBe(1);
    expect(shippedManifest.characterId).toBe("forest-spirit-front-v8");
    expect(shippedManifest.status).toBe("awaiting-production-assets");
    expect(parseReadySpiritAsset(shippedManifest)).toBeNull();
  });
  it("requires reviewed character identity, no eyelashes and cross-shaped eye highlights", () => {
    expect(parseReadySpiritAsset(testAsset())).not.toBeNull();
    expect(parseReadySpiritAsset({ status: "missing" })).toBeNull();
    expect(parseReadySpiritAsset({ ...testAsset(), characterId: "SproutProof" })).toBeNull();
    expect(parseReadySpiritAsset({ ...testAsset(), characterId: "forest-spirit-approved-v1" })).toBeNull();
    expect(parseReadySpiritAsset({ ...testAsset(), characterId: "forest-spirit-approved-v2" })).toBeNull();
    expect(parseReadySpiritAsset({ ...testAsset(), status: "awaiting-production-assets" })).toBeNull();
    for (const flag of ["approved", "noEyelashes", "crossEyeHighlights"]) {
      const asset = testAsset(); Object.assign(asset.visualReview, { [flag]: false });
      expect(parseReadySpiritAsset(asset)).toBeNull();
    }
  });
  it("requires reviewed finite nondegenerate hit geometry and local runtime assets", () => {
    const asset = testAsset();
    expect(parseReadySpiritAsset({ ...asset, coreUrl: "https://untrusted.example/core.js" })).toBeNull();
    expect(parseReadySpiritAsset({ ...asset, model3Url: "//example/model.json" })).toBeNull();
    expect(parseReadySpiritAsset({ ...asset, hitArea: { ...asset.hitArea, approved: false } })).toBeNull();
    expect(parseReadySpiritAsset({ ...asset, hitArea: { ...asset.hitArea, polygons: [[[0, 0], [1, 1], [2, 2]]] } })).toBeNull();
    expect(parseReadySpiritAsset({ ...asset, hitArea: { ...asset.hitArea, polygons: [[[0, 0], [NaN, 1], [20, 20]]] } })).toBeNull();
    expect(parseReadySpiritAsset({ ...asset, motions: { ...asset.motions, put_down: undefined } })).toBeNull();
  });
});
describe("position preferences", () => {
  it("normalizes available movement rather than viewport dimensions and preserves intent when no travel is possible", () => {
    expect(pointToAnchor({ x: 100, y: 50 }, { x: 200, y: 100 }, { xRatio: 1, yRatio: 1 })).toEqual({ xRatio: 0.5, yRatio: 0.5 });
    expect(anchorToPoint({ xRatio: 0.5, yRatio: 0.5 }, { x: 400, y: 20 })).toEqual({ x: 200, y: 10 });
    expect(pointToAnchor({ x: 0, y: 0 }, { x: 0, y: 0 }, { xRatio: 0.5, yRatio: 0.5 })).toEqual({ xRatio: 0.5, yRatio: 0.5 });
  });
  it("isolates account/project keys, clamps values and tolerates malformed storage", () => {
    localStorage.setItem("user-a:project-a", JSON.stringify({ xRatio: -3, yRatio: 9 }));
    expect(readSpiritAnchor("user-a:project-a")).toEqual({ xRatio: 0, yRatio: 1 });
    expect(readSpiritAnchor("user-b:project-a")).toEqual({ xRatio: 1, yRatio: 1 });
    localStorage.setItem("broken", "{"); expect(readSpiritAnchor("broken")).toEqual({ xRatio: 1, yRatio: 1 });
  });
});
